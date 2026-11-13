/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

import {
  DecodeOptions,
  DecodeResult,
  ForcedRange,
  MixedDecoder,
  MixedLanguage,
  MixedToken,
  MixedTokenType,
  PhraseOverride,
  RunSyllable,
} from "./MixedDecoder";

/** One part of the composing text, for hosts that can style segments. */
export interface ComposingSegment {
  readonly text: string;
  readonly lang: MixedLanguage | null;
  readonly pending: boolean;
  /** Whether this segment is the one the cursor is on. */
  readonly focused: boolean;
}

export interface ComposingView {
  /** The text to show, with automatic spacing applied. */
  readonly text: string;
  /** Cursor position in `text`, after the focused unit. */
  readonly cursorIndex: number;
  readonly segments: ComposingSegment[];
  /**
   * Where the unit under the cursor is in `text` (end exclusive): the
   * character or word that candidates replace.
   */
  readonly focusRange?: { start: number; end: number };
  /** Completion offered for the last English word (accepted with Tab). */
  readonly prediction?: string;
}

export enum MixedCandidateKind {
  Phrase = "phrase",
  Flip = "flip",
  Completion = "completion",
}

export interface MixedCandidate {
  readonly kind: MixedCandidateKind;
  /** What the candidate window shows. */
  readonly label: string;
  /** Phrase: the value; flip: the target language; completion: the word. */
  readonly value: string;
  readonly reading: string;
  readonly phrase?: {
    start: number;
    end: number;
    syllableStarts: number[];
  };
  readonly token?: MixedToken;
}

/** A unit the cursor can stop on: a Chinese syllable or an English word. */
interface Unit {
  readonly kind: "zh" | "en" | "pend" | "num";
  readonly tokenIndex: number;
  /** Syllable index inside the token (Chinese only). */
  readonly syllable: number;
  readonly start: number;
  readonly end: number;
}

const kAutoCommitLength = 48;
const kAutoCommitKeep = 20;

function isHan(c: string): boolean {
  return /[㄀-ㄯ㐀-鿿豈-﫿]/.test(c);
}

function isAsciiWordChar(c: string): boolean {
  return /[A-Za-z0-9]/.test(c);
}

/**
 * Whether a space belongs between two adjacent characters: one Chinese, the
 * other an English letter or a digit ("幫我 check 一下").
 */
export function needsSpaceBetween(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  return (isHan(a) && isAsciiWordChar(b)) || (isAsciiWordChar(a) && isHan(b));
}

/**
 * The editing state of one mixed-input composition: the raw keys typed so
 * far, the user's corrections, and the cursor. Platform shells (McBopomofo's
 * KeyHandler, the macOS app) drive it and render what it returns.
 */
export class MixedComposer {
  private raw_ = "";
  private forced_: ForcedRange[] = [];
  private overrides_: PhraseOverride[] = [];
  /** Index into units; null means the last unit. */
  private focus_: number | null = null;
  private result_: DecodeResult | undefined;
  private units_: Unit[] = [];
  /** The last Bopomofo syllable was switched to English while being typed. */
  private extendEnglish_ = false;

  /** Treat everything typed as English until turned off. */
  englishLock = false;
  /** Insert a space between Chinese and English/digits. */
  autoSpace = true;
  /** The character right before the composition, if known. */
  precedingCharacter = "";

  constructor(readonly decoder: MixedDecoder) {}

  get raw(): string {
    return this.raw_;
  }

  get isEmpty(): boolean {
    return this.raw_.length === 0;
  }

  private get context_(): MixedLanguage | null {
    const c = this.precedingCharacter.trimEnd().slice(-1);
    if (!c) {
      return null;
    }
    if (isHan(c)) {
      return "zh";
    }
    if (/[A-Za-z]/.test(c)) {
      return "en";
    }
    return null;
  }

  private options_(extra: Partial<DecodeOptions> = {}): DecodeOptions {
    return {
      forced: this.forced_,
      overrides: this.overrides_,
      context: this.context_,
      ...extra,
    };
  }

