/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

import { kSentenceStart } from "./BigramModel";
import { TrigramModel } from "./TrigramModel";

describe("TrigramModel", () => {
  const model = new TrigramModel("記得 帶\t傘 200 便當 150\n^ 對\t啊 80\n");

  test("returns the bonus for a known word triple", () => {
    expect(model.bonus("記得", "帶", "傘")).toBeCloseTo(2.0);
    expect(model.bonus("記得", "帶", "便當")).toBeCloseTo(1.5);
    expect(model.bonus(kSentenceStart, "對", "啊")).toBeCloseTo(0.8);
  });

  test("returns 0 for unknown triples", () => {
    expect(model.bonus("忘了", "帶", "傘")).toBe(0);
    expect(model.bonus("記得", "代", "傘")).toBe(0);
    expect(model.bonus("記得", "帶", "雨")).toBe(0);
  });

  test("counts triples and ignores malformed lines", () => {
    expect(model.size).toBe(3);
    const m = new TrigramModel("\n記得\t傘 200\n記得 帶\t傘 abc\n記得 帶\n");
    expect(m.size).toBe(0);
  });
});
