import fs from "fs";
import os from "os";
import path from "path";

import {
  DoubleCtrlDetector,
  englishStems,
  LookupDictionary,
  lookupMessage,
} from "./pime_lookup";

describe("DoubleCtrlDetector", () => {
  const tap = (d: DoubleCtrlDetector, at: number, held = 80): boolean => {
    d.keyDown(true, at);
    return d.keyUp(true, at + held);
  };

  test("fires on the second of two quick Ctrl taps", () => {
    const d = new DoubleCtrlDetector();
    expect(tap(d, 0)).toBe(false);
    expect(tap(d, 250)).toBe(true);
    // A third tap starts over.
    expect(tap(d, 500)).toBe(false);
  });

  test("ignores repeated key events for the same press", () => {
    const d = new DoubleCtrlDetector();
    d.keyDown(true, 0);
    d.keyDown(true, 30); // TSF filters a key twice
    expect(d.keyUp(true, 80)).toBe(false);
    expect(d.keyUp(true, 81)).toBe(false);
    d.keyDown(true, 200);
    expect(d.keyUp(true, 260)).toBe(true);
    expect(d.keyUp(true, 261)).toBe(false);
  });

  test("does not fire when taps are slow or Ctrl is held", () => {
    const d = new DoubleCtrlDetector();
    expect(tap(d, 0)).toBe(false);
    expect(tap(d, 900)).toBe(false); // too long after the first tap
    expect(tap(d, 1100, 600)).toBe(false); // held, not tapped
    expect(tap(d, 1900)).toBe(false);
  });

  test("another key in between is a shortcut, not a tap", () => {
    const d = new DoubleCtrlDetector();
    expect(tap(d, 0)).toBe(false);
    d.keyDown(true, 150);
    d.keyDown(false, 180); // Ctrl+C
    expect(d.keyUp(true, 220)).toBe(false);
    expect(tap(d, 300)).toBe(false);
    expect(tap(d, 450)).toBe(true);
  });
});

describe("lookupMessage", () => {
  const readings: { [text: string]: string } = {
    銀行: "ㄧㄣˊ-ㄏㄤˊ",
    銀: "ㄧㄣˊ",
    行: "ㄒㄧㄥˊ",
  };
  const deps = {
    readingOf: (text: string): string | undefined => readings[text],
    translate: (text: string): string[] | undefined =>
      ({ 銀行: ["bank"], bank: ["銀行", "河岸"] } as { [t: string]: string[] })[
        text.toLowerCase()
      ],
  };

  test("shows the reading and meaning of Chinese", () => {
    expect(lookupMessage("銀行", deps)).toBe("銀行　ㄧㄣˊ ㄏㄤˊ\nbank");
  });

  test("reads character by character when the phrase is not a word", () => {
    expect(lookupMessage(" 行銀 ", deps)).toBe("行銀　ㄒㄧㄥˊ ㄧㄣˊ");
  });

  test("marks characters it cannot read", () => {
    expect(lookupMessage("銀𠀾", deps)).toBe("銀𠀾　ㄧㄣˊ ？");
  });

  test("translates English", () => {
    expect(lookupMessage("Bank", deps)).toBe("Bank\n銀行；河岸");
  });

  test("says when it finds nothing", () => {
    expect(lookupMessage("zzzz", deps)).toBe("zzzz\n查不到這個字");
    expect(lookupMessage("   ", deps)).toBeUndefined();
  });

  test("shortens long selections", () => {
    const text = "銀".repeat(30);
    const message = lookupMessage(text, deps) ?? "";
    expect(message.startsWith("銀".repeat(20) + "…　")).toBe(true);
  });
});

describe("LookupDictionary", () => {
  const dictionary = new LookupDictionary({
    zh: { 銀行: ["bank"], 跑: ["to run", "to escape"] },
    en: { bank: ["銀行", "河岸"], run: ["跑"], study: ["學習"], constructor: ["構造器"] },
  });

  test("translates Chinese words and English words both ways", () => {
    expect(dictionary.translate("銀行")).toEqual(["bank"]);
    expect(dictionary.translate("Bank")).toEqual(["銀行", "河岸"]);
    expect(dictionary.translate("河岸")).toBeUndefined();
  });

  test("finds English words by their stem", () => {
    expect(dictionary.translate("banks")).toEqual(["銀行", "河岸"]);
    expect(dictionary.translate("running")).toEqual(["跑"]);
    expect(dictionary.translate("studies")).toEqual(["學習"]);
  });

  test("does not mistake object properties for words", () => {
    expect(dictionary.translate("toString")).toBeUndefined();
    expect(dictionary.translate("constructor")).toEqual(["構造器"]);
  });

  test("loads from a file, and is undefined if the file is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mixzhuyin-dict-"));
    const file = path.join(dir, "lookup_dict.json");
    expect(LookupDictionary.load(file)).toBeUndefined();
    fs.writeFileSync(file, JSON.stringify({ zh: { 銀: ["silver"] }, en: {} }));
    expect(LookupDictionary.load(file)?.translate("銀")).toEqual(["silver"]);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("englishStems", () => {
  test("strips common endings", () => {
    expect(englishStems("banks")).toContain("bank");
    expect(englishStems("boxes")).toContain("box");
    expect(englishStems("studies")).toContain("study");
    expect(englishStems("played")).toContain("play");
    expect(englishStems("liked")).toContain("like");
    expect(englishStems("running")).toContain("run");
    expect(englishStems("making")).toContain("make");
    expect(englishStems("cat")).toEqual([]);
  });
});
