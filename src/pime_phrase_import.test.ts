import fs from "fs";
import os from "os";
import path from "path";

import {
  decodeTextFile,
  importPhraseFile,
  importSummary,
  mergeUserPhrases,
  parseMsUserDefinedPhrases,
  parsePhraseFile,
  splitBopomofo,
} from "./pime_phrase_import";

/** Builds a mschxudp file (Microsoft IME user-defined phrases). */
const buildUdp = (entries: { code: string; phrase: string }[]): Buffer => {
  const records = entries.map(({ code, phrase }) => {
    const codeBytes = Buffer.from(code + "\0", "utf16le");
    const phraseBytes = Buffer.from(phrase + "\0", "utf16le");
    const head = Buffer.alloc(16);
    head.writeUInt32LE(0x00100010, 0);
    head.writeUInt16LE(0x10 + codeBytes.length, 4);
    head.writeUInt8(1, 6);
    head.writeUInt8(6, 7);
    return Buffer.concat([head, codeBytes, phraseBytes]);
  });
  const start = 0x40 + 4 * entries.length;
  const offsets = Buffer.alloc(4 * entries.length);
  let at = 0;
  records.forEach((r, i) => {
    offsets.writeUInt32LE(at, 4 * i);
    at += r.length;
  });
  const header = Buffer.alloc(0x40);
  header.write("mschxudp", 0, "ascii");
  header.writeUInt32LE(0x00600002, 0x08);
  header.writeUInt32LE(1, 0x0c);
  header.writeUInt32LE(0x40, 0x10);
  header.writeUInt32LE(start, 0x14);
  header.writeUInt32LE(start + at, 0x18);
  header.writeUInt32LE(entries.length, 0x1c);
  return Buffer.concat([header, offsets, ...records]);
};

