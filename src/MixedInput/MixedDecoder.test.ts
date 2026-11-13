/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

import { BopomofoKeyboardLayout } from "../Mandarin";
import { webData } from "../McBopomofo/WebData";
import { WebLanguageModel } from "../McBopomofo/WebLanguageModel";
import { bigramData } from "./BigramData";
import { BigramModel } from "./BigramModel";
import { englishData } from "./EnglishData";
import { EnglishModel } from "./EnglishModel";
import { keysForReading, MixedDecoder, MixedTokenType } from "./MixedDecoder";
import sentences from "./testdata/sentences.json";

interface Segment {
  lang: "zh" | "en";
  text: string;
  reading?: string;
}

const lm = new WebLanguageModel(webData);
const english = new EnglishModel(englishData);

function makeDecoder(
  layout = BopomofoKeyboardLayout.StandardLayout,
): MixedDecoder {
  return new MixedDecoder(lm, english, layout);
}

/** Keys a user would type for the sentence, and the expected output. */
function build(
  segments: Segment[],
  layout: BopomofoKeyboardLayout,
): { keys: string; expected: string } {
  let keys = "";
  let expected = "";
  segments.forEach((s, i) => {
    if (s.lang === "zh") {
      keys += keysForReading(s.reading!, layout);
      expected += s.text;
    } else {
      keys += s.text;
      expected += s.text;
      if (i < segments.length - 1) {
        keys += " ";
        expected += " ";
      }
    }
  });
  return { keys, expected };
}

/** Collapses text to its shape: Z for Chinese, E for English, etc. */
function shape(s: string): string {
  return Array.from(s.trimEnd())
    .map((c) =>
      /[㐀-鿿㄀-ㄯ]/.test(c)
        ? "Z"
        : /[A-Za-z]/.test(c)
          ? "E"
          : c === " "
            ? "_"
            : "o",
    )
    .join("")
    .replace(/(.)\1+/g, "$1");
}

function decodeText(d: MixedDecoder, keys: string): string {
  return d
    .decode(keys, { final: true })
    .tokens.map((t) => t.output)
    .join("");
}

