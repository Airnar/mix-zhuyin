/**
 * Imports user phrases exported from Microsoft Bopomofo (微軟注音).
 *
 * Two kinds of file are read:
 * - Text, as the User Phrase Tool (使用者造詞工具) exports it: a phrase and
 *   its reading on each line (`小確幸 ㄒㄧㄠˇ ㄑㄩㄝˋ ㄒㄧㄥˋ`), usually UTF-16.
 *   The reading may come first, may be left out, and our own `data.txt`
 *   format reads the same way.
 * - User-defined phrases (使用者定義的片語) exported as a `.dat` file, the
 *   binary `mschxudp` format Microsoft's Chinese IMEs share.
 *
 * Phrases without a usable reading are kept, and `mergeUserPhrases` asks the
 * dictionary for one.
 */
import fs from "fs";
import path from "path";

import { BopomofoSyllable } from "./Mandarin";

/** A phrase read from an exported file. */
export interface ImportedPhrase {
  /** The phrase, in Chinese characters. */
  phrase: string;
  /** Its reading, syllables joined by "-", when the file had one that fits. */
  reading?: string;
}

/** An entry of a Microsoft user-defined phrases file. */
export interface MsUserDefinedPhrase {
  /** What the user types: a reading or a shortcut. */
  code: string;
  /** The phrase it gives. */
  phrase: string;
}

const kInitial = 0;
const kMedial = 1;
const kFinal = 2;
const kTone = 3;

/** The part of a syllable a Bopomofo symbol is, or -1. */
const symbolRank = (ch: string): number => {
  const code = ch.charCodeAt(0);
  if (code >= 0x3105 && code <= 0x3119) {
    return kInitial; // ㄅ to ㄙ
  }
  if (code >= 0x3127 && code <= 0x3129) {
    return kMedial; // ㄧ ㄨ ㄩ
  }
  if (code >= 0x311a && code <= 0x3126) {
    return kFinal; // ㄚ to ㄦ
  }
  if ("ˉˊˇˋ˙".includes(ch)) {
    return kTone;
  }
  return -1;
};

/**
 * Splits Bopomofo text into syllables. Spaces and hyphens may separate them
 * but need not: a syllable ends at its tone mark, or where the next symbol
 * cannot follow the ones before it.
 * @param text The reading.
 * @returns Syllables as McBopomofo writes them (no first-tone mark, the
 *   neutral tone mark last), or undefined if the text is not only Bopomofo.
 */
export const splitBopomofo = (text: string): string[] | undefined => {
  const syllables: string[] = [];
  let current = "";
  let lastRank = -1;
  let neutralTone = false;
  const close = (): boolean => {
    if (current.length === 0) {
      return true;
    }
    const s = BopomofoSyllable.FromComposedString(
      current + (neutralTone ? "˙" : ""),
    ).composedString;
    if (s.length === 0 || symbolRank(s.charAt(0)) === kTone) {
      return false;
    }
    syllables.push(s);
    current = "";
    lastRank = -1;
    neutralTone = false;
    return true;
  };
  for (const ch of text.replace(/[\s\-]+/g, "")) {
    const rank = symbolRank(ch);
    if (rank < 0) {
      return undefined;
    }
    if (rank === kTone) {
      if (current.length === 0) {
        // A neutral tone mark is often written before its syllable.
        if (ch !== "˙" || neutralTone) {
          return undefined;
        }
        neutralTone = true;
        continue;
      }
      current += ch;
      if (!close()) {
        return undefined;
      }
      continue;
    }
    if (current.length > 0 && rank <= lastRank) {
      if (!close()) {
        return undefined;
      }
    }
    current += ch;
    lastRank = rank;
  }
  if (!close() || neutralTone || syllables.length === 0) {
    return undefined;
  }
  return syllables;
};

/**
 * Decodes an exported text file. Handles byte order marks, UTF-16 without
 * one (what Windows tools write), UTF-8 and, failing that, Big5.
 * @param buffer The file.
 * @returns Its text.
 */
