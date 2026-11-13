/**
 * AI help for the input method. Off unless the user turns it on, and only
 * used when they press its keys. Each feature uses either the local model
 * (Ollama on this computer by default, OpenAI-compatible API) or the user's
 * own cloud AI (Claude, OpenAI, Gemini or any OpenAI-compatible server, with
 * their API key, which is stored encrypted):
 *
 * - Ctrl+Enter while composing: suggestions for the whole sentence, from
 *   what was typed and how it reads, in the candidate window.
 * - After 框選查詢 (select text, Ctrl twice), Ctrl+E: an explanation of the
 *   selection; Ctrl+R: a rewrite, which Enter puts in place of the selection.
 *
 * Answers arrive after the key, so the responses ask the text service to call
 * back (`refreshAfter`) until the answer is in.
 */

/** Where the model is. */
export interface AiSettings {
  /** The API's shape: OpenAI chat completions, or Anthropic messages. */
  protocol: "openai" | "anthropic";
  /** The API root, e.g. http://localhost:11434/v1. */
  baseUrl: string;
  /** The model name, e.g. qwen2.5:7b. */
  model: string;
  /** Sent as a bearer token if not empty; Ollama needs none. */
  apiKey: string;
  /** Whether the model runs on this computer (for error messages). */
  isLocal: boolean;
  /** Anthropic: the workspace, for keys not scoped to one. */
  workspaceId?: string;
  /** The service's name in messages, e.g. Gemini. */
  label?: string;
  /** OpenAI-shaped APIs: sent as `reasoning_effort`, e.g. minimal. */
  reasoningEffort?: string;
}

/** A cloud service the user can pick, and its defaults. */
export interface CloudProvider {
  /** The API's shape. */
  protocol: "openai" | "anthropic";
  /** The API root; empty for a custom server. */
  baseUrl: string;
  /** A small, fast model for typing help. */
  model: string;
  /** The service's name in messages. */
  label: string;
  /** How hard the model should think, if the service takes it. */
  reasoningEffort?: string;
}

/** The cloud services the settings page offers. */
export const kCloudProviders: { [id: string]: CloudProvider } = {
  claude: {
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-5-5",
    label: "Claude",
  },
  openai: {
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-6-luna",
    label: "OpenAI",
  },
  gemini: {
    protocol: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.8-flash",
    label: "Gemini",
    // Typing help needs a quick answer, not long thinking.
    reasoningEffort: "minimal",
  },
  custom: { protocol: "openai", baseUrl: "", model: "", label: "雲端 AI" },
};

/**
 * Where the user's cloud model is.
 * @param providerId The service the user picked (`ai_cloud_provider`).
 * @param custom The user's server, model and workspace; empty for defaults.
 * @returns The settings, without the API key.
 */
export const cloudSettings = (
  providerId: string,
  custom: { baseUrl?: string; model?: string; workspaceId?: string },
): AiSettings => {
  const provider = kCloudProviders[providerId] ?? kCloudProviders.custom;
  return {
    protocol: provider.protocol,
    baseUrl: custom.baseUrl || provider.baseUrl,
    model: custom.model || provider.model,
    apiKey: "",
    isLocal: false,
    label: provider.label,
    ...(provider.reasoningEffort
      ? { reasoningEffort: provider.reasoningEffort }
      : {}),
    ...(custom.workspaceId ? { workspaceId: custom.workspaceId } : {}),
  };
};

/**
 * Why a request failed: the service is busy (HTTP 429, 503), it took too
 * long, it refused the key (HTTP 401, 403), there is no key yet, or
 * something else.
 */
export type AiErrorKind = "busy" | "timeout" | "auth" | "noKey" | "failed";

/** An error from asking a model, with why it failed. */
export interface AiError extends Error {
  kind: AiErrorKind;
  /** The HTTP status, if the service answered. */
  status?: number;
}

/**
 * Makes an error that says why a request failed.
 * @param kind Why.
 * @param message For the user, e.g. "HTTP 503".
 * @param status The HTTP status, if any.
 * @returns The error.
 */
export const aiError = (
  kind: AiErrorKind,
  message: string,
  status?: number,
): AiError =>
  Object.assign(new Error(message), {
    kind,
    ...(status === undefined ? {} : { status }),
  });

/**
 * Why a request failed.
 * @param e What it threw.
 * @returns The kind; "failed" for errors without one (e.g. no network).
 */
