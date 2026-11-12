/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

import { BopomofoKeyboardLayout } from "../Mandarin";
import { webData } from "../McBopomofo/WebData";
import { WebLanguageModel } from "../McBopomofo/WebLanguageModel";
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