export const decodeTextFile = (buffer: Buffer): string => {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return buffer.subarray(3).toString("utf8");
  }
  // UTF-16LE text has a zero high byte for every ASCII character, and
  // Bopomofo (U+31xx) and many hanzi have small high bytes too.
  if (buffer.length >= 2 && buffer.length % 2 === 0) {
    let zeros = 0;
    for (let i = 1; i < buffer.length; i += 2) {
      if (buffer[i] === 0) {
        zeros++;
      }
    }
    if (zeros * 4 >= buffer.length / 2) {
      return buffer.toString("utf16le");
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("big5").decode(buffer);
  }
};

const readUtf16z = (buffer: Buffer, start: number, end: number): string =>
  buffer
    .subarray(start, end)
    .toString("utf16le")
    .replace(/\0[\s\S]*$/, "");

/**
 * Reads a Microsoft user-defined phrases file (`mschxudp`, the `.dat` the
 * settings page exports).
 * @param buffer The file.
 * @returns The entries, or undefined if this is not such a file.
 */
export const parseMsUserDefinedPhrases = (
  buffer: Buffer,
): MsUserDefinedPhrase[] | undefined => {
  if (
    buffer.length < 0x40 ||
    buffer.toString("latin1", 0, 8) !== "mschxudp"
  ) {
    return undefined;
  }
  const offsetsStart = buffer.readUInt32LE(0x10);
  const recordsStart = buffer.readUInt32LE(0x14);
  const recordsEnd = Math.min(buffer.readUInt32LE(0x18), buffer.length);
  const count = buffer.readUInt32LE(0x1c);
  if (offsetsStart + 4 * count > buffer.length || recordsStart > recordsEnd) {
    return undefined;
  }
  const starts: number[] = [];
  for (let i = 0; i < count; i++) {
    starts.push(recordsStart + buffer.readUInt32LE(offsetsStart + 4 * i));
  }
  const entries: MsUserDefinedPhrase[] = [];
  for (let i = 0; i < count; i++) {
    const base = starts[i];
    const end = i + 1 < count ? starts[i + 1] : recordsEnd;
    if (base + 8 > end || end > recordsEnd) {
      return undefined;
    }
    // The low half of the record magic is the header size: 16 bytes since
    // Windows 10 1703, 8 before.
    const headerSize = buffer.readUInt16LE(base);
    const phraseAt = base + buffer.readUInt16LE(base + 4);
    if (headerSize < 8 || phraseAt < base + headerSize || phraseAt > end) {
      return undefined;
    }
    entries.push({
      code: readUtf16z(buffer, base + headerSize, phraseAt),
      phrase: readUtf16z(buffer, phraseAt, end),
    });
  }
  return entries;
};

/** Whether the text is only Chinese characters, as user phrases are. */
const isHanzi = (text: string): boolean => {
  const chars = Array.from(text);
  return (
    chars.length > 0 &&
    chars.length <= 16 &&
    chars.every((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return (
        ch === "〇" ||
        (code >= 0x3400 && code <= 0x9fff) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0x20000 && code <= 0x3ffff)
      );
    })
  );
};

/** The reading if it has one syllable per character of the phrase. */
const fittingReading = (
  phrase: string,
  syllables: string[] | undefined,
): string | undefined =>
  syllables && syllables.length === Array.from(phrase).length
    ? syllables.join("-")
    : undefined;

const toImported = (phrase: string, reading?: string): ImportedPhrase =>
  reading === undefined ? { phrase } : { phrase, reading };

/**
 * Reads the phrases out of an exported file of either kind.
 * @param buffer The file.
 * @returns The phrases, in file order. Lines and entries that have no
 *   Chinese phrase are skipped.
 */
