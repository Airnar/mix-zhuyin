/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

/**
 * Word-triple bonuses: what two words of context add over one.
 *
 * A bonus is log10(P(next | prev2 prev) / P(next | prev)) measured on a
 * corpus, added on top of the word-pair bonus of `BigramModel`. Only triples
 * that make `next` clearly more likely are stored; the rest are 0.
 *
 * Data format (see tools/mixed/train_bigram.py, --trigram-output): one line
 * per two-word context, `prev2 prev<TAB>next bonus*100 next bonus*100 ...`.
 * Words never contain spaces; `^` is the start of a sentence.
 */
export class TrigramModel {
  private readonly triples_ = new Map<string, Map<string, number>>();
  private size_ = 0;

  /** @param data The trigram data (see the class comment). */
  constructor(data: string) {
    for (const line of data.split("\n")) {
      const tab = line.indexOf("\t");
      const context = tab > 0 ? line.substring(0, tab).split(" ") : [];
      if (context.length !== 2 || !context[0] || !context[1]) {
        continue;
      }
      const parts = line.substring(tab + 1).split(" ");
      let map: Map<string, number> | undefined;
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const value = parseInt(parts[i + 1], 10);
        if (!parts[i] || isNaN(value)) {
          continue;
        }
        if (!map) {
          map = new Map<string, number>();
          this.triples_.set(context[0] + " " + context[1], map);
        }
        map.set(parts[i], value / 100);
        this.size_++;
      }
    }
  }

  /** Number of stored triples. */
  get size(): number {
    return this.size_;
  }

  /** The log10 bonus for `next` after `prev2 prev`, or 0 if unknown. */
  bonus(prev2: string, prev: string, next: string): number {
    return this.triples_.get(prev2 + " " + prev)?.get(next) ?? 0;
  }
}
