import {
  AiAssistant,
  aiError,
  aiErrorKind,
  AiHost,
  AiSettings,
  AiTask,
  anthropicMessages,
  askModel,
  chatCompletion,
  ChatMessage,
  cloudSettings,
  correctionPrompt,
  explainPrompt,
  FetchLike,
  kAnthropicVersion,
  kCloudProviders,
  kCloudTimeoutMs,
  kDefaultAiBaseUrl,
  kLocalTimeoutMs,
  parseSuggestions,
  rewritePrompt,
  timeoutFor,
} from "./pime_ai";

const settings: AiSettings = {
  protocol: "openai",
  baseUrl: kDefaultAiBaseUrl,
  model: "qwen2.5:7b",
  apiKey: "",
  isLocal: true,
};

const claude: AiSettings = {
  protocol: "anthropic",
  baseUrl: kCloudProviders.claude.baseUrl,
  model: kCloudProviders.claude.model,
  apiKey: "sk-ant-test",
  isLocal: false,
};

const answer = (content: unknown, ok = true, status = 200): FetchLike =>
  jest.fn(async () => ({
    ok,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  }));

describe("chatCompletion", () => {
  test("posts to the OpenAI-compatible chat API and returns the answer", async () => {
    const fetchImpl = answer("記得帶傘");
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    await expect(
      chatCompletion({ ...settings, baseUrl: "http://localhost:11434/v1/" }, messages, fetchImpl),
    ).resolves.toBe("記得帶傘");
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({
      model: "qwen2.5:7b",
      messages,
      stream: false,
    });
  });

  test("sends the API key when there is one", async () => {
    const fetchImpl = answer("ok");
    await chatCompletion({ ...settings, apiKey: "k" }, [], fetchImpl);
    expect((fetchImpl as jest.Mock).mock.calls[0][1].headers.Authorization).toBe(
      "Bearer k",
    );
  });

  test("drops a reasoning block", async () => {
    await expect(
      chatCompletion(settings, [], answer("<think>hmm\nok</think>\n記得帶傘")),
    ).resolves.toBe("記得帶傘");
  });

  test("fails on HTTP errors and empty answers", async () => {
    await expect(chatCompletion(settings, [], answer("x", false, 404))).rejects.toThrow(
      "HTTP 404",
    );
    await expect(chatCompletion(settings, [], answer(undefined))).rejects.toThrow(
      "no answer",
    );
  });

  test("tells busy, refused and other HTTP errors apart", async () => {
    const kindOf = (status: number): Promise<string> =>
      chatCompletion(settings, [], answer("x", false, status)).then(
        () => "none",
        (e) => aiErrorKind(e),
      );
    await expect(kindOf(429)).resolves.toBe("busy");
    await expect(kindOf(503)).resolves.toBe("busy");
    await expect(kindOf(401)).resolves.toBe("auth");
    await expect(kindOf(403)).resolves.toBe("auth");
    await expect(kindOf(404)).resolves.toBe("failed");
    await expect(kindOf(500)).resolves.toBe("failed");
  });

  test("shows the service's reason, and a 400 about the key is a key problem", async () => {
    // Gemini wraps its errors in an array.
    const gemini400 = (message: string, reason: string): FetchLike =>
      jest.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => [
          {
            error: {
              code: 400,
              message,
              status: "INVALID_ARGUMENT",
              details: [{ reason }],
            },
          },
        ],
      }));
    const badKey = await chatCompletion(
      settings,
      [],
      gemini400("API key not valid. Please pass a valid API key.", "API_KEY_INVALID"),
    ).catch((e) => e);
    expect(aiErrorKind(badKey)).toBe("auth");
    expect(badKey.message).toBe("HTTP 400：API key not valid. Please pass a valid API key.");

    const badField = await chatCompletion(
      settings,
      [],
      gemini400("Invalid value for reasoning_effort", "BAD_REQUEST"),
    ).catch((e) => e);
    expect(aiErrorKind(badField)).toBe("failed");
    expect(badField.message).toContain("reasoning_effort");

    // OpenAI and Anthropic send an object; a body that is not JSON is fine too.
    const openai: FetchLike = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: "model not found" } }),
    });
    await expect(chatCompletion(settings, [], openai)).rejects.toThrow(
      "HTTP 404：model not found",
    );
    const html: FetchLike = async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    await expect(chatCompletion(settings, [], html)).rejects.toThrow(/^HTTP 502$/);
  });

  test("keeps the reason short", async () => {
    const long: FetchLike = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "x".repeat(300) } }),
    });
    const failure = await chatCompletion(settings, [], long).catch((e) => e);
    expect(failure.message.length).toBeLessThanOrEqual(100);
  });

  test("gives up after the timeout, as a timeout", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const failure = await chatCompletion(settings, [], fetchImpl, 10).catch((e) => e);
    expect(aiErrorKind(failure)).toBe("timeout");
  });

  test("asks for little thinking when the settings say so", async () => {
    const fetchImpl = answer("ok");
    await chatCompletion({ ...settings, reasoningEffort: "minimal" }, [], fetchImpl);
    expect(JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body).reasoning_effort).toBe(
      "minimal",
    );
    const plainFetch = answer("ok");
    await chatCompletion(settings, [], plainFetch);
    expect(JSON.parse((plainFetch as jest.Mock).mock.calls[0][1].body)).not.toHaveProperty(
      "reasoning_effort",
    );
  });
});

