/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

// Evaluates the bigram model on held-out sentences. Skipped unless
// MIX_LM_EVAL points at a file with one sentence per line, e.g.
//   MIX_LM_EVAL=heldout.txt MIX_LM_EVAL_REPORT=report.md npx jest LanguageModelEval

import * as fs from "fs";

import { BopomofoKeyboardLayout } from "../Mandarin";
import { Service } from "../McBopomofo/Service";
import { webData } from "../McBopomofo/WebData";
import { WebLanguageModel } from "../McBopomofo/WebLanguageModel";
import { bigramData } from "./BigramData";
import { BigramModel } from "./BigramModel";
import { englishData } from "./EnglishData";
import { EnglishModel } from "./EnglishModel";
import { keysForReading, MixedDecoder } from "./MixedDecoder";

const heldoutPath = process.env.MIX_LM_EVAL;
const reportPath = process.env.MIX_LM_EVAL_REPORT;
const maybe = heldoutPath ? test : test.skip;

interface Score {
  label: string;
  chars: number;
  correctChars: number;
  sentences: number;
  correctSentences: number;
  ms: number;
}

function score(
  label: string,
  decoder: MixedDecoder,
  cases: { keys: string; text: string }[],
): Score {
  const s: Score = {
    label,
    chars: 0,
    correctChars: 0,
    sentences: 0,
    correctSentences: 0,
    ms: 0,
  };
  const t0 = Date.now();
  for (const c of cases) {
    const got = decoder
      .decode(c.keys, { final: true })
      .tokens.map((t) => t.output)
      .join("");
    const want = Array.from(c.text);
    const have = Array.from(got);
    s.chars += want.length;
    s.sentences++;
    if (have.length === want.length) {
      want.forEach((ch, i) => {
        if (have[i] === ch) {
          s.correctChars++;
        }
      });
    }
    if (got === c.text) {
      s.correctSentences++;
    }
  }
  s.ms = (Date.now() - t0) / Math.max(1, cases.length);
  return s;
}

describe("language model evaluation", () => {
  maybe(
    "bigram rescoring improves held-out character accuracy",
    () => {
      const lm = new WebLanguageModel(webData);
      const english = new EnglishModel(englishData);
      const service = new Service();
      const layout = BopomofoKeyboardLayout.StandardLayout;
      const lines = fs
        .readFileSync(heldoutPath!, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const cases: { keys: string; text: string }[] = [];
      for (const text of lines) {
        const readings = service
          .convertTextToBpmfReadingsWithSpaces(text)
          .trim()
          .split(/\s+/);
        if (readings.length !== Array.from(text).length) {
          continue;
        }
        if (!readings.every((r) => /^[㄀-ㄯˊˇˋ˙]+$/.test(r))) {
          continue;
        }
        cases.push({ keys: keysForReading(readings.join("-"), layout), text });
      }
      const bigram = new BigramModel(bigramData);
      const results: Score[] = [];
      const base = new MixedDecoder(lm, english, layout);
      results.push(score("unigram only (McBopomofo)", base, cases));
      for (const w of [0.5, 0.75, 1.0, 1.25, 1.5]) {
        const d = new MixedDecoder(lm, english, layout);
        d.bigramModel = bigram;
        d.params.bigramWeight = w;
        results.push(score(`bigram, weight ${w}`, d, cases));
      }
      const pct = (a: number, b: number): string =>
        ((100 * a) / Math.max(1, b)).toFixed(2) + "%";
      const rows = results.map(
        (r) =>
          `| ${r.label} | ${pct(r.correctChars, r.chars)} | ${pct(
            r.correctSentences,
            r.sentences,
          )} | ${r.ms.toFixed(1)} ms |`,
      );
      const report = [
        `Held-out sentences: ${cases.length} (of ${lines.length}), ` +
          `${results[0].chars} characters. Bigram pairs: ${bigram.size}.`,
        "",
        "| Model | Character accuracy | Sentence accuracy | Time per sentence |",
        "| --- | --- | --- | --- |",
        ...rows,
        "",
      ].join("\n");

      console.log(report);
      if (reportPath) {
        fs.writeFileSync(reportPath, report);
      }
      if (bigram.size > 0) {
        const best = Math.max(...results.slice(1).map((r) => r.correctChars));
        expect(best).toBeGreaterThan(results[0].correctChars);
      }
    },
    30 * 60 * 1000,
  );
});
