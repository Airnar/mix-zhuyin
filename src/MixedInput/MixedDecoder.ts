/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

import { LanguageModel, Unigram } from "../Gramambular2";
import { BopomofoKeyboardLayout, BopomofoSyllable } from "../Mandarin";
import { BigramModel, kSentenceStart } from "./BigramModel";
import { EnglishModel } from "./EnglishModel";

/**
 * Mixed Chinese/English decoding.
 *
 * The same key sequence is read two ways at once: as Bopomofo on the current
 * keyboard layout, and as English letters. Every way of cutting the sequence
 * into Chinese phrases and English words gets a cost (negative log10
 * probability: Chinese from McBopomofo's unigrams, English from word
 * frequencies), and dynamic programming picks the cheapest. Switching between
 * the two languages costs extra so a sentence does not flip back and forth.
 */

export type MixedLanguage = "zh" | "en";

export enum MixedTokenType {
  /** A Chinese phrase. */
  Chinese = "zh",
  /** An unfinished Bopomofo syllable at the end of the input. */
  Pending = "pend",
  /** A known English word (or a prefix of one at the end of the input). */
  English = "en",
  /** Letters that are not a known English word. */
  UnknownWord = "unk",
  Number = "num",
  Punctuation = "punct",
  Space = "space",
  /** Fallback: a single character output as typed. */
  Literal = "lit",
  /** A stray key typed by mistake between Chinese syllables, dropped. */
  Skipped = "skip",
}

export interface MixedToken {
  /** Start index in the raw key sequence. */
  readonly start: number;
  /** End index (exclusive) in the raw key sequence. */
  readonly end: number;
  readonly lang: MixedLanguage | null;
  readonly type: MixedTokenType;
  /** The text before context-dependent conversion (e.g. full-width marks). */
  readonly text: string;
  /** The text to show and commit. */
  output: string;
  readonly cost: number;
  /** Chinese: the joined reading, e.g. "ㄋㄧˇ-ㄏㄠˇ". */
  readonly reading?: string;
  /** Chinese: one reading per syllable. */
  readonly syllables?: string[];
  /** Chinese: raw index where each syllable starts, plus the end index. */
  readonly syllableStarts?: number[];
  /** English: the word as typed, without the trailing space. */
  readonly word?: string;
  /** English: suggested completion for the last, unfinished word. */
  readonly prediction?: string;
  /** Chinese: the phrase was picked by the user. */
  readonly isOverride?: boolean;
}

/** Forces a range of the raw key sequence to one language. */
export interface ForcedRange {
  readonly start: number;
  readonly end: number;
  readonly lang: MixedLanguage;
}

/** A phrase the user picked from the candidate list. */
export interface PhraseOverride {
  readonly start: number;
  readonly end: number;
  readonly value: string;
  readonly reading: string;
  readonly syllableStarts: number[];
}

export interface DecodeOptions {
  forced?: ForcedRange[];
  overrides?: PhraseOverride[];
  /** The language of the text right before the input, if known. */
  context?: MixedLanguage | null;
  /** True when committing: unfinished syllables and words are not allowed. */
  final?: boolean;
}

export interface DecodeResult {
  readonly tokens: MixedToken[];
  /** Total cost of the best path (negative log10 probability). */
  readonly cost: number;
}

/** A syllable in a run of consecutive Chinese tokens. */
export interface RunSyllable {
  readonly reading: string;
  readonly start: number;
  readonly end: number;
}

export interface PhraseCandidate {
  readonly value: string;
  readonly reading: string;
  readonly start: number;
  readonly end: number;
  readonly syllableStarts: number[];
  readonly score: number;
  /** Number of syllables the phrase covers. */
  readonly length: number;
}