describe("askModel retries", () => {
  // Answers with each status in turn, then 200.
  const statuses = (...codes: number[]): FetchLike => {
    let i = 0;
    return jest.fn(async () => {
      const status = codes[i++] ?? 200;
      return {
        ok: status === 200,
        status,
        json: async () => ({ choices: [{ message: { content: "記得帶傘" } }] }),
      };
    });
  };

  test("asks once more when the service is busy", async () => {
    for (const busy of [503, 429]) {
      const fetchImpl = statuses(busy);
      await expect(askModel(settings, [], fetchImpl, 1000, 0)).resolves.toBe("記得帶傘");
      expect((fetchImpl as jest.Mock).mock.calls).toHaveLength(2);
    }
  });

  test("only once", async () => {
    const fetchImpl = statuses(503, 503);
    const failure = await askModel(settings, [], fetchImpl, 1000, 0).catch((e) => e);
    expect(aiErrorKind(failure)).toBe("busy");
    expect((fetchImpl as jest.Mock).mock.calls).toHaveLength(2);
  });

  test("asks again without reasoning_effort if the model refuses the request", async () => {
    const fetchImpl = statuses(400);
    await expect(
      askModel({ ...settings, reasoningEffort: "minimal" }, [], fetchImpl, 1000, 0),
    ).resolves.toBe("記得帶傘");
    const bodies = (fetchImpl as jest.Mock).mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies[0].reasoning_effort).toBe("minimal");
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });

  test("but not for a bad key, nor without reasoning_effort", async () => {
    const badKey: FetchLike = jest.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => [{ error: { message: "API key not valid." } }],
    }));
    const failure = await askModel(
      { ...settings, reasoningEffort: "minimal" },
      [],
      badKey,
      1000,
      0,
    ).catch((e) => e);
    expect(aiErrorKind(failure)).toBe("auth");
    expect((badKey as jest.Mock).mock.calls).toHaveLength(1);

    const plain400 = statuses(400);
    await expect(askModel(settings, [], plain400, 1000, 0)).rejects.toThrow("HTTP 400");
    expect((plain400 as jest.Mock).mock.calls).toHaveLength(1);
  });

  test("not for other errors", async () => {
    for (const status of [401, 403, 404, 500]) {
      const fetchImpl = statuses(status);
      await expect(askModel(settings, [], fetchImpl, 1000, 0)).rejects.toThrow(
        "HTTP " + status,
      );
      expect((fetchImpl as jest.Mock).mock.calls).toHaveLength(1);
    }
  });
});

describe("cloudSettings", () => {
  test("Gemini asks for minimal reasoning; the others do not", () => {
    const gemini = cloudSettings("gemini", {});
    expect(gemini).toMatchObject({
      protocol: "openai",
      baseUrl: kCloudProviders.gemini.baseUrl,
      model: kCloudProviders.gemini.model,
      isLocal: false,
      label: "Gemini",
      reasoningEffort: "minimal",
    });
    expect(cloudSettings("openai", {}).reasoningEffort).toBeUndefined();
    expect(cloudSettings("claude", {}).reasoningEffort).toBeUndefined();
  });

  test("uses the user's server, model and workspace when set", () => {
    expect(
      cloudSettings("claude", { model: "m", workspaceId: "wrkspc_1" }),
    ).toMatchObject({ protocol: "anthropic", model: "m", workspaceId: "wrkspc_1", label: "Claude" });
    expect(cloudSettings("custom", { baseUrl: "https://x/v1" })).toMatchObject({
      baseUrl: "https://x/v1",
      label: "雲端 AI",
    });
    expect(cloudSettings("nope", {}).label).toBe("雲端 AI");
  });
});

