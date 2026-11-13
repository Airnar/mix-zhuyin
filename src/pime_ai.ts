/**
 * AI help for the input method, from a model the user runs (Ollama on this
 * computer by default) through an OpenAI-compatible chat API. Off unless the
 * user turns it on, and only used when they press its keys:
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
  /** The OpenAI-compatible API root, e.g. http://localhost:11434/v1. */
  baseUrl: string;
  /** The model name, e.g. qwen2.5:7b. */
  model: string;
  /** Sent as a bearer token if not empty; Ollama needs none. */
  apiKey: string;
}

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: { [name: string]: string } = {
      "Content-Type": "application/json",
    };
    if (settings.apiKey) {
      headers.Authorization = "Bearer " + settings.apiKey;
    }
    const response = await fetchImpl(
      settings.baseUrl.replace(/\/+$/, "") + "/chat/completions",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: settings.model,
          messages,
          temperature: 0.3,
          stream: false,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("the model gave no answer");
    }
    // Reasoning models (Qwen3, DeepSeek-R1) think out loud first.
    return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  } finally {
    clearTimeout(timer);
  }
};

const kSystem =
  "你是台灣使用者的輸入法助手。一律使用台灣正體中文與台灣用語，回答要簡短，不要加任何說明或客套話。";

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

/** What the input method gives the assistant. */
export interface AiHost {
  /** Where the model is, or undefined while AI is off. */
  settings: () => AiSettings | undefined;
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

type AiTask = "correct" | "explain" | "rewrite";

interface Job {
  task: AiTask;
  startedAt: number;
  input: string;
  done: boolean;
  answer?: string;
  error?: string;
}

const VK_RETURN = 0x0d;
const VK_ESCAPE = 0x1b;
const VK_E = 0x45;
const VK_R = 0x52;

/** How long after a lookup Ctrl+E and Ctrl+R work. */
const kLookupWindowMs = 15000;
/** How often the text service asks again while the model thinks. */
const kPollMs = 300;
const kNoAnswer = "AI 沒有回應，請確認 Ollama 已經啟動，模型名稱也正確。";

/** Runs the AI features; see the file comment. */
export class AiAssistant {
  private job_: Job | undefined = undefined;
  private lookup_: { text: string; at: number } | undefined = undefined;
  private rewrite_: string | undefined = undefined;

  /**
   * @param host The input method.
   * @param timeoutMs How long to wait for an answer.
   */
  constructor(
    private readonly host: AiHost,
    private readonly timeoutMs = 30000,
  ) {}

  /**
   * Remembers text the user just looked up, for Ctrl+E and Ctrl+R.
   * @param text The selected text.
   * @param now The time in milliseconds.
   * @returns A hint for the lookup popup, or undefined while AI is off.
   */
  rememberLookup(text: string, now: number): string | undefined {
    if (!this.host.settings()) {
      return undefined;
    }
    this.lookup_ = { text, at: now };
    return "Ctrl+E AI 解釋　Ctrl+R AI 改寫";
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

    const settings = this.host.settings();
    if (!settings || !key.ctrl || key.alt || key.shift) {
      return undefined;
    }
    const composing = this.host.composing();
    if (key.keyCode === VK_RETURN && composing) {
      this.start_("correct", composing.raw, now, settings,
        correctionPrompt(composing.text, composing.readings));
      return {
        fields: {
          showMessage: { message: "AI 想想看…", duration: 30 },
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
      this.start_(explain ? "explain" : "rewrite", lookup.text, now, settings,
        explain ? explainPrompt(lookup.text) : rewritePrompt(lookup.text));
      return {
        fields: {
          showLookup: {
            message: explain ? "AI 解釋中…" : "AI 改寫中…",
            duration: 30,
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
      if (now - job.startedAt <= this.timeoutMs) {
        return { fields: { refreshAfter: kPollMs } };
      }
      job.done = true;
      job.error = "timeout";
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
            message: job.error ? kNoAnswer : "AI 沒有建議",
            duration: 5,
          },
        },
      };
    }

    if (job.error) {
      return { fields: { showLookup: { message: kNoAnswer, duration: 8 } } };
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
    const job: Job = { task, startedAt: now, input, done: false };
    this.job_ = job;
    this.rewrite_ = undefined;
    this.host.chat(settings, messages).then(
      (answer) => {
        job.answer = answer;
        job.done = true;
      },
      (e) => {
        job.error = String(e);
        job.done = true;
      },
    );
  }
}