/** Tunable costs, in log10 units (1.0 = 10 times less likely). */
export class MixedDecoderParams {
  /** Base cost of each Chinese phrase. */
  zhTokenPenalty = 0.4;
  /** Base cost of each English word. */
  enTokenPenalty = 0.4;
  /** Cost of switching between Chinese and English. */
  switchPenalty = 1.6;
  /** Extra cost of an unfinished syllable at the end. */
  pendingPenalty = 0.6;
  /** Extra cost of an unfinished word at the end (scored by its completion). */
  prefixPenalty = 0.6;
  /** Letters that are not a known word. */
  unknownBase = 4.5;
  /** About what a letter costs under a character-level English model. */
  unknownPerLetter = 1.0;
  /** Unknown words longer than this get even more expensive per letter. */
  unknownLongAfter = 12;
  unknownLongPerLetter = 0.5;
  /** Uppercase letters can only be English. */
  uppercaseBonus = 0.5;
  /** Numbers: each extra digit makes a specific number about 6x less likely. */
  numberBase = 1.5;
  numberPerDigit = 0.8;
  /** Cutting a run of digits in the middle. */
  numberSplit = 1.5;
  /** A number glued to an English word ("a87"), either side. */
  numberNextToLetter = 2.0;
  /**
   * Digits that also spell toned Bopomofo syllables (1 0 3 = ㄅㄢˇ 版) and
   * end the input: more likely Chinese than a number, since the user would
   * otherwise go on with a space or a unit (103 年).
   */
  numberLooksLikeBopomofo = 1.5;
  /**
   * Dropping one stray key inside Chinese typing (刪除贅字): an extra key
   * after a syllable, or a key pressed twice, when a full syllable follows.
   */
  strayKey = 3.0;
  punctuation = 0.3;
  /** A lowercase one-letter English word right after Chinese ("對a"). */
  singleLetterAfterChinese = 1.2;
  /** A punctuation key that is also a Bopomofo key, inside Chinese. */
  bopomofoPunctuationInChinese = 1.5;
  /** Punctuation keys that are also Bopomofo keys on the current layout. */
  punctuationOnBopomofoKey = 3.0;
  space = 0.8;
  literal = 9.0;
  force = 40;
  override = -40;
  /** Only predict a completion that is at least this likely (log10). */
  predictionThreshold = -6.5;
  /** Predict even if the typed word exists, when the completion is this close. */
  predictionMargin = 0.6;
  maxPhraseSyllables = 6;
  /** How much word-pair bonuses count (0 turns the bigram model off). */
  bigramWeight = 1.0;
  /** Phrases tried per reading when rescoring with the bigram model. */
  bigramPhrasesPerReading = 8;
  /** Partial sentences kept at each syllable when rescoring. */
  bigramBeam = 12;
}

interface LatticeNode {
  readonly start: number;
  readonly end: number;
  readonly value: string;
  readonly score: number;
  readonly pinned?: MixedToken;
}

interface Hypothesis {
  readonly node: LatticeNode;
  readonly score: number;
  readonly prev: Hypothesis | null;
}

const kToneMarks = ["", "ˊ", "ˇ", "ˋ", "˙"];
const kInitials = "ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ";
const kMedials = "ㄧㄨㄩ";
const kFinals = "ㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ";

