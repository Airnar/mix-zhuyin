/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

/** The token that stands for the start of a sentence. */
export const kSentenceStart = "^";

/**
 * Word-pair bonuses that let the decoder pick homophones from context
 * (帶傘 rather than 代傘).
 *
 * A bonus is log10(P(next | prev) / P(next)) measured on a corpus: how much
 * more often `next` follows `prev` than it appears in general. Only pairs
 * that occur together more often than chance are stored; every other pair
 * has a bonus of 0, which leaves McBopomofo's unigram scores in charge.
 *
 * Data format (see tools/mixed/train_bigram.py): one line per previous word,
 * `prev<TAB>next bonus*100 next bonus*100 ...`.
 */
export class BigramModel {
  private readonly pairs_ = new Map<string, Map<string, number>>();
  private size_ = 0;

  constructor(data: string) {
    for (const line of data.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab <= 0) {
        continue;
      }
      const prev = line.substring(0, tab);
      const parts = line.substring(tab + 1).split(" ");
      let map: Map<string, number> | undefined;
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const value = parseInt(parts[i + 1], 10);
        if (!parts[i] || isNaN(value)) {
          continue;
        }
        if (!map) {
          map = new Map<string, number>();
          this.pairs_.set(prev, map);
        }
        map.set(parts[i], value / 100);
        this.size_++;
      }
    }
  }

  /** Number of stored pairs. */
  get size(): number {
    return this.size_;
  }

  /** The log10 bonus for `next` following `prev`, or 0 if unknown. */
  bonus(prev: string, next: string): number {
    return this.pairs_.get(prev)?.get(next) ?? 0;
  }
}