export const aiErrorKind = (e: unknown): AiErrorKind => {
  const kind = (e as { kind?: unknown } | null)?.kind;
  return typeof kind === "string" ? (kind as AiErrorKind) : "failed";
};

/** How much of a service's error message to show. */
const kMaxDetailLength = 80;

/**
 * The error message in an error answer: `{error: {message}}` (OpenAI,
 * Anthropic) or the same in an array (Gemini).
 */
const errorDetail = (body: unknown): string => {
  const first = Array.isArray(body) ? body[0] : body;
  const error = (first as { error?: { message?: unknown } } | null)?.error;
  return typeof error?.message === "string" ? error.message.trim() : "";
};

/**
 * An HTTP error. Gemini answers a bad key with 400 (API_KEY_INVALID), so a
 * 400 that is about the key counts as a refused key too.
 */
const httpError = (status: number, body: unknown): AiError => {
  const detail = errorDetail(body);
  const aboutKey =
    status === 400 && /API_KEY_INVALID|API key/i.test(JSON.stringify(body) ?? "");
  const shown =
    detail.length > kMaxDetailLength
      ? detail.slice(0, kMaxDetailLength) + "…"
      : detail;
  return aiError(
    status === 429 || status === 503
      ? "busy"
      : status === 401 || status === 403 || aboutKey
        ? "auth"
        : "failed",
    "HTTP " + status + (shown ? "：" + shown : ""),
    status,
  );
};

/**
 * How long to wait for the local model: a cold Ollama model takes a while to
 * load before it answers, more so without a GPU.
 */
export const kLocalTimeoutMs = 60000;
/** How long to wait for a cloud service. */
export const kCloudTimeoutMs = 30000;

/**
 * How long to wait for a model.
 * @param settings Where the model is.
 * @returns Milliseconds.
 */
export const timeoutFor = (settings: AiSettings): number =>
  settings.isLocal ? kLocalTimeoutMs : kCloudTimeoutMs;

/** The Anthropic API version the client speaks. */
export const kAnthropicVersion = "2026-10-21";

/** Ollama's OpenAI-compatible API on this computer. */
export const kDefaultAiBaseUrl = "http://localhost:11434/v1";
/** A small model that knows Traditional Chinese well. */
export const kDefaultAiModel = "qwen2.5:7b";

/** One chat message. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The fetch function the client needs (the global one in Node 18+). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: { [name: string]: string };
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Posts JSON and reads the JSON answer, within a time limit. HTTP errors and
 * running out of time become `AiError`s.
 */