  private update_(): void {
    this.result_ = this.decoder.decode(this.raw_, this.options_());
    this.units_ = [];
    this.result_.tokens.forEach((t, ti) => {
      if (t.type === MixedTokenType.Chinese) {
        const chars = Array.from(t.output);
        const syllables = t.syllables!;
        if (chars.length === syllables.length) {
          syllables.forEach((_, k) => {
            this.units_.push({
              kind: "zh",
              tokenIndex: ti,
              syllable: k,
              start: t.syllableStarts![k],
              end: t.syllableStarts![k + 1],
            });
          });
        } else {
          this.units_.push({
            kind: "zh",
            tokenIndex: ti,
            syllable: syllables.length - 1,
            start: t.start,
            end: t.end,
          });
        }
      } else if (t.type === MixedTokenType.Pending) {
        this.units_.push({
          kind: "pend",
          tokenIndex: ti,
          syllable: 0,
          start: t.start,
          end: t.end,
        });
      } else if (t.lang === "en") {
        this.units_.push({
          kind: "en",
          tokenIndex: ti,
          syllable: 0,
          start: t.start,
          end: t.end,
        });
      } else if (t.type === MixedTokenType.Number) {
        // Digits can be Bopomofo too, so the cursor can stop on a number and
        // Shift can flip it.
        this.units_.push({
          kind: "num",
          tokenIndex: ti,
          syllable: 0,
          start: t.start,
          end: t.end,
        });
      }
    });
    if (this.focus_ !== null && this.focus_ >= this.units_.length) {
      this.focus_ = null;
    }
  }

  /** The current decoding. */
  get result(): DecodeResult {
    if (!this.result_) {
      this.update_();
    }
    return this.result_!;
  }

  get tokens(): MixedToken[] {
    return this.result.tokens;
  }

  private get focusIndex_(): number {
    if (!this.result_) {
      this.update_();
    }
    if (this.units_.length === 0) {
      return -1;
    }
    return this.focus_ === null || this.focus_ >= this.units_.length
      ? this.units_.length - 1
      : this.focus_;
  }

  /**
   * How sure the decoder is about a token's language (0 to 1), and how the
   * same keys would read in the other language. Tokens the user set by hand
   * report `manual`.
   */
  confidence(token: MixedToken): {
    probability: number;
    alternative?: string;
    manual: boolean;
  } {
    const manual =
      token.isOverride === true ||
      this.forced_.some((f) => f.start < token.end && f.end > token.start);
    if (manual || !token.lang) {
      return { probability: 1, manual };
    }
    const r = this.decoder.confidence(
      this.raw_,
      this.options_(),
      token,
      this.result.cost,
    );
    return { ...r, manual: false };
  }

  /** The token the cursor is on. */
  get focusedToken(): MixedToken | undefined {
    const u = this.units_[this.focusIndex_];
    return u ? this.result.tokens[u.tokenIndex] : undefined;
  }

  private addForced_(start: number, end: number, lang: MixedLanguage): void {
    const last = this.forced_[this.forced_.length - 1];
    if (last && last.lang === lang && last.end === start) {
      this.forced_[this.forced_.length - 1] = { start: last.start, end, lang };
    } else {
      this.forced_.push({ start, end, lang });
    }
  }

