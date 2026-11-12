/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

/** A word and its log10 probability. */
export interface ScoredWord {
  readonly word: string;
  readonly logProbability: number;
}

/**
 * A unigram English model used to judge whether a key sequence is more likely
 * an English word than a Bopomofo reading.
 *
 * Scores are log10 probabilities, the same unit McBopomofo uses for Chinese
 * unigrams, so the two can be compared directly.
 */
export class EnglishModel {
  private readonly words_ = new Map<string, number>();
  private readonly bestLonger_ = new Map<string, ScoredWord>();
  private readonly sorted_: string[];

  /**
   * @param data Lines of "word zipf*100" (see EnglishData.ts).
   */
  constructor(data: string) {
    for (const line of data.split("\n")) {
      if (!line) {
        continue;
      }
      const sp = line.lastIndexOf(" ");
      const word = line.substring(0, sp);
      const zipf = parseInt(line.substring(sp + 1), 10) / 100;
      const lp = zipf - 9;
      this.words_.set(word, lp);
      for (let k = 1; k < word.length; k++) {
        const prefix = word.substring(0, k);
        const cur = this.bestLonger_.get(prefix);
        if (cur === undefined || lp > cur.logProbability) {
          this.bestLonger_.set(prefix, { word, logProbability: lp });
        }
      }
    }
    this.sorted_ = Array.from(this.words_.keys()).sort();
  }

  /** Number of words in the model. */
  get size(): number {
    return this.words_.size;
  }

  /** The log10 probability of a lowercase word, or undefined if unknown. */
  logProbability(word: string): number | undefined {
    return this.words_.get(word);
  }

  /** The most likely word that is longer than and starts with `prefix`. */
  bestCompletion(prefix: string): ScoredWord | undefined {
    return this.bestLonger_.get(prefix);
  }

  /** Words starting with `prefix`, most likely first. */
  completions(prefix: string, limit: number = 8): ScoredWord[] {
    const p = prefix.toLowerCase();
    let lo = 0;
    let hi = this.sorted_.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.sorted_[m] < p) {
        lo = m + 1;
      } else {
        hi = m;
      }
    }
    const result: ScoredWord[] = [];
    for (let i = lo; i < this.sorted_.length && i < lo + 5000; i++) {
      const w = this.sorted_[i];
      if (!w.startsWith(p)) {
        break;
      }
      result.push({ word: w, logProbability: this.words_.get(w)! });
    }
    result.sort((a, b) => b.logProbability - a.logProbability);
    return result.slice(0, limit);
  }
}