const postJson = async (
  url: string,
  headers: { [name: string]: string },
  body: unknown,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      let body: unknown = undefined;
      try {
        body = await response.json();
      } catch {
        // Not JSON (e.g. a proxy's HTML page): the status will do.
      }
      throw httpError(response.status, body);
    }
    return await response.json();
  } catch (e) {
    if (controller.signal.aborted) {
      throw aiError("timeout", "逾時");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Asks the model once.
 * @param settings Where the model is.
 * @param messages The conversation.
 * @param fetchImpl The fetch function.
 * @param timeoutMs Give up after this long.
 * @returns The answer, without any reasoning block.
 */
export const chatCompletion = async (
  settings: AiSettings,
  messages: ChatMessage[],
  fetchImpl: FetchLike,
  timeoutMs = 30000,
): Promise<string> => {
  const data = (await postJson(
    settings.baseUrl.replace(/\/+$/, "") + "/chat/completions",
    settings.apiKey ? { Authorization: "Bearer " + settings.apiKey } : {},
    {
      model: settings.model,
      messages,
      temperature: 0.3,
      stream: false,
      ...(settings.reasoningEffort
        ? { reasoning_effort: settings.reasoningEffort }
        : {}),
    },
    fetchImpl,
    timeoutMs,
  )) as { choices?: { message?: { content?: unknown } }[] };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("the model gave no answer");
  }
  // Reasoning models (Qwen3, DeepSeek-R1) think out loud first.
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
};

const kSystem =
  "你是台灣使用者的輸入法助手。一律使用台灣正體中文與台灣用語，回答要簡短，不要加任何說明或客套話。";

/**
 * Asks Claude once, with the Anthropic Messages API.
 * @param settings Where the model is.
 * @param messages The conversation; system messages become the system prompt.
 * @param fetchImpl The fetch function.
 * @param timeoutMs Give up after this long.
 * @returns The answer's text.
 */
export const anthropicMessages = async (
  settings: AiSettings,
  messages: ChatMessage[],
  fetchImpl: FetchLike,
  timeoutMs = 30000,
): Promise<string> => {
  const headers: { [name: string]: string } = {
    Authorization: "Bearer " + settings.apiKey,
    "anthropic-version": kAnthropicVersion,
  };
  if (settings.workspaceId) {
    headers["anthropic-workspace-id"] = settings.workspaceId;
  }
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const data = (await postJson(
    settings.baseUrl.replace(/\/+$/, "") + "/messages",
    headers,
    {
      model: settings.model,
      max_tokens: 1024,
      ...(system ? { system } : {}),
      messages: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
    },
    fetchImpl,
    timeoutMs,
  )) as { content?: { type?: string; text?: unknown }[] };
  const text = (data?.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  if (!text) {
    throw new Error("the model gave no answer");
  }
  return text.trim();
};

/** How long to wait before asking a busy service again. */
export const kRetryDelayMs = 1000;

/**
 * What to ask with the second time, or undefined not to ask again: the same
 * after a busy answer, and without `reasoning_effort` if the request was
 * refused (HTTP 400, not about the key), as some models do not take it.
 */
const retrySettings = (
  e: unknown,
  settings: AiSettings,
): AiSettings | undefined => {
  const kind = aiErrorKind(e);
  if (kind === "busy") {
    return settings;
  }
  if (
    kind === "failed" &&
    (e as AiError).status === 400 &&
    settings.reasoningEffort
  ) {
    const { reasoningEffort: _dropped, ...rest } = settings;
    return rest;
  }
  return undefined;
};

/**
 * Asks the model, in the API shape its settings say. If the service is busy
 * (HTTP 429 or 503), asks once more after a short wait; if it refuses the
 * request with `reasoning_effort` (HTTP 400), asks once more without it.
 * Both tries share one time limit.
 * @param settings Where the model is.
 * @param messages The conversation.
 * @param fetchImpl The fetch function.
 * @param timeoutMs Give up after this long, both tries together.
 * @param retryDelayMs How long to wait before the second try.
 * @returns The answer.
 */
export const askModel = async (
  settings: AiSettings,
  messages: ChatMessage[],
  fetchImpl: FetchLike,
  timeoutMs = timeoutFor(settings),
  retryDelayMs = kRetryDelayMs,
): Promise<string> => {
  const ask = (s: AiSettings, ms: number): Promise<string> =>
    s.protocol === "anthropic"
      ? anthropicMessages(s, messages, fetchImpl, ms)
      : chatCompletion(s, messages, fetchImpl, ms);
  const deadline = Date.now() + timeoutMs;
  try {
    return await ask(settings, timeoutMs);
  } catch (e) {
    const again = retrySettings(e, settings);
    if (!again) {
      throw e;
    }
    if (aiErrorKind(e) === "busy") {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      throw e;
    }
    return ask(again, left);
  }
};

/**
 * The prompt for Ctrl+Enter.
 * @param text What the input method shows now.
 * @param readings How it reads (Bopomofo, English as typed).
 * @returns The messages.
 */
export const correctionPrompt = (
  text: string,
  readings: string,
): ChatMessage[] => [
  { role: "system", content: kSystem },
  {
    role: "user",
    content:
      "使用者用注音輸入法打字，中英文混打。\n" +
      `輸入法目前的結果：${text}\n` +
      `打的讀音：${readings}\n` +
      "請依讀音和語意，寫出使用者最可能想打的整句，給三個不同的版本，每行一句，不要編號。讀音要相符，英文照打的保留。",
  },
];

/**
 * The prompt for Ctrl+E after a lookup.
 * @param text The selected text.
 * @returns The messages.
 */
export const explainPrompt = (text: string): ChatMessage[] => [
  { role: "system", content: kSystem },
  {
    role: "user",
    content:
      "請用兩三句話解釋下面這段文字的意思；如果是英文或其他語言，先給中文翻譯。\n\n" +
      text,
  },
];

/**
 * The prompt for Ctrl+R after a lookup.
 * @param text The selected text.
 * @returns The messages.
 */
export const rewritePrompt = (text: string): ChatMessage[] => [
  { role: "system", content: kSystem },
  {
    role: "user",
    content:
      "請把下面這段文字改寫得更通順自然，保持原意和語氣，只輸出改寫後的文字。\n\n" +
      text,
  },
];

/**
 * Reads sentence suggestions out of an answer: one per line, without
 * numbering, bullets or quotes, no repeats, at most five.
 * @param answer The model's answer.
 * @returns The suggestions.
 */
export const parseSuggestions = (answer: string): string[] => {
  const out: string[] = [];
  for (const raw of answer.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(?:\d+[.、)）]|[-*•])\s*/, "")
      .trim()
      .replace(/^[「『"“](.*)[」』"”]$/, "$1")
      .trim();
    if (line.length > 0 && !out.includes(line)) {
      out.push(line);
    }
  }
  return out.slice(0, 5);
};