describe("anthropicMessages", () => {
  const reply = (body: unknown, ok = true, status = 200): FetchLike =>
    jest.fn(async () => ({ ok, status, json: async () => body }));

  test("posts to the Messages API with the system prompt apart", async () => {
    const fetchImpl = reply({ content: [{ type: "text", text: "記得帶傘" }] });
    const messages: ChatMessage[] = [
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ];
    await expect(anthropicMessages(claude, messages, fetchImpl)).resolves.toBe("記得帶傘");
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers.Authorization).toBe("Bearer sk-ant-test");
    expect(init.headers["anthropic-version"]).toBe(kAnthropicVersion);
    expect(init.headers["anthropic-workspace-id"]).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      model: "claude-haiku-5-5",
      max_tokens: 1024,
      system: "be brief",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  test("sends the workspace when there is one", async () => {
    const fetchImpl = reply({ content: [{ type: "text", text: "ok" }] });
    await anthropicMessages({ ...claude, workspaceId: "wrkspc_1" }, [], fetchImpl);
    expect((fetchImpl as jest.Mock).mock.calls[0][1].headers["anthropic-workspace-id"]).toBe(
      "wrkspc_1",
    );
  });

  test("fails on HTTP errors and answers without text", async () => {
    await expect(anthropicMessages(claude, [], reply({}, false, 401))).rejects.toThrow("HTTP 401");
    await expect(anthropicMessages(claude, [], reply({ content: [] }))).rejects.toThrow(
      "no answer",
    );
  });

  test("askModel picks the API by protocol", async () => {
    const anthropic = reply({ content: [{ type: "text", text: "A" }] });
    await expect(askModel(claude, [], anthropic)).resolves.toBe("A");
    expect((anthropic as jest.Mock).mock.calls[0][0]).toContain("/messages");
    const openai = answer("B");
    await expect(askModel(settings, [], openai)).resolves.toBe("B");
    expect((openai as jest.Mock).mock.calls[0][0]).toContain("/chat/completions");
  });

  test("offers Claude, OpenAI, Gemini and a custom server", () => {
    expect(Object.keys(kCloudProviders)).toEqual(["claude", "openai", "gemini", "custom"]);
    expect(kCloudProviders.gemini.baseUrl).toContain("generativelanguage.googleapis.com");
    expect(kCloudProviders.openai.protocol).toBe("openai");
  });
});

describe("prompts", () => {
  test("carry the text and its reading", () => {
    const messages = correctionPrompt("記得代傘", "ㄐㄧˋ ㄉㄜ˙ ㄉㄞˋ ㄙㄢˇ");
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("記得代傘");
    expect(messages[1].content).toContain("ㄐㄧˋ ㄉㄜ˙ ㄉㄞˋ ㄙㄢˇ");
    expect(explainPrompt("deadline")[1].content).toContain("deadline");
    expect(rewritePrompt("我覺得還好")[1].content).toContain("我覺得還好");
  });
});

describe("parseSuggestions", () => {
  test("reads one suggestion per line", () => {
    expect(
      parseSuggestions("1. 記得帶傘\n2、「記得帶傘喔」\n- 記得帶傘\n\n* 記得要帶傘"),
    ).toEqual(["記得帶傘", "記得帶傘喔", "記得要帶傘"]);
  });

  test("keeps at most five", () => {
    expect(parseSuggestions("a\nb\nc\nd\ne\nf\ng")).toHaveLength(5);
  });
});

describe("AiAssistant", () => {
  const ctrl = (keyCode: number): { keyCode: number; ctrl: boolean; shift: boolean; alt: boolean } => ({
    keyCode,
    ctrl: true,
    shift: false,
    alt: false,
  });
  const plain = (keyCode: number): { keyCode: number; ctrl: boolean; shift: boolean; alt: boolean } => ({
    keyCode,
    ctrl: false,
    shift: false,
    alt: false,
  });
  const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

  const makeHost = (
    overrides: Partial<AiHost> = {},
  ): { host: AiHost; shown: string[][]; asked: ChatMessage[][] } => {
    const shown: string[][] = [];
    const asked: ChatMessage[][] = [];
    const host: AiHost = {
      settingsFor: () => settings,
      composing: () => undefined,
      showSuggestions: (s) => {
        shown.push(s);
        return s.length > 0;
      },
      chat: async (_s, messages) => {
        asked.push(messages);
        return "記得帶傘\n記得帶傘喔";
      },
      ...overrides,
    };
    return { host, shown, asked };
  };

  test("does nothing while AI is off", () => {
    const { host } = makeHost({
      settingsFor: () => undefined,
      composing: () => ({ raw: "x", text: "x", readings: "x" }),
    });
    const ai = new AiAssistant(host);
    expect(ai.keyDown(ctrl(0x0d), 0)).toBeUndefined();
    expect(ai.rememberLookup("銀行", 0)).toBeUndefined();
  });

  test("Ctrl+Enter while composing suggests whole sentences", async () => {
    const composing = { raw: "ru42k7294n03", text: "記得代傘", readings: "ㄐㄧˋ ㄉㄜ˙ ㄉㄞˋ ㄙㄢˇ" };
    const { host, shown, asked } = makeHost({ composing: () => composing });
    const ai = new AiAssistant(host);
    const started = ai.keyDown(ctrl(0x0d), 0);
    expect(started?.fields.refreshAfter).toBeGreaterThan(0);
    expect(started?.fields.showMessage).toBeDefined();
    expect(asked[0][1].content).toContain("記得代傘");

    await flush();
    const done = ai.refresh(100);
    expect(shown).toEqual([["記得帶傘", "記得帶傘喔"]]);
    expect(done).toEqual({ fields: { hideMessage: true }, withUiState: true });
    expect(ai.refresh(200)).toEqual({ fields: {} });
  });

  test("keeps asking again until the answer is in, then gives up", () => {
    const { host } = makeHost({
      composing: () => ({ raw: "a", text: "a", readings: "a" }),
      chat: () => new Promise<string>(() => undefined),
    });
    const ai = new AiAssistant(host, 1000);
    ai.keyDown(ctrl(0x0d), 0);
    expect(ai.refresh(500).fields.refreshAfter).toBeGreaterThan(0);
    const timedOut = ai.refresh(2000);
    expect(JSON.stringify(timedOut.fields)).toContain("等太久沒回應");
  });

  test("drops suggestions if the user typed on", async () => {
    let raw = "su3";
    const { host, shown } = makeHost({
      composing: () => ({ raw, text: "你", readings: "ㄋㄧˇ" }),
    });
    const ai = new AiAssistant(host);
    ai.keyDown(ctrl(0x0d), 0);
    raw = "su3cl3";
    await flush();
    expect(ai.refresh(100)).toEqual({ fields: { hideMessage: true } });
    expect(shown).toEqual([]);
  });

  test("Ctrl+E after a lookup explains the selection", async () => {
    const { host, asked } = makeHost({ chat: async (_s, m) => (asked.push(m), "存放金錢的機構") });
    const ai = new AiAssistant(host);
    expect(ai.rememberLookup("銀行", 0)).toContain("Ctrl+E");
    const started = ai.keyDown(ctrl(0x45), 1000);
    expect(started?.fields.showLookup).toBeDefined();
    expect(asked[0][1].content).toContain("銀行");
    await flush();
    expect(ai.refresh(1100).fields.showLookup).toEqual({
      message: "銀行\n存放金錢的機構",
      duration: 30,
    });
  });

  test("Ctrl+R rewrites, and Enter puts the rewrite in place", async () => {
    const { host } = makeHost({ chat: async () => "我覺得還不錯" });
    const ai = new AiAssistant(host);
    ai.rememberLookup("我覺得還好", 0);
    ai.keyDown(ctrl(0x52), 10);
    await flush();
    const shown = ai.refresh(100).fields.showLookup as { message: string };
    expect(shown.message).toContain("我覺得還不錯");
    expect(shown.message).toContain("Enter");
    expect(ai.keyDown(plain(0x0d), 200)).toEqual({
      fields: { commitString: "我覺得還不錯", hideMessage: true },
    });
    // Only once.
    expect(ai.keyDown(plain(0x0d), 300)).toBeUndefined();
  });

  test("Esc or any other key drops the rewrite", async () => {
    const { host } = makeHost({ chat: async () => "改寫" });
    const ai = new AiAssistant(host);
    ai.rememberLookup("原文", 0);
    ai.keyDown(ctrl(0x52), 10);
    await flush();
    ai.refresh(100);
    expect(ai.keyDown(plain(0x1b), 200)).toEqual({ fields: { hideMessage: true } });

    ai.rememberLookup("原文", 300);
    ai.keyDown(ctrl(0x52), 310);
    await flush();
    ai.refresh(400);
    expect(ai.keyDown(plain(0x41), 500)).toBeUndefined();
    expect(ai.keyDown(plain(0x0d), 600)).toBeUndefined();
  });

  test("Ctrl+E and Ctrl+R only work right after a lookup", () => {
    const { host } = makeHost();
    const ai = new AiAssistant(host);
    expect(ai.keyDown(ctrl(0x45), 0)).toBeUndefined();
    ai.rememberLookup("銀行", 0);
    expect(ai.keyDown(ctrl(0x52), 60000)).toBeUndefined();
    expect(ai.keyDown({ ...ctrl(0x45), shift: true }, 10)).toBeUndefined();
  });

  test("tells the user when the model is not there", async () => {
    const { host } = makeHost({ chat: async () => Promise.reject(new Error("ECONNREFUSED")) });
    const ai = new AiAssistant(host);
    ai.rememberLookup("銀行", 0);
    ai.keyDown(ctrl(0x45), 10);
    await flush();
    expect(JSON.stringify(ai.refresh(100).fields)).toContain("Ollama");
  });

  test("each feature uses its own model", async () => {
    const used: AiSettings[] = [];
    const { host } = makeHost({
      settingsFor: (task: AiTask) => (task === "correct" ? settings : task === "explain" ? claude : undefined),
      chat: async (s) => (used.push(s), "答"),
    });
    const ai = new AiAssistant(host);
    // Only the features that have a model are offered.
    expect(ai.rememberLookup("銀行", 0)).toBe("Ctrl+E AI 解釋");
    expect(ai.keyDown(ctrl(0x52), 10)).toBeUndefined();
    ai.keyDown(ctrl(0x45), 10);
    await flush();
    ai.refresh(100);
    expect(used[0].isLocal).toBe(false);
  });

  describe("failure messages say what went wrong", () => {
    const gemini = cloudSettings("gemini", {});
    const failWith = async (error: Error, model: AiSettings = gemini): Promise<string> => {
      const { host } = makeHost({
        settingsFor: () => model,
        composing: () => ({ raw: "a", text: "a", readings: "a" }),
        showSuggestions: () => false,
        chat: async () => Promise.reject(error),
      });
      const ai = new AiAssistant(host);
      ai.keyDown(ctrl(0x0d), 0);
      await flush();
      return (ai.refresh(100).fields.showMessage as { message: string }).message;
    };

    test("busy", async () => {
      await expect(failWith(aiError("busy", "HTTP 503", 503))).resolves.toBe(
        "Gemini 忙線中，請稍後再試",
      );
      await expect(
        failWith(aiError("busy", "HTTP 429", 429), cloudSettings("custom", {})),
      ).resolves.toBe("雲端 AI 忙線中，請稍後再試");
    });

    test("too slow", async () => {
      await expect(failWith(aiError("timeout", "逾時"))).resolves.toBe("等太久沒回應");
      await expect(failWith(aiError("timeout", "逾時"), settings)).resolves.toBe(
        "等太久沒回應",
      );
    });

    test("only a refused key asks to check the key", async () => {
      for (const status of [401, 403]) {
        const message = await failWith(aiError("auth", "HTTP " + status, status));
        expect(message).toContain("金鑰");
        expect(message).toContain("HTTP " + status);
      }
      for (const error of [
        aiError("busy", "HTTP 503", 503),
        aiError("timeout", "逾時"),
        aiError("failed", "HTTP 404", 404),
        new Error("fetch failed"),
      ]) {
        expect(await failWith(error)).not.toContain("金鑰");
      }
    });

    test("other cloud errors give the reason", async () => {
      const message = await failWith(aiError("failed", "HTTP 404", 404));
      expect(message).toContain("Gemini");
      expect(message).toContain("HTTP 404");
      expect(message).not.toContain("Ollama");
    });

    test("no key yet", async () => {
      await expect(failWith(aiError("noKey", "還沒設定 API 金鑰"))).resolves.toContain(
        "還沒設定 API 金鑰",
      );
    });

    test("the local model points at Ollama", async () => {
      await expect(failWith(new Error("ECONNREFUSED"), settings)).resolves.toContain(
        "Ollama",
      );
    });
  });

  test("waits longer for the local model than for the cloud", () => {
    expect(timeoutFor(settings)).toBe(kLocalTimeoutMs);
    expect(timeoutFor(claude)).toBe(kCloudTimeoutMs);
    expect(kLocalTimeoutMs).toBeGreaterThan(kCloudTimeoutMs);

    const { host } = makeHost({
      composing: () => ({ raw: "a", text: "a", readings: "a" }),
      chat: () => new Promise<string>(() => undefined),
    });
    const ai = new AiAssistant(host);
    ai.keyDown(ctrl(0x0d), 0);
    // A cold local model may take most of a minute.
    expect(ai.refresh(kLocalTimeoutMs).fields.refreshAfter).toBeGreaterThan(0);
    expect(JSON.stringify(ai.refresh(kLocalTimeoutMs + 6000).fields)).toContain("等太久沒回應");
  });
});