describe("MixedDecoder", () => {
  test("reads Bopomofo keys as Chinese", () => {
    const d = makeDecoder();
    expect(decodeText(d, "su3cl3")).toBe("你好");
  });

  test("reads English words as English", () => {
    const d = makeDecoder();
    expect(decodeText(d, "hello world")).toBe("hello world");
  });

  test("mixes Chinese and English in one sentence", () => {
    const d = makeDecoder();
    expect(decodeText(d, "1; ji3check u vu84")).toBe("幫我check 一下");
  });

  test("re-reads earlier keys when later keys arrive", () => {
    const d = makeDecoder();
    expect(decodeText(d, "up ")).toBe("up ");
    expect(decodeText(d, "up jo4")).toBe("因為");
  });

  test("shows an unfinished syllable as Bopomofo while typing", () => {
    const d = makeDecoder();
    const r = d.decode("su3s", {});
    const last = r.tokens[r.tokens.length - 1];
    expect(last.type).toBe(MixedTokenType.Pending);
    expect(last.output).toBe("ㄋ");
  });

  test("predicts the rest of an English word", () => {
    const d = makeDecoder();
    const r = d.decode("ji3d9 meet", {});
    expect(r.tokens[r.tokens.length - 1].prediction).toBe("meeting");
  });

  test("uses full-width punctuation after Chinese", () => {
    const d = makeDecoder();
    d.punctuationLookup = (k) =>
      lm.getUnigrams("_punctuation_Standard_" + k)[0]?.value ??
      lm.getUnigrams("_punctuation_" + k)[0]?.value;
    expect(decodeText(d, "su3cl3?")).toBe("你好？");
    expect(decodeText(d, "hello?")).toBe("hello?");
  });

  test("numbers from the numeric keypad stay numbers", () => {
    const d = makeDecoder();
    const r = d.decode("187", {
      final: true,
      forced: [{ start: 0, end: 3, lang: "en" }],
    });
    expect(r.tokens.map((t) => t.output).join("")).toBe("187");
  });

  test("digits that spell toned syllables at the end read as Chinese", () => {
    const d = makeDecoder();
    // 1 0 3 is ㄅㄢˇ on the standard layout.
    expect(shape(decodeText(d, "103"))).toBe("Z");
    expect(shape(decodeText(d, "104"))).toBe("Z");
    // Not syllables, or no tone key: still numbers.
    expect(decodeText(d, "2026")).toBe("2026");
    expect(decodeText(d, "10")).toBe("10");
    // A number followed by a space or more Chinese stays a number (103 年).
    expect(decodeText(d, "103 ")).toBe("103 ");
    expect(decodeText(d, "103su06")).toBe("103年");
  });

  test("learned digit readings override the default", () => {
    const d = makeDecoder();
    d.digitsBias.set("103", -3);
    expect(decodeText(d, "103")).toBe("103");
    d.digitsBias.set("2026", 3);
    expect(decodeText(d, "2026")).toBe("2026"); // no Chinese reading at all
  });

  test("drops a stray key typed between Chinese syllables", () => {
    const d = makeDecoder();
    expect(decodeText(d, "su3ccl3")).toBe("你好"); // an extra ㄏ
    expect(decodeText(d, "su33cl3")).toBe("你好"); // the tone key twice
  });

  test("dropping stray keys can be turned off", () => {
    const d = makeDecoder();
    d.dropStrayKeys = false;
    expect(decodeText(d, "su3ccl3")).not.toBe("你好");
  });

  test("keeps keys that are still being typed or are English", () => {
    const d = makeDecoder();
    // Unfinished: the last key may start the next syllable.
    expect(d.decode("su3c", {}).tokens.map((t) => t.output).join("")).toBe(
      "你ㄏ",
    );
    expect(decodeText(d, "ji3d9 meeting")).toBe("我開meeting");
    expect(decodeText(d, "coffee")).toBe("coffee");
    expect(decodeText(d, "ji3 coffee")).toContain("coffee");
  });

  test("forcing a range changes the reading", () => {
    const d = makeDecoder();
    const r = d.decode("up ", {
      final: true,
      forced: [{ start: 0, end: 3, lang: "zh" }],
    });
    expect(r.tokens[0].lang).toBe("zh");
  });

  test("an override pins the chosen phrase", () => {
    const d = makeDecoder();
    const r = d.decode("294", {
      final: true,
      overrides: [
        {
          start: 0,
          end: 3,
          value: "帶",
          reading: "ㄉㄞˋ",
          syllableStarts: [0, 3],
        },
      ],
    });
    expect(r.tokens[0].output).toBe("帶");
  });

  test("confidence is near 1 for unambiguous words", () => {
    const d = makeDecoder();
    const r = d.decode("hello", { final: true });
    expect(
      d.confidence("hello", { final: true }, r.tokens[0]).probability,
    ).toBe(1);
  });

  test("lists longer phrases first as candidates", () => {
    const d = makeDecoder();
    const r = d.decode("su3cl3", { final: true });
    const t = r.tokens[0];
    const run = t.syllables!.map((reading, k) => ({
      reading,
      start: t.syllableStarts![k],
      end: t.syllableStarts![k + 1],
    }));
    const c = d.candidates(run, 1);
    expect(c[0].length).toBe(2);
    expect(c.some((x) => x.value === "好" && x.length === 1)).toBe(true);
  });

  describe("sentence corpus", () => {
    const layouts: [string, BopomofoKeyboardLayout, number][] = [
      // [name, layout, minimum share of sentences whose language shape is right]
      ["Standard (大千)", BopomofoKeyboardLayout.StandardLayout, 1.0],
      ["ETen (倚天)", BopomofoKeyboardLayout.ETenLayout, 0.97],
      ["IBM", BopomofoKeyboardLayout.IBMLayout, 0.97],
      ["Hsu (許氏)", BopomofoKeyboardLayout.HsuLayout, 0.97],
      ["ETen26 (倚天26鍵)", BopomofoKeyboardLayout.ETen26Layout, 0.97],
    ];
    for (const [name, layout, minShape] of layouts) {
      test(`detects the language on ${name}`, () => {
        const d = makeDecoder(layout);
        let shapeOk = 0;
        let exact = 0;
        const failures: string[] = [];
        for (const s of sentences as Segment[][]) {
          const { keys, expected } = build(s, layout);
          const got = decodeText(d, keys);
          if (shape(got) === shape(expected)) {
            shapeOk++;
          } else {
            failures.push(`[${keys}] → ${got} (expected ${expected})`);
          }
          if (got.trimEnd() === expected.trimEnd()) {
            exact++;
          }
        }
        const total = (sentences as Segment[][]).length;
        if (failures.length) {
          // Helpful when tuning; Jest only prints this on failure.

          console.log(name, `${shapeOk}/${total}`, failures.join("\n"));
        }
        expect(shapeOk / total).toBeGreaterThanOrEqual(minShape);
        expect(exact / total).toBeGreaterThanOrEqual(0.9 * minShape);
      });
    }
  });
});

