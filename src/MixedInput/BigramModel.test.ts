/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

import { BigramModel, kSentenceStart } from "./BigramModel";

describe("BigramModel", () => {
  const model = new BigramModel("帶\t傘 200 便當 150\n^\t我 30\n");

  test("returns the bonus for a known pair", () => {
    expect(model.bonus("帶", "傘")).toBeCloseTo(2.0);
    expect(model.bonus("帶", "便當")).toBeCloseTo(1.5);
  });

  test("returns 0 for unknown pairs", () => {
    expect(model.bonus("代", "傘")).toBe(0);
    expect(model.bonus("帶", "雨")).toBe(0);
  });

  test("knows the sentence-start token", () => {
    expect(model.bonus(kSentenceStart, "我")).toBeCloseTo(0.3);
  });

  test("counts pairs", () => {
    expect(model.size).toBe(3);
  });

  test("ignores blank and malformed lines", () => {
    const m = new BigramModel("\n\n帶\n帶\t傘\n帶\t傘 abc\n");
    expect(m.size).toBe(0);
  });
});