describe("importing Microsoft Bopomofo phrases", () => {
  describe("splitBopomofo", () => {
    test("splits readings with or without spaces", () => {
      expect(splitBopomofo("ㄒㄧㄠˇ ㄑㄩㄝˋ ㄒㄧㄥˋ")).toEqual(["ㄒㄧㄠˇ", "ㄑㄩㄝˋ", "ㄒㄧㄥˋ"]);
      expect(splitBopomofo("ㄒㄧㄠˇㄑㄩㄝˋㄒㄧㄥˋ")).toEqual(["ㄒㄧㄠˇ", "ㄑㄩㄝˋ", "ㄒㄧㄥˋ"]);
      expect(splitBopomofo("ㄒㄧㄠˇ-ㄇㄞˋ")).toEqual(["ㄒㄧㄠˇ", "ㄇㄞˋ"]);
    });

    test("tells first-tone syllables apart without marks", () => {
      expect(splitBopomofo("ㄊㄧㄢㄎㄨㄥ")).toEqual(["ㄊㄧㄢ", "ㄎㄨㄥ"]);
      expect(splitBopomofo("ㄊㄧㄢˉㄎㄨㄥˉ")).toEqual(["ㄊㄧㄢ", "ㄎㄨㄥ"]);
    });

    test("puts a leading neutral tone mark after its syllable", () => {
      expect(splitBopomofo("ㄏㄠˇ ˙ㄉㄜ")).toEqual(["ㄏㄠˇ", "ㄉㄜ˙"]);
    });

    test("reads a tone mark set apart by a space", () => {
      expect(splitBopomofo("ㄍㄨㄛˋ ㄩ ˋ")).toEqual(["ㄍㄨㄛˋ", "ㄩˋ"]);
    });

    test("is not a reading if anything else is in it", () => {
      expect(splitBopomofo("ㄅㄚ a")).toBeUndefined();
      expect(splitBopomofo("ˇ")).toBeUndefined();
      expect(splitBopomofo("")).toBeUndefined();
    });
  });

  describe("decodeTextFile", () => {
    test("reads UTF-16 with a byte order mark", () => {
      const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("小確幸", "utf16le")]);
      expect(decodeTextFile(le)).toBe("小確幸");
      const be = Buffer.from(le);
      be.swap16();
      expect(decodeTextFile(be)).toBe("小確幸");
    });

    test("reads UTF-8 with or without a byte order mark", () => {
      expect(decodeTextFile(Buffer.from("﻿小確幸", "utf8"))).toBe("小確幸");
      expect(decodeTextFile(Buffer.from("小確幸", "utf8"))).toBe("小確幸");
    });

    test("reads UTF-16 without a byte order mark", () => {
      expect(decodeTextFile(Buffer.from("小確幸 ㄒㄧㄠˇ\r\n", "utf16le"))).toBe("小確幸 ㄒㄧㄠˇ\r\n");
    });

    test("falls back to Big5", () => {
      // 中文 in Big5.
      expect(decodeTextFile(Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]))).toBe("中文");
    });
  });

  describe("parseMsUserDefinedPhrases", () => {
    test("reads the codes and phrases", () => {
      const file = buildUdp([
        { code: "ㄒㄧㄠˇㄑㄩㄝˋㄒㄧㄥˋ", phrase: "小確幸" },
        { code: "addr", phrase: "台北市" },
      ]);
      expect(parseMsUserDefinedPhrases(file)).toEqual([
        { code: "ㄒㄧㄠˇㄑㄩㄝˋㄒㄧㄥˋ", phrase: "小確幸" },
        { code: "addr", phrase: "台北市" },
      ]);
    });

    test("is undefined for other files", () => {
      expect(parseMsUserDefinedPhrases(Buffer.from("小確幸", "utf8"))).toBeUndefined();
      const broken = buildUdp([{ code: "a", phrase: "台" }]).subarray(0, 0x44);
      expect(parseMsUserDefinedPhrases(broken)).toBeUndefined();
    });
  });

  describe("parsePhraseFile", () => {
    test("reads the User Phrase Tool export: phrase then reading", () => {
      const text = "小確幸 ㄒㄧㄠˇ ㄑㄩㄝˋ ㄒㄧㄥˋ\r\n過譽 ㄍㄨㄛˋ ㄩ ˋ\r\n";
      expect(parsePhraseFile(Buffer.from("﻿" + text, "utf16le"))).toEqual([
        { phrase: "小確幸", reading: "ㄒㄧㄠˇ-ㄑㄩㄝˋ-ㄒㄧㄥˋ" },
        { phrase: "過譽", reading: "ㄍㄨㄛˋ-ㄩˋ" },
      ]);
    });

    test("reads the reading first, tabs and our own format too", () => {
      const text = "ㄊㄧㄢ ㄎㄨㄥ\t天空\n小麥注音 ㄒㄧㄠˇ-ㄇㄞˋ-ㄓㄨˋ-ㄧㄣ\n";
      expect(parsePhraseFile(Buffer.from(text, "utf8"))).toEqual([
        { phrase: "天空", reading: "ㄊㄧㄢ-ㄎㄨㄥ" },
        { phrase: "小麥注音", reading: "ㄒㄧㄠˇ-ㄇㄞˋ-ㄓㄨˋ-ㄧㄣ" },
      ]);
    });

    test("leaves the reading out when it is missing or does not fit", () => {
      const text = "王小明\n台積電 ㄊㄞˊ\n";
      expect(parsePhraseFile(Buffer.from(text, "utf8"))).toEqual([
        { phrase: "王小明" },
        { phrase: "台積電" },
      ]);
    });

    test("skips comments and lines without Chinese", () => {
      const text = "# 註解\n; 註解\nhello world\n\n";
      expect(parsePhraseFile(Buffer.from(text, "utf8"))).toEqual([]);
    });

    test("ignores a shortcut code before the phrase", () => {
      const text = "addr 台北市\n";
      expect(parsePhraseFile(Buffer.from(text, "utf8"))).toEqual([
        { phrase: "台北市" },
      ]);
    });

    test("reads exported user-defined phrases", () => {
      const file = buildUdp([
        { code: "ㄒㄧㄠˇㄑㄩㄝˋㄒㄧㄥˋ", phrase: "小確幸" },
        { code: "addr", phrase: "台北市" },
        { code: "sig", phrase: "Best regards" },
      ]);
      expect(parsePhraseFile(file)).toEqual([
        { phrase: "小確幸", reading: "ㄒㄧㄠˇ-ㄑㄩㄝˋ-ㄒㄧㄥˋ" },
        { phrase: "台北市" },
      ]);
    });
  });

  describe("mergeUserPhrases", () => {
    const readingOf = (phrase: string): string | undefined =>
      ({ 王小明: "ㄨㄤˊ-ㄒㄧㄠˇ-ㄇㄧㄥˊ" } as { [p: string]: string })[phrase];

    test("appends new phrases and works out missing readings", () => {
      const result = mergeUserPhrases(
        "# 說明\n小麥注音 ㄒㄧㄠˇ-ㄇㄞˋ-ㄓㄨˋ-ㄧㄣ",
        [{ phrase: "王小明" }, { phrase: "小確幸", reading: "ㄒㄧㄠˇ-ㄑㄩㄝˋ-ㄒㄧㄥˋ" }],
        readingOf,
      );
      expect(result.text).toBe(
        "# 說明\n小麥注音 ㄒㄧㄠˇ-ㄇㄞˋ-ㄓㄨˋ-ㄧㄣ\n王小明 ㄨㄤˊ-ㄒㄧㄠˇ-ㄇㄧㄥˊ\n小確幸 ㄒㄧㄠˇ-ㄑㄩㄝˋ-ㄒㄧㄥˋ\n",
      );
      expect(result.added).toBe(2);
      expect(result.skipped).toBe(0);
    });

    test("skips phrases it already has or cannot read", () => {
      const result = mergeUserPhrases(
        "小確幸 ㄒㄧㄠˇ-ㄑㄩㄝˋ-ㄒㄧㄥˋ\n",
        [
          { phrase: "小確幸", reading: "ㄒㄧㄠˇ-ㄑㄩㄝˋ-ㄒㄧㄥˋ" },
          { phrase: "王小明", reading: "ㄨㄤˊ-ㄒㄧㄠˇ-ㄇㄧㄥˊ" },
          { phrase: "王小明", reading: "ㄨㄤˊ-ㄒㄧㄠˇ-ㄇㄧㄥˊ" },
          { phrase: "𠀾" },
        ],
        readingOf,
      );
      expect(result.text).toBe("小確幸 ㄒㄧㄠˇ-ㄑㄩㄝˋ-ㄒㄧㄥˋ\n王小明 ㄨㄤˊ-ㄒㄧㄠˇ-ㄇㄧㄥˊ\n");
      expect(result.added).toBe(1);
      expect(result.skipped).toBe(3);
    });
  });

  describe("importPhraseFile", () => {
    test("adds the file's phrases to the user phrases file", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mixzhuyin-import-"));
      const exported = path.join(dir, "export.txt");
      const userPhrases = path.join(dir, "MixZhuyin", "data.txt");
      fs.writeFileSync(exported, Buffer.from("\ufeff小確幸 ㄒㄧㄠˇ ㄑㄩㄝˋ ㄒㄧㄥˋ\r\n", "utf16le"));

      const result = importPhraseFile(exported, userPhrases, () => undefined);
      expect(result).toEqual({ found: 1, added: 1, skipped: 0 });
      expect(fs.readFileSync(userPhrases, "utf8")).toBe("小確幸 ㄒㄧㄠˇ-ㄑㄩㄝˋ-ㄒㄧㄥˋ\n");

      // Importing again adds nothing and leaves the file alone.
      expect(importPhraseFile(exported, userPhrases, () => undefined)).toEqual({
        found: 1,
        added: 0,
        skipped: 1,
      });
      fs.rmSync(dir, { recursive: true });
    });
  });

  describe("importSummary", () => {
    test("says what was added and skipped", () => {
      expect(importSummary({ found: 3, added: 2, skipped: 1 })).toBe(
        "已加入 2 個詞到使用者詞庫。\n略過 1 個（詞庫裡已經有，或查不到注音）。",
      );
      expect(importSummary({ found: 2, added: 2, skipped: 0 })).toBe(
        "已加入 2 個詞到使用者詞庫。",
      );
    });

    test("says when the file has no phrases", () => {
      expect(importSummary({ found: 0, added: 0, skipped: 0 })).toBe(
        "這個檔案裡沒有可以匯入的詞彙。\n請選微軟注音匯出的使用者詞彙檔（.txt 或 .dat）。",
      );
    });
  });
});