/** The AI features, each of which may use the local or the cloud model. */
export type AiTask = "correct" | "explain" | "rewrite";

/** What the input method gives the assistant. */
export interface AiHost {
  /** Where the model for a feature is, or undefined while AI is off. */
  settingsFor: (task: AiTask) => AiSettings | undefined;
  /** What mixed mode is composing, or undefined. */
  composing: () => { raw: string; text: string; readings: string } | undefined;
  /** Shows suggestions in the candidate window; false if it cannot. */
  showSuggestions: (sentences: string[]) => boolean;
  /** Asks the model. */
  chat: (settings: AiSettings, messages: ChatMessage[]) => Promise<string>;
}

/** Fields of a PIME response, plus whether to add the input method's UI. */
export interface AiResponse {
  fields: { [name: string]: unknown };
  /** Merge the input controller's UI state (composition, candidates). */
  withUiState?: boolean;
}

/** A key, as the assistant needs it. */
export interface AiKey {
  keyCode: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

interface Job {
  task: AiTask;
  isLocal: boolean;
  /** The service's name in messages. */
  label: string;
  timeoutMs: number;
  startedAt: number;
  input: string;
  done: boolean;
  answer?: string;
  error?: string;
  errorKind?: AiErrorKind;
}

const VK_RETURN = 0x0d;
const VK_ESCAPE = 0x1b;
const VK_E = 0x45;
const VK_R = 0x52;

/** How long after a lookup Ctrl+E and Ctrl+R work. */
const kLookupWindowMs = 15000;
/** How often the text service asks again while the model thinks. */
const kPollMs = 300;
const kNoLocalAnswer = "本機 AI 沒有回應，請確認 Ollama 已經啟動，模型名稱也正確。";

/**
 * What to tell the user when a job failed. Only a refused key (HTTP 401,
 * 403) or a missing one asks the user to look at the key.
 */
const failureMessage = (job: Job): string => {
  switch (job.errorKind) {
    case "busy":
      return job.label + " 忙線中，請稍後再試";
    case "timeout":
      return "等太久沒回應";
    case "auth":
      return (
        job.label + " 不接受這把 API 金鑰（" + job.error + "），請到偏好設定檢查金鑰。"
      );
    case "noKey":
      return "還沒設定 API 金鑰，請到偏好設定的「雲端 AI」貼上金鑰。";
  }
  return job.isLocal
    ? kNoLocalAnswer
    : job.label + " 沒有回應（" + (job.error ?? "") + "），請確認模型名稱和網路。";
};

/** Runs the AI features; see the file comment. */
export class AiAssistant {
  private job_: Job | undefined = undefined;
  private lookup_: { text: string; at: number } | undefined = undefined;
  private rewrite_: string | undefined = undefined;

  /**
   * @param host The input method.
   * @param timeoutMs How long to wait for an answer; by default a little
   *   longer than the request itself may take (`timeoutFor`).
   */
  constructor(
    private readonly host: AiHost,
    private readonly timeoutMs?: number,
  ) {}

  /**
   * Remembers text the user just looked up, for Ctrl+E and Ctrl+R.
   * @param text The selected text.
   * @param now The time in milliseconds.
   * @returns A hint for the lookup popup, or undefined while AI is off.
   */
  rememberLookup(text: string, now: number): string | undefined {
    const hints: string[] = [];
    if (this.host.settingsFor("explain")) {
      hints.push("Ctrl+E AI 解釋");
    }
    if (this.host.settingsFor("rewrite")) {
      hints.push("Ctrl+R AI 改寫");
    }
    if (hints.length === 0) {
      return undefined;
    }
    this.lookup_ = { text, at: now };
    return hints.join("　");
  }

