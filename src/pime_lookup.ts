/**
 * 框選查詢: select text in any app and tap Ctrl twice to see how it reads
 * and what it means.
 *
 * The text service sends the selected text with Ctrl key ups
 * (`selectionText`); `DoubleCtrlDetector` spots the second tap, and
 * `lookupMessage` builds what the popup says, with readings from the
 * dictionary and meanings from `LookupDictionary` (CC-CEDICT).
 */
import fs from "fs";

/** Spots two quick taps of Ctrl with no other key in between. */
export class DoubleCtrlDetector {
  private downAt_: number | undefined = undefined;
  private lastTapAt_: number | undefined = undefined;

  /**
   * @param tapMs The longest Ctrl may be held for a tap.
   * @param gapMs The longest time between the two taps.
   */
  constructor(
    private readonly tapMs = 400,
    private readonly gapMs = 500,
  ) {}

  /**
   * Call on every key down.
   * @param isCtrl Whether the key is Ctrl.
   * @param now The time in milliseconds.
   */
  keyDown(isCtrl: boolean, now: number): void {
    if (!isCtrl) {
      // Ctrl with another key is a shortcut.
      this.downAt_ = undefined;
      this.lastTapAt_ = undefined;
      return;
    }
    // TSF may report the same key down twice; keep the first.
    if (this.downAt_ === undefined) {
      this.downAt_ = now;
    }
  }

  /**
   * Call on every key up.
   * @param isCtrl Whether the key is Ctrl.
   * @param now The time in milliseconds.
   * @returns True when this key up ends the second tap.
   */
  keyUp(isCtrl: boolean, now: number): boolean {
    if (!isCtrl || this.downAt_ === undefined) {
      return false;
    }
    const isTap = now - this.downAt_ <= this.tapMs;
    this.downAt_ = undefined;
    if (!isTap) {
      this.lastTapAt_ = undefined;
      return false;
    }
    if (this.lastTapAt_ !== undefined && now - this.lastTapAt_ <= this.gapMs) {
      this.lastTapAt_ = undefined;
      return true;
    }
    this.lastTapAt_ = now;
    return false;
  }
}

/** What a lookup uses. */
export interface LookupSources {
  /** The reading of Chinese text, syllables joined by "-". */
  readingOf: (text: string) => string | undefined;
  /** Meanings of a word or phrase, in the other language. */
  translate: (text: string) => string[] | undefined;
}

/** The longest selection looked up, in characters. */
const kMaxLength = 20;

const hasHanzi = (text: string): boolean =>
  /[㐀-鿿豈-﫿]|[\ud840-\ud8bf][\udc00-\udfff]/.test(text);

/**
 * Builds the lookup popup's text.
 * @param selection The selected text.
 * @param sources Readings and translations.
 * @returns The message, or undefined if there is nothing to look up.
 */
export const lookupMessage = (
  selection: string,
  sources: LookupSources,
): string | undefined => {
  const text = selection.replace(/\s+/g, " ").trim();
  if (text.length === 0) {
    return undefined;
  }
  const chars = Array.from(text);
  const shown =
    chars.length > kMaxLength ? chars.slice(0, kMaxLength).join("") + "…" : text;
  const lookedUp = chars.slice(0, kMaxLength).join("");
  const meanings = sources.translate(lookedUp);

  if (hasHanzi(lookedUp)) {
    const whole = sources.readingOf(lookedUp);
    const reading = whole
      ? whole.split("-").join(" ")
      : Array.from(lookedUp)
          .map((ch) => (/\s/.test(ch) ? "" : sources.readingOf(ch) ?? "？"))
          .filter((r) => r.length > 0)
          .join(" ");
    let message = shown + "　" + reading;
    if (meanings && meanings.length > 0) {
      message += "\n" + meanings.join("；");
    }
    return message;
  }

  if (meanings && meanings.length > 0) {
    return shown + "\n" + meanings.join("；");
  }
  return shown + "\n查不到這個字";
};

/** The data in `lookup_dict.json` (see tools/mixed/build_lookup_dict.py). */
export interface LookupDictionaryData {
  /** Traditional Chinese word to English meanings. */
  zh: { [word: string]: string[] };
  /** English word to Chinese words, most common first. */
  en: { [word: string]: string[] };
}

/**
 * Forms an English word may come from: banks → bank, studies → study,
 * running → run, making → make.
 * @param word A lowercase word.
 * @returns Possible stems, most likely first.
 */
export const englishStems = (word: string): string[] => {
  const stems: string[] = [];
  const add = (stem: string): void => {
    if (stem.length >= 2 && stem !== word && !stems.includes(stem)) {
      stems.push(stem);
    }
  };
  if (word.endsWith("ies")) {
    add(word.slice(0, -3) + "y");
  }
  if (word.endsWith("es")) {
    add(word.slice(0, -2));
  }
  if (word.endsWith("s") && !word.endsWith("ss")) {
    add(word.slice(0, -1));
  }
  for (const ending of ["ing", "ed"]) {
    if (word.endsWith(ending)) {
      const stem = word.slice(0, -ending.length);
      add(stem);
      add(stem + "e");
      // running → run
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
        add(stem.slice(0, -1));
      }
    }
  }
  return stems;
};

const own = (
  table: { [word: string]: string[] },
  key: string,
): string[] | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

/** Meanings for 框選查詢, Chinese to English and English to Chinese. */
export class LookupDictionary {
  /** @param data The dictionary data. */
  constructor(private readonly data: LookupDictionaryData) {}

  /**
   * Reads `lookup_dict.json`.
   * @param file The file.
   * @returns The dictionary, or undefined if the file is missing or broken.
   */
  static load(file: string): LookupDictionary | undefined {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data && typeof data.zh === "object" && typeof data.en === "object") {
        return new LookupDictionary(data);
      }
    } catch {
      // No dictionary: lookups show readings only.
    }
    return undefined;
  }

  /**
   * Meanings of a word or phrase in the other language.
   * @param text Chinese or English text.
   * @returns The meanings, or undefined if the dictionary does not have it.
   */
  translate(text: string): string[] | undefined {
    const trimmed = text.trim();
    if (hasHanzi(trimmed)) {
      return own(this.data.zh, trimmed);
    }
    const word = trimmed.toLowerCase().replace(/\s+/g, " ");
    for (const key of [word, ...englishStems(word)]) {
      const found = own(this.data.en, key);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
}