function isLetter(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

interface SyllableParse {
  end: number;
  reading?: string;
  pending?: { display: string; score: number };
}

interface Edge {
  token: MixedToken;
}

/**
 * Decodes a raw key sequence into mixed Chinese/English text.
 */
export class MixedDecoder {
  readonly params = new MixedDecoderParams();
  /** Learned per-word adjustments (log10), positive favors English. */
  readonly englishBias = new Map<string, number>();
  /** Learned per-phrase adjustments, keyed by "reading|value". */
  readonly phraseBias = new Map<string, number>();
  /**
   * Learned readings of digit strings: added to the number's cost, so
   * positive means "usually Chinese", negative "usually a number". Replaces
   * {@link MixedDecoderParams.numberLooksLikeBopomofo} for that string.
   */
  readonly digitsBias = new Map<string, number>();
  /** Whether stray keys between Chinese syllables are dropped (刪除贅字). */
  dropStrayKeys = true;
  /**
   * Optional word-pair model. When set, each run of Chinese is re-read so
   * that phrases fit their neighbors (帶傘 rather than 代傘).
   */
  bigramModel: BigramModel | undefined;

  /** Maps a punctuation key to its output in Chinese context. */
  punctuationLookup: (key: string) => string | undefined = (key) =>
    MixedDecoder.defaultFullWidth_.get(key);

  private static readonly defaultFullWidth_ = new Map<string, string>([
    ["<", "，"],
    [">", "。"],
    ["?", "？"],
    ["!", "！"],
    [":", "："],
    ["(", "（"],
    [")", "）"],
    ["~", "～"],
  ]);

  private unigramCache_ = new Map<string, Unigram[]>();
  private pendingCache_ = new Map<string, number | undefined>();

  constructor(
    private languageModel_: LanguageModel,
    private englishModel_: EnglishModel,
    private layout_: BopomofoKeyboardLayout = BopomofoKeyboardLayout.StandardLayout,
  ) {}

  get layout(): BopomofoKeyboardLayout {
    return this.layout_;
  }

  set layout(value: BopomofoKeyboardLayout) {
    this.layout_ = value;
  }

  get englishModel(): EnglishModel {
    return this.englishModel_;
  }

  /** Whether the key is a Bopomofo key (including tone keys) on the layout. */
  isBopomofoKey(key: string): boolean {
    return this.layout_.keyToComponents(key).length > 0;
  }

  /** Whether the key can be a tone key on the layout (Space is tone 1). */
  isToneKey(key: string): boolean {
    if (key === " ") {
      return true;
    }
    return this.layout_
      .keyToComponents(key)
      .some((c) => new BopomofoSyllable(c).hasToneMarker);
  }

  /** Drops cached dictionary lookups, e.g. after user phrases change. */
  clearCache(): void {
    this.unigramCache_.clear();
    this.pendingCache_.clear();
  }

  /**
   * The best single-syllable score among readings that an unfinished syllable
   * could still become (adding a medial, a final and a tone).
   */
  private bestCompletionScore_(composed: string): number | undefined {
    if (this.pendingCache_.has(composed)) {
      return this.pendingCache_.get(composed);
    }
    const chars = Array.from(composed);
    const consonant = chars.filter((c) => kInitials.includes(c)).join("");
    const medial = chars.filter((c) => kMedials.includes(c)).join("");
    const final = chars.filter((c) => kFinals.includes(c)).join("");
    const medials = medial ? [medial] : [""].concat(Array.from(kMedials));
    const finals = final ? [final] : [""].concat(Array.from(kFinals));
    let best: number | undefined;
    for (const m of medials) {
      for (const f of finals) {
        for (const t of kToneMarks) {
          const u = this.unigrams_(consonant + m + f + t);
          if (u.length > 0 && (best === undefined || u[0].score > best)) {
            best = u[0].score;
          }
        }
      }
    }
    this.pendingCache_.set(composed, best);
    return best;
  }

  private unigrams_(reading: string): Unigram[] {
    let result = this.unigramCache_.get(reading);
    if (result === undefined) {
      result = this.languageModel_.hasUnigrams(reading)
        ? this.languageModel_.getUnigrams(reading)
        : [];
      if (this.phraseBias.size > 0 && result.length > 0) {
        result = result
          .map(
            (u) =>
              new Unigram(
                u.value,
                u.score + (this.phraseBias.get(reading + "|" + u.value) ?? 0),
              ),
          )
          .sort((a, b) => b.score - a.score);
      }
      this.unigramCache_.set(reading, result);
    }
    return result;
  }

  /** Phrases for a reading, best first, with learned adjustments applied. */
  phrasesForReading(reading: string): Unigram[] {
    return this.unigrams_(reading);
  }

  private englishScore_(word: string): number | undefined {
    const lp = this.englishModel_.logProbability(word);
    if (lp === undefined) {
      return undefined;
    }
    return lp + (this.englishBias.get(word) ?? 0);
  }

  /**
   * All ways to read one syllable starting at `i`. A syllable is finished by a
   * tone key, or by Space for the first tone. Keys must appear exactly as the
   * layout would type that syllable, so English words rarely parse by accident.
   */
  parseSyllables(raw: string, i: number, final: boolean): SyllableParse[] {
    const results: SyllableParse[] = [];
    const n = raw.length;
    for (let len = 1; len <= 5 && i + len <= n; len++) {
      const keys = raw.substring(i, i + len);
      if (!this.isBopomofoKey(keys[len - 1])) {
        break;
      }
      const syllable = this.layout_.syllableFromKeySequence(keys);
      if (syllable.isEmpty) {
        continue;
      }
      const roundTrip = this.layout_.keySequenceFromSyllable(syllable) === keys;
      if (!roundTrip) {
        continue;
      }
      const hasSound =
        syllable.hasConsonant || syllable.hasMiddleVowel || syllable.hasVowel;
      if (!hasSound) {
        continue;
      }
      const composed = syllable.composedString;
      if (syllable.hasToneMarker) {
        if (this.unigrams_(composed).length > 0) {
          results.push({ end: i + len, reading: composed });
        }
        continue;
      }
      if (i + len < n && raw[i + len] === " ") {
        if (this.unigrams_(composed).length > 0) {
          results.push({ end: i + len + 1, reading: composed });
        }
      } else if (i + len === n && !final) {
        const best = this.bestCompletionScore_(composed);
        if (best === undefined) {
          continue;
        }
        results.push({
          end: n,
          pending: {
            display: composed,
            score: best,
          },
        });
      }
    }
    return results;
  }

  /**
   * Whether raw[i, j) splits into Bopomofo syllables that each end with a
   * tone key (not Space), e.g. "103" = ㄅㄢˇ on the standard layout.
   */
  private spellsTonedSyllables_(raw: string, i: number, j: number): boolean {
    if (i === j) {
      return true;
    }
    return this.parseSyllables(raw.substring(0, j), i, true).some(
      (p) =>
        p.end <= j &&
        this.isToneKey(raw[p.end - 1]) &&
        this.spellsTonedSyllables_(raw, p.end, j),
    );
  }

  private chineseEdges_(
    raw: string,
    i: number,
    final: boolean,
    edges: Edge[],
  ): void {
    const P = this.params;
    const walk = (pos: number, syllables: string[], starts: number[]): void => {
      if (syllables.length >= P.maxPhraseSyllables) {
        return;
      }
      for (const parse of this.parseSyllables(raw, pos, final)) {
        if (parse.pending) {
          if (syllables.length === 0) {
            edges.push({
              token: {
                start: i,
                end: parse.end,
                lang: "zh",
                type: MixedTokenType.Pending,
                text: parse.pending.display,
                output: parse.pending.display,
                cost: -parse.pending.score + P.pendingPenalty,
              },
            });
          }
          continue;
        }
        const nextSyllables = syllables.concat([parse.reading!]);
        const nextStarts = starts.concat([pos]);
        const reading = nextSyllables.join("-");
        const unigrams = this.unigrams_(reading);
        if (unigrams.length > 0) {
          edges.push({
            token: {
              start: i,
              end: parse.end,
              lang: "zh",
              type: MixedTokenType.Chinese,
              text: unigrams[0].value,
              output: unigrams[0].value,
              cost: -unigrams[0].score + P.zhTokenPenalty,
              reading,
              syllables: nextSyllables,
              syllableStarts: nextStarts.concat([parse.end]),
            },
          });
        }
        walk(parse.end, nextSyllables, nextStarts);
      }
    };
    walk(i, [], []);
  }

  private edgesFrom_(raw: string, i: number, final: boolean): Edge[] {
    const P = this.params;
    const n = raw.length;
    const c = raw[i];
    const edges: Edge[] = [];

    // 1) Chinese phrases.
    this.chineseEdges_(raw, i, final, edges);

    // 2) English word.
    // A word starts at a word boundary, or right after a key that can end a
    // Chinese syllable (on 許氏 and similar layouts, tone keys are letters).
    if (
      isLetter(c) &&
      (i === 0 || !isLetter(raw[i - 1]) || this.isToneKey(raw[i - 1]))
    ) {
      let j = i;
      while (
        j < n &&
        (isLetter(raw[j]) ||
          (raw[j] === "'" && j + 1 < n && isLetter(raw[j + 1])))
      ) {
        j++;
      }
      const word = raw.substring(i, j);
      const lower = word.toLowerCase();
      let type = MixedTokenType.English;
      let prediction: string | undefined;
      const score = this.englishScore_(lower);
      let cost = score === undefined ? undefined : -score + P.enTokenPenalty;
      if (j === n && !final) {
        const best = this.englishModel_.bestCompletion(lower);
        if (best) {
          const bestScore =
            best.logProbability + (this.englishBias.get(best.word) ?? 0);
          const pc = -bestScore + P.enTokenPenalty + P.prefixPenalty;
          if (cost === undefined || pc < cost) {
            cost = pc;
          }
          if (
            word.length >= 2 &&
            best.logProbability > P.predictionThreshold &&
            (score === undefined || bestScore > score - P.predictionMargin)
          ) {
            prediction = best.word;
          }
        }
      }
      if (cost === undefined) {
        cost =
          P.unknownBase +
          P.unknownPerLetter * word.length +
          P.unknownLongPerLetter *
            Math.max(0, word.length - P.unknownLongAfter);
        type = MixedTokenType.UnknownWord;
      }
      if (/[A-Z]/.test(word)) {
        cost -= P.uppercaseBonus;
      }
      let end = j;
      let text = word;
      if (j < n && raw[j] === " ") {
        end = j + 1;
        text = word + " ";
      }
      edges.push({
        token: {
          start: i,
          end,
          lang: "en",
          type,
          text,
          output: text,
          cost,
          word,
          prediction,
        },
      });
    }

    // 3) Numbers. On some layouts digits are also Bopomofo or tone keys, so a
    // number competes with Chinese readings.
    if (isDigit(c)) {
      let j = i;
      while (
        j < n &&
        (isDigit(raw[j]) ||
          ((raw[j] === "." || raw[j] === "," || raw[j] === ":") &&
            j + 1 < n &&
            isDigit(raw[j + 1])))
      ) {
        j++;
        if (isDigit(raw[j - 1])) {
          let cost = P.numberBase + P.numberPerDigit * (j - i);
          if (j < n && isDigit(raw[j])) {
            cost += P.numberSplit;
          }
          if (i > 0 && isDigit(raw[i - 1])) {
            cost += P.numberSplit;
          }
          if (i > 0 && isLetter(raw[i - 1])) {
            cost += P.numberNextToLetter;
          }
          const text = raw.substring(i, j);
          const whole =
            (i === 0 || !isDigit(raw[i - 1])) && (j === n || !isDigit(raw[j]));
          if (whole && /^[0-9]+$/.test(text)) {
            const learned = this.digitsBias.get(text);
            if (learned !== undefined) {
              cost += learned;
            } else if (j === n && this.spellsTonedSyllables_(raw, i, j)) {
              cost += P.numberLooksLikeBopomofo;
            }
          }
          edges.push({
            token: {
              start: i,
              end: j,
              lang: null,
              type: MixedTokenType.Number,
              text,
              output: text,
              cost,
            },
          });
        }
      }
    }

    // 4) A stray key between Chinese syllables, dropped. Only when it follows
    // a tone key or repeats the previous key, and a whole syllable follows,
    // so a key that may start the next syllable is never hidden.
    if (
      this.dropStrayKeys &&
      i > 0 &&
      i + 1 < n &&
      c !== " " &&
      this.isBopomofoKey(c) &&
      (this.isToneKey(raw[i - 1]) || raw[i - 1] === c) &&
      this.parseSyllables(raw, i + 1, final).some((p) => !p.pending)
    ) {
      edges.push({
        token: {
          start: i,
          end: i + 1,
          lang: "zh",
          type: MixedTokenType.Skipped,
          text: c,
          output: "",
          cost: P.strayKey,
        },
      });
    }

    // 5) Space and punctuation.
    if (c === " ") {
      edges.push({
        token: {
          start: i,
          end: i + 1,
          lang: null,
          type: MixedTokenType.Space,
          text: " ",
          output: " ",
          cost: P.space,
        },
      });
    } else if (!isLetter(c) && !isDigit(c)) {
      edges.push({
        token: {
          start: i,
          end: i + 1,
          lang: null,
          type: MixedTokenType.Punctuation,
          text: c,
          output: c,
          cost: this.isBopomofoKey(c)
            ? P.punctuationOnBopomofoKey
            : P.punctuation,
        },
      });
    }

    // 5) Fallback so that every input has some reading.
    edges.push({
      token: {
        start: i,
        end: i + 1,
        lang: null,
        type: MixedTokenType.Literal,
        text: c,
        output: c,
        cost: P.literal,
      },
    });
    return edges;
  }

  /**
   * Finds the most likely mixed reading of `raw`.
   */
  decode(raw: string, options: DecodeOptions = {}): DecodeResult {
    const P = this.params;
    const n = raw.length;
    const final = options.final === true;
    const forced: (MixedLanguage | null)[] = new Array(n).fill(null);
    for (const f of options.forced ?? []) {
      for (let p = f.start; p < f.end && p < n; p++) {
        forced[p] = f.lang;
      }
    }
    const overridesByStart = new Map<number, PhraseOverride[]>();
    for (const o of options.overrides ?? []) {
      if (o.end > n) {
        continue;
      }
      const list = overridesByStart.get(o.start) ?? [];
      list.push(o);
      overridesByStart.set(o.start, list);
    }

    // State = language (0 zh, 1 en) * 2 + whether the last token is a number.
    const INF = Number.POSITIVE_INFINITY;
    const dp: number[][] = [];
    const back: ({ token: MixedToken; prev: number } | null)[][] = [];
    for (let i = 0; i <= n; i++) {
      dp.push([INF, INF, INF, INF]);
      back.push([null, null, null, null]);
    }
    if (options.context === "zh") {
      dp[0][0] = 0;
      dp[0][2] = P.switchPenalty * 0.5;
    } else if (options.context === "en") {
      dp[0][2] = 0;
      dp[0][0] = P.switchPenalty * 0.5;
    } else {
      dp[0][0] = 0;
      dp[0][2] = 0;
    }

    for (let i = 0; i < n; i++) {
      if (dp[i].every((x) => x === INF)) {
        continue;
      }
      const edges = this.edgesFrom_(raw, i, final);
      for (const o of overridesByStart.get(i) ?? []) {
        edges.push({
          token: {
            start: o.start,
            end: o.end,
            lang: "zh",
            type: MixedTokenType.Chinese,
            text: o.value,
            output: o.value,
            cost: P.override,
            reading: o.reading,
            syllables: o.reading.split("-"),
            syllableStarts: o.syllableStarts,
            isOverride: true,
          },
        });
      }
      for (const { token } of edges) {
        let penalty = 0;
        for (let p = token.start; p < token.end; p++) {
          const f = forced[p];
          if (!f || f === token.lang) {
            continue;
          }
          // Numbers, spaces and punctuation are fine inside forced English.
          if (
            f === "en" &&
            token.lang === null &&
            token.type !== MixedTokenType.Literal
          ) {
            continue;
          }
          penalty = P.force;
          break;
        }
        for (let st = 0; st < 4; st++) {
          if (dp[i][st] === INF) {
            continue;
          }
          const lang = st >> 1;
          const wasNumber = st & 1;
          // Stray keys are dropped only in the middle of Chinese.
          if (
            token.type === MixedTokenType.Skipped &&
            (lang !== 0 || wasNumber)
          ) {
            continue;
          }
          let nextLang = lang;
          let cost = dp[i][st] + token.cost + penalty;
          if (token.lang) {
            nextLang = token.lang === "zh" ? 0 : 1;
            if (nextLang !== lang) {
              cost += P.switchPenalty;
            }
            if (token.lang === "en" && wasNumber) {
              cost += P.numberNextToLetter;
            }
            if (
              token.lang === "en" &&
              lang === 0 &&
              token.word !== undefined &&
              /^[a-z]$/.test(token.word)
            ) {
              cost += P.singleLetterAfterChinese;
            }
          } else if (
            lang === 0 &&
            token.type === MixedTokenType.Punctuation &&
            this.isBopomofoKey(token.text)
          ) {
            cost += P.bopomofoPunctuationInChinese;
          }
          const ns =
            nextLang * 2 + (token.type === MixedTokenType.Number ? 1 : 0);
          if (cost < dp[token.end][ns]) {
            dp[token.end][ns] = cost;
            back[token.end][ns] = { token, prev: st };
          }
        }
      }
    }

    let st = 0;
    for (let k = 1; k < 4; k++) {
      if (dp[n][k] < dp[n][st]) {
        st = k;
      }
    }
    const total = n === 0 ? 0 : dp[n][st];
    const tokens: MixedToken[] = [];
    let i = n;
    while (i > 0) {
      const b = back[i][st]!;
      tokens.push({ ...b.token });
      i = b.token.start;
      st = b.prev;
    }
    tokens.reverse();
    const finalTokens =
      this.bigramModel && P.bigramWeight > 0
        ? this.rescoreChinese_(tokens, options)
        : tokens;

    // Punctuation follows the language around it.
    let lang: MixedLanguage | null = options.context ?? null;
    for (const t of finalTokens) {
      if (t.lang) {
        lang = t.lang;
      }
      if (t.type === MixedTokenType.Punctuation && lang === "zh") {
        t.output = this.punctuationLookup(t.text) ?? t.text;
      }
    }
    return { tokens: finalTokens, cost: total };
  }

  /** Re-reads every run of consecutive Chinese tokens with the bigram model. */
  private rescoreChinese_(
    tokens: MixedToken[],
    options: DecodeOptions,
  ): MixedToken[] {
    const out: MixedToken[] = [];
    let i = 0;
    while (i < tokens.length) {
      if (tokens[i].type !== MixedTokenType.Chinese) {
        out.push(tokens[i]);
        i++;
        continue;
      }
      let j = i;
      while (j < tokens.length && tokens[j].type === MixedTokenType.Chinese) {
        j++;
      }
      // A run at the very start, or after punctuation, starts a sentence.
      // After English or digits the previous word is unknown.
      let left: string | null = null;
      if (i === 0) {
        left = options.context === "zh" ? null : kSentenceStart;
      } else if (tokens[i - 1].type === MixedTokenType.Punctuation) {
        left = kSentenceStart;
      }
      for (const t of this.rescoreRun_(tokens.slice(i, j), left)) {
        out.push(t);
      }
      i = j;
    }
    return out;
  }

  /**
   * Viterbi over a phrase lattice for one Chinese run: unigram scores plus
   * weighted word-pair bonuses. Phrases the user picked stay as they are.
   */
  private rescoreRun_(run: MixedToken[], left: string | null): MixedToken[] {
    const P = this.params;
    const bigram = this.bigramModel!;
    const readings: string[] = [];
    const starts: number[] = [];
    const pinnedAt = new Map<number, MixedToken>();
    for (const t of run) {
      if (t.isOverride) {
        pinnedAt.set(readings.length, t);
      }
      t.syllables!.forEach((r, k) => {
        readings.push(r);
        starts.push(t.syllableStarts![k]);
      });
    }
    const n = readings.length;
    const runEnd = run[run.length - 1].end;
    const rawAt = (index: number): number =>
      index < n ? starts[index] : runEnd;
    const covered: boolean[] = new Array(n).fill(false);
    for (const [at, t] of pinnedAt) {
      for (let k = 0; k < t.syllables!.length; k++) {
        covered[at + k] = true;
      }
    }

    const nodesFrom = (s: number): LatticeNode[] => {
      const pinned = pinnedAt.get(s);
      if (pinned) {
        return [
          {
            start: s,
            end: s + pinned.syllables!.length,
            value: pinned.output,
            score: 0,
            pinned,
          },
        ];
      }
      if (covered[s]) {
        return [];
      }
      const nodes: LatticeNode[] = [];
      for (let k = 1; k <= P.maxPhraseSyllables && s + k <= n; k++) {
        if (covered[s + k - 1]) {
          break;
        }
        const reading = readings.slice(s, s + k).join("-");
        const unigrams = this.unigrams_(reading).slice(
          0,
          P.bigramPhrasesPerReading,
        );
        for (const u of unigrams) {
          nodes.push({
            start: s,
            end: s + k,
            value: u.value,
            score: u.score - P.zhTokenPenalty,
          });
        }
      }
      return nodes;
    };

    const ending: Hypothesis[][] = [];
    for (let k = 0; k <= n; k++) {
      ending.push([]);
    }
    for (const node of nodesFrom(0)) {
      const bonus = left === null ? 0 : bigram.bonus(left, node.value);
      ending[node.end].push({
        node,
        score: node.score + P.bigramWeight * bonus,
        prev: null,
      });
    }
    for (let s = 1; s < n; s++) {
      if (ending[s].length === 0) {
        continue;
      }
      ending[s].sort((a, b) => b.score - a.score);
      const kept = ending[s].slice(0, P.bigramBeam);
      ending[s] = kept;
      for (const node of nodesFrom(s)) {
        let best: Hypothesis = kept[0];
        let bestScore = Number.NEGATIVE_INFINITY;
        for (const h of kept) {
          const score =
            h.score + P.bigramWeight * bigram.bonus(h.node.value, node.value);
          if (score > bestScore) {
            bestScore = score;
            best = h;
          }
        }
        ending[node.end].push({
          node,
          score: bestScore + node.score,
          prev: best,
        });
      }
    }
    if (ending[n].length === 0) {
      return run;
    }
    let h: Hypothesis | null = ending[n].reduce((a, b) =>
      b.score > a.score ? b : a,
    );
    const result: MixedToken[] = [];
    while (h) {
      const node = h.node;
      if (node.pinned) {
        result.push({ ...node.pinned });
      } else {
        const syllables = readings.slice(node.start, node.end);
        const syllableStarts: number[] = [];
        for (let k = node.start; k <= node.end; k++) {
          syllableStarts.push(rawAt(k));
        }
        result.push({
          start: rawAt(node.start),
          end: rawAt(node.end),
          lang: "zh",
          type: MixedTokenType.Chinese,
          text: node.value,
          output: node.value,
          cost: -node.score,
          reading: syllables.join("-"),
          syllables,
          syllableStarts,
        });
      }
      h = h.prev;
    }
    return result.reverse();
  }

  /**
   * How sure the decoder is that `token` is in its language: compares the best
   * path with the best path that reads the same keys in the other language.
   * Returns 1 when the other language cannot read these keys at all.
   */
  confidence(
    raw: string,
    options: DecodeOptions,
    token: MixedToken,
    bestCost?: number,
  ): { probability: number; alternative?: string } {
    if (!token.lang) {
      return { probability: 1 };
    }
    const best = bestCost ?? this.decode(raw, options).cost;
    const flip: MixedLanguage = token.lang === "zh" ? "en" : "zh";
    const alt = this.decode(raw, {
      ...options,
      forced: (options.forced ?? []).concat([
        { start: token.start, end: token.end, lang: flip },
      ]),
    });
    const overlapping = alt.tokens.filter(
      (t) => t.start < token.end && t.end > token.start,
    );
    const flipped = overlapping.some((t) => t.lang === flip);
    if (!flipped || alt.cost >= best + this.params.force * 0.5) {
      return { probability: 1 };
    }
    const d = alt.cost - best;
    return {
      probability: 1 / (1 + Math.pow(10, -d)),
      alternative: overlapping.map((t) => t.output).join(""),
    };
  }

  /**
   * Phrases that end at syllable `index` of `run`, longest first, the way
   * McBopomofo lists candidates for the cursor position.
   */
  candidates(run: RunSyllable[], index: number): PhraseCandidate[] {
    const result: PhraseCandidate[] = [];
    const seen = new Set<string>();
    const maxLen = Math.min(this.params.maxPhraseSyllables, index + 1);
    for (let k = maxLen; k >= 1; k--) {
      const part = run.slice(index - k + 1, index + 1);
      const reading = part.map((s) => s.reading).join("-");
      for (const u of this.unigrams_(reading)) {
        const key = u.value + "@" + k;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        result.push({
          value: u.value,
          reading,
          start: part[0].start,
          end: part[part.length - 1].end,
          syllableStarts: part
            .map((s) => s.start)
            .concat([part[part.length - 1].end]),
          score: u.score,
          length: k,
        });
      }
    }
    return result;
  }
}

/** For tests: the key sequence that types `reading` on `layout`. */
export function keysForReading(
  reading: string,
  layout: BopomofoKeyboardLayout,
): string {
  return reading
    .split("-")
    .map((r) => {
      const s = BopomofoSyllable.FromComposedString(r);
      const keys = layout.keySequenceFromSyllable(s);
      return s.hasToneMarker ? keys : keys + " ";
    })
    .join("");
}