  /**
   * Call on every key down that is not part of a composition key. Returns
   * what to answer if the key is for the assistant (the caller claims it),
   * or undefined.
   * @param key The key.
   * @param now The time in milliseconds.
   */
  keyDown(key: AiKey, now: number): AiResponse | undefined {
    if (this.rewrite_ !== undefined && !this.host.composing()) {
      const plain = !key.ctrl && !key.shift && !key.alt;
      if (key.keyCode === VK_RETURN && plain) {
        const text = this.rewrite_;
        this.rewrite_ = undefined;
        return { fields: { commitString: text, hideMessage: true } };
      }
      if (key.keyCode === VK_ESCAPE) {
        this.rewrite_ = undefined;
        return { fields: { hideMessage: true } };
      }
      this.rewrite_ = undefined;
    }

    if (!key.ctrl || key.alt || key.shift) {
      return undefined;
    }
    const composing = this.host.composing();
    const correct = this.host.settingsFor("correct");
    if (key.keyCode === VK_RETURN && composing && correct) {
      this.start_("correct", composing.raw, now, correct,
        correctionPrompt(composing.text, composing.readings));
      return {
        fields: {
          showMessage: { message: "AI 想想看…", duration: 60 },
          refreshAfter: kPollMs,
        },
      };
    }
    const lookup = this.lookup_;
    if (composing || !lookup || now - lookup.at > kLookupWindowMs) {
      return undefined;
    }
    if (key.keyCode === VK_E || key.keyCode === VK_R) {
      const explain = key.keyCode === VK_E;
      const settings = this.host.settingsFor(explain ? "explain" : "rewrite");
      if (!settings) {
        return undefined;
      }
      this.start_(explain ? "explain" : "rewrite", lookup.text, now, settings,
        explain ? explainPrompt(lookup.text) : rewritePrompt(lookup.text));
      return {
        fields: {
          showLookup: {
            message: explain ? "AI 解釋中…" : "AI 改寫中…",
            duration: 60,
          },
          refreshAfter: kPollMs,
        },
      };
    }
    return undefined;
  }

  /**
   * Call when the text service asks again (`onRefresh`).
   * @param now The time in milliseconds.
   */
  refresh(now: number): AiResponse {
    const job = this.job_;
    if (!job) {
      return { fields: {} };
    }
    if (!job.done) {
      if (now - job.startedAt <= job.timeoutMs) {
        return { fields: { refreshAfter: kPollMs } };
      }
      job.done = true;
      job.error = "逾時";
      job.errorKind = "timeout";
    }
    this.job_ = undefined;

    if (job.task === "correct") {
      // Typing on while the model thought makes the answer stale.
      if (this.host.composing()?.raw !== job.input) {
        return { fields: { hideMessage: true } };
      }
      const suggestions = job.error ? [] : parseSuggestions(job.answer ?? "");
      if (this.host.showSuggestions(suggestions)) {
        return { fields: { hideMessage: true }, withUiState: true };
      }
      return {
        fields: {
          showMessage: {
            message: job.error ? failureMessage(job) : "AI 沒有建議",
            duration: 5,
          },
        },
      };
    }

    if (job.error) {
      return {
        fields: { showLookup: { message: failureMessage(job), duration: 8 } },
      };
    }
    const answer = (job.answer ?? "").trim();
    if (job.task === "explain") {
      return {
        fields: {
          showLookup: { message: job.input + "\n" + answer, duration: 30 },
        },
      };
    }
    this.rewrite_ = answer;
    return {
      fields: {
        showLookup: {
          message: answer + "\n\nEnter 取代選取的文字　Esc 取消",
          duration: 30,
        },
      },
    };
  }

  private start_(
    task: AiTask,
    input: string,
    now: number,
    settings: AiSettings,
    messages: ChatMessage[],
  ): void {
    const job: Job = {
      task,
      isLocal: settings.isLocal,
      label: settings.label ?? (settings.isLocal ? "本機 AI" : "雲端 AI"),
      // A busy service gets a second try within the request's time limit.
      timeoutMs: this.timeoutMs ?? timeoutFor(settings) + 5000,
      startedAt: now,
      input,
      done: false,
    };
    this.job_ = job;
    this.rewrite_ = undefined;
    this.host.chat(settings, messages).then(
      (answer) => {
        job.answer = answer;
        job.done = true;
      },
      (e) => {
        job.error = e instanceof Error ? e.message : String(e);
        job.errorKind = aiErrorKind(e);
        job.done = true;
      },
    );
  }
}