describe("MixedDecoder with a bigram model", () => {
  // 記得帶傘: unigrams alone pick 代 for ㄉㄞˋ.
  const keys = keysForReading(
    "ㄐㄧˋ-ㄉㄜ˙-ㄉㄞˋ-ㄙㄢˇ",
    BopomofoKeyboardLayout.StandardLayout,
  );

  test("without a bigram model, unigrams decide", () => {
    const d = makeDecoder();
    expect(decodeText(d, keys)).toBe("記得代傘");
  });

  test("a bigram bonus picks the right homophone", () => {
    const d = makeDecoder();
    d.bigramModel = new BigramModel("帶\t傘 200\n");
    expect(decodeText(d, keys)).toBe("記得帶傘");
  });

  test("the bigram weight scales the bonus", () => {
    const d = makeDecoder();
    d.bigramModel = new BigramModel("帶\t傘 200\n");
    d.params.bigramWeight = 0;
    expect(decodeText(d, keys)).toBe("記得代傘");
  });

  test("user picks stay pinned under rescoring", () => {
    const d = makeDecoder();
    d.bigramModel = new BigramModel("帶\t傘 200\n");
    const r = d.decode(keys, {
      final: true,
      overrides: [
        {
          start: 6,
          end: 9,
          value: "待",
          reading: "ㄉㄞˋ",
          syllableStarts: [6, 9],
        },
      ],
    });
    expect(r.tokens.map((t) => t.output).join("")).toBe("記得待傘");
  });

  test("rescoring keeps raw ranges consistent", () => {
    const d = makeDecoder();
    d.bigramModel = new BigramModel("帶\t傘 200\n");
    const r = d.decode(keys, { final: true });
    let pos = 0;
    for (const t of r.tokens) {
      expect(t.start).toBe(pos);
      pos = t.end;
      if (t.syllables) {
        expect(t.syllableStarts![0]).toBe(t.start);
        expect(t.syllableStarts![t.syllables.length]).toBe(t.end);
      }
    }
    expect(pos).toBe(keys.length);
  });

  test("English and Chinese around a rescored run are untouched", () => {
    const d = makeDecoder();
    d.bigramModel = new BigramModel("帶\t傘 200\n");
    expect(decodeText(d, "ok " + keys + "please")).toBe("ok 記得帶傘please");
  });
});

describe("MixedDecoder with the bundled bigram model", () => {
  test("gets more of the sentence corpus exactly right than unigrams alone", () => {
    const layout = BopomofoKeyboardLayout.StandardLayout;
    const plain = makeDecoder(layout);
    const withBigram = makeDecoder(layout);
    withBigram.bigramModel = new BigramModel(bigramData);
    let plainExact = 0;
    let bigramExact = 0;
    for (const s of sentences as Segment[][]) {
      const { keys, expected } = build(s, layout);
      if (decodeText(plain, keys).trimEnd() === expected.trimEnd()) {
        plainExact++;
      }
      if (decodeText(withBigram, keys).trimEnd() === expected.trimEnd()) {
        bigramExact++;
      }
    }
    expect(bigramExact).toBeGreaterThanOrEqual(144);
    expect(bigramExact).toBeGreaterThan(plainExact);
  });
});