  /**
   * Adds a typed character.
   * @param fromNumpad Digits from the numeric keypad are always numbers.
   */
  insert(ch: string, fromNumpad: boolean = false): void {
    const pos = this.raw_.length;
    this.raw_ += ch;
    if (this.englishLock || fromNumpad) {
      this.addForced_(pos, pos + 1, "en");
    } else if (this.extendEnglish_ && /[A-Za-z']/.test(ch)) {
      this.addForced_(pos, pos + 1, "en");
    } else {
      this.extendEnglish_ = false;
    }
    this.focus_ = null;
    this.update_();
  }

  /** Deletes the last key. Returns false if there was nothing to delete. */
  backspace(): boolean {
    if (this.isEmpty) {
      return false;
    }
    this.raw_ = this.raw_.substring(0, this.raw_.length - 1);
    const n = this.raw_.length;
    this.overrides_ = this.overrides_.filter((o) => o.end <= n);
    this.forced_ = this.forced_
      .filter((f) => f.start < n)
      .map((f) => ({ start: f.start, end: Math.min(f.end, n), lang: f.lang }));
    this.focus_ = null;
    this.update_();
    return true;
  }

  clear(): void {
    this.raw_ = "";
    this.forced_ = [];
    this.overrides_ = [];
    this.focus_ = null;
    this.extendEnglish_ = false;
    this.update_();
  }

  /** Whether the cursor is at the end of the text. */
  get isAtEnd(): boolean {
    return this.focus_ === null;
  }

  /** Moves the cursor by units. Returns false if it cannot move. */
  moveFocus(delta: number): boolean {
    if (this.focusIndex_ < 0) {
      return false;
    }
    const next = this.focusIndex_ + delta;
    if (next < 0 || next >= this.units_.length) {
      return false;
    }
    this.focus_ = next === this.units_.length - 1 ? null : next;
    return true;
  }

  /** The completion for the last English word, if any. */
  get prediction(): string | undefined {
    const tokens = this.result.tokens;
    const last = tokens[tokens.length - 1];
    if (last && last.prediction && last.end === this.raw_.length) {
      return last.prediction;
    }
    return undefined;
  }

  /** Types the rest of the predicted word. Returns false if none. */
  acceptPrediction(): boolean {
    const tokens = this.result.tokens;
    const last = tokens[tokens.length - 1];
    const prediction = this.prediction;
    if (!prediction || !last.word) {
      return false;
    }
    const rest = prediction.substring(last.word.length);
    const start = this.raw_.length;
    this.raw_ += rest;
    this.addForced_(last.start, start + rest.length, "en");
    this.update_();
    return true;
  }

  /**
   * Switches the token under the cursor to the other language (Shift tap).
   * Returns false if the keys cannot be read in the other language.
   */
  flip(): boolean {
    const unit = this.units_[this.focusIndex_];
    if (!unit) {
      return false;
    }
    const token = this.result.tokens[unit.tokenIndex];
    if (unit.kind === "pend") {
      // Still typing a syllable: treat it, and the letters that follow, as
      // English.
      this.forced_ = this.forced_.filter((f) => f.end <= token.start);
      this.addForced_(token.start, this.raw_.length, "en");
      this.extendEnglish_ = true;
      this.update_();
      return true;
    }
    return this.flipToken(token);
  }

  /**
   * Switches `token` to the other language. Digits switch between a number
   * and Chinese.
   */
  flipToken(token: MixedToken): boolean {
    const to: MixedLanguage = token.lang === "zh" ? "en" : "zh";
    // Forced English keeps digits as a number; a digit string flipped away
    // from Chinese has to come out as a number.
    const digits = /^[0-9]+$/.test(this.raw_.substring(token.start, token.end));
    const savedForced = this.forced_.slice();
    const savedOverrides = this.overrides_.slice();
    const overlaps = (r: { start: number; end: number }): boolean =>
      r.start < token.end && r.end > token.start;
    this.forced_ = this.forced_.filter((f) => !overlaps(f));
    this.overrides_ = this.overrides_.filter((o) => !overlaps(o));
    const reads = (r: DecodeResult): boolean =>
      r.tokens.some(
        (t) =>
          overlaps(t) &&
          (t.lang === to ||
            (digits && to === "en" && t.type === MixedTokenType.Number)),
      );
    // If automatic detection already gives the target language once the
    // user's earlier choice is removed, don't force anything.
    let after = this.decoder.decode(this.raw_, this.options_());
    if (!reads(after)) {
      this.forced_.push({ start: token.start, end: token.end, lang: to });
      this.forced_.sort((a, b) => a.start - b.start);
      after = this.decoder.decode(this.raw_, this.options_());
      if (!reads(after)) {
        this.forced_ = savedForced;
        this.overrides_ = savedOverrides;
        this.update_();
        return false;
      }
    }
    this.update_();
    return true;
  }

  /** The consecutive Chinese syllables around a unit, for candidates. */
  private runFor_(unit: Unit): { run: RunSyllable[]; index: number } {
    const tokens = this.result.tokens;
    let a = unit.tokenIndex;
    let b = unit.tokenIndex;
    while (a > 0 && tokens[a - 1].type === MixedTokenType.Chinese) {
      a--;
    }
    while (
      b < tokens.length - 1 &&
      tokens[b + 1].type === MixedTokenType.Chinese
    ) {
      b++;
    }
    const run: RunSyllable[] = [];
    let index = -1;
    for (let i = a; i <= b; i++) {
      const t = tokens[i];
      t.syllables!.forEach((reading, k) => {
        run.push({
          reading,
          start: t.syllableStarts![k],
          end: t.syllableStarts![k + 1],
        });
        if (i === unit.tokenIndex && k === unit.syllable) {
          index = run.length - 1;
        }
      });
    }
    return { run, index };
  }

  private rawOf_(token: MixedToken): string {
    return this.raw_.substring(token.start, token.end).replace(/ $/, "");
  }

  /** Choices for the unit under the cursor. */
  candidates(): MixedCandidate[] {
    const unit = this.units_[this.focusIndex_];
    if (!unit) {
      return [];
    }
    const token = this.result.tokens[unit.tokenIndex];
    const list: MixedCandidate[] = [];
    if (unit.kind === "zh") {
      const { run, index } = this.runFor_(unit);
      for (const c of this.decoder.candidates(run, index)) {
        list.push({
          kind: MixedCandidateKind.Phrase,
          label: c.value,
          value: c.value,
          reading: c.reading,
          phrase: {
            start: c.start,
            end: c.end,
            syllableStarts: c.syllableStarts,
          },
        });
      }
      list.push({
        kind: MixedCandidateKind.Flip,
        label: "⇄ " + this.rawOf_(token),
        value: "en",
        reading: "_mix_flip_en",
        token,
      });
    } else if (unit.kind === "en" || unit.kind === "num") {
      // English words and numbers offer their Chinese reading.
      const alt = this.decoder.decode(
        this.raw_,
        this.options_({
          forced: this.forced_.concat([
            { start: token.start, end: token.end, lang: "zh" },
          ]),
        }),
      );
      const altText = alt.tokens
        .filter(
          (t) => t.start < token.end && t.end > token.start && t.lang === "zh",
        )
        .map((t) => t.output)
        .join("");
      if (altText) {
        list.push({
          kind: MixedCandidateKind.Flip,
          label: "⇄ " + altText,
          value: "zh",
          reading: "_mix_flip_zh",
          token,
        });
      }
      if (token.word && token.end === this.raw_.length) {
        for (const c of this.decoder.englishModel.completions(token.word, 8)) {
          if (c.word !== token.word.toLowerCase()) {
            list.push({
              kind: MixedCandidateKind.Completion,
              label: c.word,
              value: c.word,
              reading: "_mix_complete",
              token,
            });
          }
        }
      }
    }
    return list;
  }

  /**
   * The index in `list` (from {@link candidates}) of the phrase the text uses
   * now, so a candidate window can start there; 0 when none matches.
   */
  currentCandidateIndex(list: MixedCandidate[]): number {
    const unit = this.units_[this.focusIndex_];
    if (!unit || unit.kind !== "zh") {
      return 0;
    }
    // The current character of each Chinese syllable, by its raw position.
    const charAt = new Map<number, string>();
    for (const t of this.result.tokens) {
      if (t.type !== MixedTokenType.Chinese || !t.syllables) {
        continue;
      }
      const chars = Array.from(t.output);
      if (chars.length !== t.syllables.length) {
        continue;
      }
      t.syllables.forEach((_, k) => charAt.set(t.syllableStarts![k], chars[k]));
    }
    const index = list.findIndex((c) => {
      if (c.kind !== MixedCandidateKind.Phrase || !c.phrase) {
        return false;
      }
      const starts = c.phrase.syllableStarts.slice(0, -1);
      const now = starts.map((p) => charAt.get(p) ?? "\u0000").join("");
      return now === c.value;
    });
    return Math.max(0, index);
  }

  /** Applies a candidate from {@link candidates}. */
  selectCandidate(candidate: MixedCandidate): boolean {
    switch (candidate.kind) {
      case MixedCandidateKind.Phrase: {
        const p = candidate.phrase!;
        const overlaps = (r: { start: number; end: number }): boolean =>
          r.start < p.end && r.end > p.start;
        this.overrides_ = this.overrides_.filter((o) => !overlaps(o));
        this.forced_ = this.forced_.filter((f) => !overlaps(f));
        this.overrides_.push({
          start: p.start,
          end: p.end,
          value: candidate.value,
          reading: candidate.reading,
          syllableStarts: p.syllableStarts,
        });
        const key = candidate.reading + "|" + candidate.value;
        const v = (this.decoder.phraseBias.get(key) ?? 0) + 1.2;
        this.decoder.phraseBias.set(key, Math.min(3, v));
        this.decoder.clearCache();
        this.update_();
        return true;
      }
      case MixedCandidateKind.Flip:
        return this.flipToken(candidate.token!);
      case MixedCandidateKind.Completion: {
        const t = candidate.token!;
        if (!t.word || t.end !== this.raw_.length) {
          return false;
        }
        const rest = candidate.value.substring(t.word.length);
        this.raw_ += rest;
        this.addForced_(t.start, this.raw_.length, "en");
        this.update_();
        return true;
      }
    }
    return false;
  }

  /**
   * Words the user switched by hand and kept until commit make the same
   * reading more (or less) likely next time.
   */
  private learnFromFlips_(r: DecodeResult): void {
    if (!this.englishLock) {
      this.learnDigitFlips_(r);
    }
    for (const t of r.tokens) {
      if (!t.lang) {
        continue;
      }
      const forced = this.forced_.find(
        (f) => f.start <= t.start && f.end >= t.end && f.lang === t.lang,
      );
      if (!forced || this.englishLock) {
        continue;
      }
      const word = this.raw_.substring(t.start, t.end).trim().toLowerCase();
      if (!/^[a-z']+$/.test(word)) {
        continue;
      }
      const delta = t.lang === "zh" ? -0.8 : 0.8;
      const v = (this.decoder.englishBias.get(word) ?? 0) + delta;
      this.decoder.englishBias.set(word, Math.max(-3, Math.min(3, v)));
    }
  }

  /**
   * Digit strings the user flipped and kept: remember the last choice, as a
   * number or as Chinese.
   */
  private learnDigitFlips_(r: DecodeResult): void {
    for (const t of r.tokens) {
      const text = this.raw_.substring(t.start, t.end).trim();
      if (!/^[0-9]+$/.test(text)) {
        continue;
      }
      const kept = this.forced_.find(
        (f) => f.start <= t.start && f.end >= t.start + text.length,
      );
      if (!kept) {
        continue;
      }
      if (t.type === MixedTokenType.Number && kept.lang === "en") {
        this.decoder.digitsBias.set(text, -2);
      } else if (t.lang === "zh" && kept.lang === "zh") {
        this.decoder.digitsBias.set(text, 2);
      }
    }
  }

  /** Text for a list of tokens, with automatic spacing. */
  private join_(tokens: MixedToken[], before: string): string {
    let out = "";
    let last = before.slice(-1);
    for (const t of tokens) {
      const text = t.output;
      if (!text) {
        continue;
      }
      if (this.autoSpace && needsSpaceBetween(last, text[0])) {
        out += " ";
      }
      out += text;
      last = text[text.length - 1];
    }
    return out;
  }

  /** What to show while composing. */
  view(): ComposingView {
    const tokens = this.result.tokens;
    const focusUnit = this.units_[this.focusIndex_];
    const segments: ComposingSegment[] = [];
    let text = "";
    let cursorIndex = 0;
    let focusRange: { start: number; end: number } | undefined;
    let last = this.precedingCharacter.slice(-1);
    tokens.forEach((t, ti) => {
      if (!t.output) {
        return;
      }
      if (this.autoSpace && needsSpaceBetween(last, t.output[0])) {
        text += " ";
        segments.push({
          text: " ",
          lang: null,
          pending: false,
          focused: false,
        });
      }
      const focused = focusUnit !== undefined && focusUnit.tokenIndex === ti;
      if (focused) {
        if (t.type === MixedTokenType.Chinese && focusUnit.kind === "zh") {
          const chars = Array.from(t.output);
          const oneCharEach = chars.length === t.syllables!.length;
          const before = oneCharEach
            ? chars.slice(0, focusUnit.syllable).join("")
            : "";
          const upTo = oneCharEach
            ? chars.slice(0, focusUnit.syllable + 1).join("")
            : t.output;
          cursorIndex = text.length + upTo.length;
          focusRange = {
            start: text.length + before.length,
            end: cursorIndex,
          };
        } else {
          cursorIndex = text.length + t.output.replace(/ $/, "").length;
          focusRange = { start: text.length, end: cursorIndex };
        }
      }
      text += t.output;
      segments.push({
        text: t.output,
        lang: t.lang,
        pending: t.type === MixedTokenType.Pending,
        focused,
      });
      last = t.output[t.output.length - 1];
    });
    if (!focusUnit) {
      cursorIndex = text.length;
    }
    return {
      text,
      cursorIndex,
      segments,
      focusRange,
      prediction: this.prediction,
    };
  }

  /**
   * Finishes the composition and returns the text to insert. Unfinished
   * syllables are read as letters.
   */
  commit(): string {
    if (this.isEmpty) {
      return "";
    }
    const r = this.decoder.decode(this.raw_, this.options_({ final: true }));
    this.learnFromFlips_(r);
    const text = this.join_(r.tokens, this.precedingCharacter);
    this.precedingCharacter = (this.precedingCharacter + text).slice(-8);
    this.clear();
    return text;
  }

  /**
   * When the composition gets long, commits everything except the last few
   * tokens so the composing text stays short. Returns the committed text.
   */
  commitOverflow(): string {
    if (this.raw_.length <= kAutoCommitLength) {
      return "";
    }
    const tokens = this.result.tokens;
    let cut = 0;
    for (const t of tokens) {
      if (this.raw_.length - t.end < kAutoCommitKeep) {
        break;
      }
      cut = t.end;
    }
    if (cut === 0) {
      return "";
    }
    const text = this.join_(
      tokens.filter((t) => t.end <= cut),
      this.precedingCharacter,
    );
    this.precedingCharacter = (this.precedingCharacter + text).slice(-8);
    this.raw_ = this.raw_.substring(cut);
    this.forced_ = this.forced_
      .filter((f) => f.end > cut)
      .map((f) => ({
        start: Math.max(0, f.start - cut),
        end: f.end - cut,
        lang: f.lang,
      }));
    this.overrides_ = this.overrides_
      .filter((o) => o.start >= cut)
      .map((o) => ({
        ...o,
        start: o.start - cut,
        end: o.end - cut,
        syllableStarts: o.syllableStarts.map((p) => p - cut),
      }));
    this.focus_ = null;
    this.update_();
    return text;
  }

  /** Learned adjustments, to save between sessions. */
  exportLearning(): string {
    return JSON.stringify({
      en: Object.fromEntries(this.decoder.englishBias),
      zh: Object.fromEntries(this.decoder.phraseBias),
      digits: Object.fromEntries(this.decoder.digitsBias),
    });
  }

  importLearning(json: string): void {
    try {
      const d = JSON.parse(json);
      for (const [k, v] of Object.entries(d.en ?? {})) {
        if (typeof v === "number") {
          this.decoder.englishBias.set(k, v);
        }
      }
      for (const [k, v] of Object.entries(d.zh ?? {})) {
        if (typeof v === "number") {
          this.decoder.phraseBias.set(k, v);
        }
      }
      for (const [k, v] of Object.entries(d.digits ?? {})) {
        if (typeof v === "number" && /^[0-9]+$/.test(k)) {
          this.decoder.digitsBias.set(k, Math.max(-3, Math.min(3, v)));
        }
      }
      this.decoder.clearCache();
    } catch (e) {
      // Ignore malformed data.
    }
  }
}