export const parsePhraseFile = (buffer: Buffer): ImportedPhrase[] => {
  const result: ImportedPhrase[] = [];
  const udp = parseMsUserDefinedPhrases(buffer);
  if (udp) {
    for (const { code, phrase } of udp) {
      if (isHanzi(phrase)) {
        result.push(toImported(phrase, fittingReading(phrase, splitBopomofo(code))));
      }
    }
    return result;
  }
  for (const rawLine of decodeTextFile(buffer).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const tokens = line.split(/[\s,=]+/).filter((t) => t.length > 0);
    const phrase = tokens.find(isHanzi);
    if (phrase === undefined) {
      continue;
    }
    // Bopomofo tokens make up the reading. A tone mark may stand apart
    // (ㄩ ˋ), so the tokens are joined before splitting.
    const readingTokens = tokens.filter(
      (t) => t !== phrase && /^[\u3105-\u3129ˉˊˇˋ˙-]+$/.test(t),
    );
    const syllables =
      readingTokens.length > 0 ? splitBopomofo(readingTokens.join(" ")) : undefined;
    result.push(toImported(phrase, fittingReading(phrase, syllables)));
  }
  return result;
};

/** What `mergeUserPhrases` did. */
export interface MergeResult {
  /** The new user phrases file. */
  text: string;
  /** Phrases added. */
  added: number;
  /** Phrases already there, repeated, or with no reading to be found. */
  skipped: number;
}

/**
 * Adds imported phrases to the user phrases file (`data.txt`, one
 * `phrase reading` per line).
 * @param existing The file as it is.
 * @param phrases The imported phrases.
 * @param readingOf Looks up a reading for a phrase that came without one.
 * @returns The new file and counts.
 */
export const mergeUserPhrases = (
  existing: string,
  phrases: ImportedPhrase[],
  readingOf: (phrase: string) => string | undefined,
): MergeResult => {
  const known = new Set<string>();
  for (const line of existing.split(/\r?\n/)) {
    const parts = line.trim().split(" ");
    if (parts.length >= 2 && !parts[0].startsWith("#")) {
      known.add(parts[0] + " " + parts[1]);
    }
  }
  let text = existing;
  if (text.length > 0 && !text.endsWith("\n")) {
    text += "\n";
  }
  let added = 0;
  let skipped = 0;
  for (const { phrase, reading } of phrases) {
    const r = reading ?? readingOf(phrase);
    const line = phrase + " " + r;
    if (r === undefined || known.has(line)) {
      skipped++;
      continue;
    }
    known.add(line);
    text += line + "\n";
    added++;
  }
  return { text, added, skipped };
};

/** What `importPhraseFile` did. */
export interface ImportResult {
  /** Phrases found in the file. */
  found: number;
  /** Phrases added. */
  added: number;
  /** Phrases skipped (see `MergeResult.skipped`). */
  skipped: number;
}

/**
 * Adds the phrases of an exported file to the user phrases file, which the
 * input method reloads when it changes.
 * @param file The exported file.
 * @param userPhrasesFile `data.txt`; created if missing.
 * @param readingOf Looks up a reading for a phrase that came without one.
 * @returns Counts.
 */
export const importPhraseFile = (
  file: string,
  userPhrasesFile: string,
  readingOf: (phrase: string) => string | undefined,
): ImportResult => {
  const phrases = parsePhraseFile(fs.readFileSync(file));
  let existing = "";
  try {
    existing = fs.readFileSync(userPhrasesFile, "utf8");
  } catch {
    existing = "";
  }
  const merged = mergeUserPhrases(existing, phrases, readingOf);
  if (merged.added > 0) {
    fs.mkdirSync(path.dirname(userPhrasesFile), { recursive: true });
    fs.writeFileSync(userPhrasesFile, merged.text);
  }
  return { found: phrases.length, added: merged.added, skipped: merged.skipped };
};

/**
 * Tells the user what an import did.
 * @param result The counts.
 * @returns A message.
 */
export const importSummary = (result: ImportResult): string => {
  if (result.found === 0) {
    return "這個檔案裡沒有可以匯入的詞彙。\n請選微軟注音匯出的使用者詞彙檔（.txt 或 .dat）。";
  }
  let text = `已加入 ${result.added} 個詞到使用者詞庫。`;
  if (result.skipped > 0) {
    text += `\n略過 ${result.skipped} 個（詞庫裡已經有，或查不到注音）。`;
  }
  return text;
};
