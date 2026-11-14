/**
 * What the input method learns from one user, on their own computer: the
 * phrases and word pairs they type, the words they pick over the ones offered,
 * the English words they use, and how much English they type in each program.
 * Nothing here leaves the machine; the owner saves {@link PersonalModel.save}
 * to a file.
 */

/** One word of a sentence the user committed. */
export interface LearnedToken {
  /** Chinese, an English word, or anything else (punctuation, numbers). */
  kind: "zh" | "en" | "other";
  /** The text. */
  value: string;
  /** Chinese: the joined reading, e.g. "ㄋㄧˇ-ㄏㄠˇ". */
  reading?: string;
  /** Chinese: the user picked this from the candidates. */
  corrected?: boolean;
  /** Chinese: what the input method had offered instead, if known. */
  rejected?: string;
}

/** How large the model may grow before the least used entries go. */
export interface PersonalModelLimits {
  maxPhrases: number;
  maxPairs: number;
  maxWords: number;
}

interface PhraseEntry {
  /** Times committed. */
  n: number;
  /** Corrections that should decide (net of being rejected), -2..3. */
  c: number;
  /** Corrections that should only nudge (net), 0..3. */
  m: number;
}

const kDefaultLimits: PersonalModelLimits = {
  maxPhrases: 30000,
  maxPairs: 60000,
  maxWords: 5000,
};

const kMaxSyllables = 6;
const kMaxApps = 200;
/** A bonus that grows slowly with use: +0.15 the first time, at most 0.6. */
const usageBonus = (n: number): number =>
  n <= 0 ? 0 : Math.min(0.6, 0.15 * Math.log2(1 + n));
const clamp = (v: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, v));
const syllableCount = (reading: string): number => reading.split("-").length;
const isWord = (word: string): boolean => /^[a-z']{2,32}$/.test(word);
const normalizeApp = (app: string | undefined): string =>
  (app ?? "").trim().toLowerCase().slice(0, 64);

/** Learns from what one user types. */
export class PersonalModel {
  /** reading → value → entry. */
  private phrases_ = new Map<string, Map<string, PhraseEntry>>();
  private phraseCount_ = 0;
  /** "previous\tnext" → times seen (corrections count four times). */
  private pairs_ = new Map<string, number>();
  /** English word → times typed. */
  private words_ = new Map<string, number>();
  /** Program → [Chinese words, English words] typed there. */
  private apps_ = new Map<string, [number, number]>();
  /** "program\tword" → bias, positive favors English. */
  private appWords_ = new Map<string, number>();
  private revision_ = 0;
  private readonly limits_: PersonalModelLimits;

  constructor(limits: Partial<PersonalModelLimits> = {}) {
    this.limits_ = { ...kDefaultLimits, ...limits };
  }

  /** Goes up whenever the model changes, so the owner knows when to save. */
  get revision(): number {
    return this.revision_;
  }

  /** True when nothing has been learned. */
  get isEmpty(): boolean {
    return (
      this.phraseCount_ === 0 &&
      this.pairs_.size === 0 &&
      this.words_.size === 0 &&
      this.apps_.size === 0 &&
      this.appWords_.size === 0
    );
  }

  private entry_(reading: string, value: string): PhraseEntry {
    let byValue = this.phrases_.get(reading);
    if (!byValue) {
      byValue = new Map();
      this.phrases_.set(reading, byValue);
    }
    let entry = byValue.get(value);
    if (!entry) {
      entry = { n: 0, c: 0, m: 0 };
      byValue.set(value, entry);
      this.phraseCount_++;
    }
    return entry;
  }

  /**
   * Added to a phrase's score (log10): a little for phrases the user types,
   * a nudge for ones they picked, a penalty for ones they replaced.
   */
  phraseBonus(reading: string, value: string): number {
    const entry = this.phrases_.get(reading)?.get(value);
    if (!entry) {
      return 0;
    }
    return usageBonus(entry.n) + 0.15 * entry.m + Math.min(0, entry.c);
  }

  /**
   * How far above the best dictionary phrase for the reading this phrase
   * should rank (0 when it should not): set by corrections that should stick.
   */
  lift(reading: string, value: string): number {
    const c = this.phrases_.get(reading)?.get(value)?.c ?? 0;
    return c > 0 ? 0.5 + 0.5 * c : 0;
  }

  /** The phrases the user's corrections made for a reading. */
  userPhrases(reading: string): string[] {
    const byValue = this.phrases_.get(reading);
    if (!byValue) {
      return [];
    }
    const values: string[] = [];
    for (const [value, entry] of byValue) {
      if (entry.c > 0) {
        values.push(value);
      }
    }
    return values;
  }

  /** Added to the score when `next` follows `prev` (log10). */
  pairBonus(prev: string, next: string): number {
    return usageBonus(this.pairs_.get(prev + "\t" + next) ?? 0);
  }

  /** Added to an English word's score (log10). */
  wordBonus(word: string): number {
    return usageBonus(this.words_.get(word) ?? 0);
  }

  /**
   * The score (log10 probability) of a word the dictionary does not have,
   * once the user has typed it three times; undefined before that.
   */
  wordScore(word: string): number | undefined {
    const n = this.words_.get(word) ?? 0;
    return n >= 3 && isWord(word) ? -5 + usageBonus(n) : undefined;
  }

  /**
   * Added to a word's English score in one program, from the times the user
   * switched it there by hand (positive favors English).
   */
  appWordBias(app: string, word: string): number {
    const name = normalizeApp(app);
    return name ? (this.appWords_.get(name + "\t" + word) ?? 0) : 0;
  }

  /**
   * How much a program leans toward English compared with the user's typing
   * overall (log10, -0.8..0.8; 0 until there is enough to go on).
   */
  languageBias(app: string): number {
    const counts = this.apps_.get(normalizeApp(app));
    if (!counts || counts[0] + counts[1] < 40) {
      return 0;
    }
    let zh = 0;
    let en = 0;
    for (const [z, e] of this.apps_.values()) {
      zh += z;
      en += e;
    }
    const odds = (z: number, e: number): number =>
      Math.log10((e + 10) / (z + 10));
    return clamp(0.6 * (odds(counts[0], counts[1]) - odds(zh, en)), -0.8, 0.8);
  }

  /** Remembers that the user switched `word` to `lang` by hand in a program. */
  learnFlip(app: string, word: string, lang: "zh" | "en"): void {
    const name = normalizeApp(app);
    if (!name || !isWord(word)) {
      return;
    }
    const key = name + "\t" + word;
    const v = (this.appWords_.get(key) ?? 0) + (lang === "en" ? 1.2 : -1.2);
    this.appWords_.set(key, clamp(v, -3, 3));
    this.revision_++;
  }

  /**
   * Learns from a committed sentence.
   * @param tokens Its words, in order.
   * @param app The program it was typed in, if known.
   */
  learnSentence(tokens: LearnedToken[], app?: string): void {
    let zhCount = 0;
    let enCount = 0;
    const isZh = (t: LearnedToken | undefined): t is LearnedToken =>
      t !== undefined && t.kind === "zh" && !!t.reading && !!t.value;
    tokens.forEach((t, i) => {
      if (t.kind === "en") {
        const word = t.value.toLowerCase();
        if (isWord(word)) {
          this.words_.set(word, Math.min(100000, (this.words_.get(word) ?? 0) + 1));
          enCount++;
        }
        return;
      }
      if (!isZh(t)) {
        return;
      }
      zhCount++;
      const entry = this.entry_(t.reading!, t.value);
      entry.n = Math.min(100000, entry.n + 1);
      const next = tokens[i + 1];
      if (isZh(next)) {
        const key = t.value + "\t" + next.value;
        const weight = t.corrected || next.corrected ? 4 : 1;
        this.pairs_.set(key, Math.min(100000, (this.pairs_.get(key) ?? 0) + weight));
      }
      if (t.corrected) {
        this.learnCorrection_(tokens, i, isZh);
      }
    });
    this.learnRuns_(tokens, isZh);
    const name = normalizeApp(app);
    if (name && zhCount + enCount > 0) {
      if (this.apps_.has(name) || this.apps_.size < kMaxApps) {
        const counts = this.apps_.get(name) ?? [0, 0];
        this.apps_.set(name, [counts[0] + zhCount, counts[1] + enCount]);
      }
    }
    this.pruneIfLarge_(1.5);
    this.revision_++;
  }

  /** The decided correction of one phrase, and of what it replaced. */
  private decide_(reading: string, value: string, rejected?: string): void {
    const entry = this.entry_(reading, value);
    entry.c = clamp(entry.c + 1, -2, 3);
    if (rejected !== undefined && rejected !== value) {
      const other = this.entry_(reading, rejected);
      other.c = clamp(other.c - 1, -2, 3);
    }
  }

  /**
   * A picked word is learned together with the word before and the word after
   * it, so the same reading elsewhere is left alone (的 and 得). Only a word
   * with no Chinese around it is learned by itself.
   */
  private learnCorrection_(
    tokens: LearnedToken[],
    i: number,
    isZh: (t: LearnedToken | undefined) => t is LearnedToken,
  ): void {
    const t = tokens[i];
    const reading = t.reading!;
    const fits = (other: LearnedToken): boolean =>
      syllableCount(reading) + syllableCount(other.reading!) <= kMaxSyllables;
    const rejected =
      t.rejected !== undefined && t.rejected !== t.value ? t.rejected : undefined;
    let joined = false;
    const prev = tokens[i - 1];
    if (isZh(prev) && fits(prev)) {
      joined = true;
      this.decide_(
        prev.reading + "-" + reading,
        prev.value + t.value,
        rejected === undefined ? undefined : prev.value + rejected,
      );
    }
    const next = tokens[i + 1];
    if (isZh(next) && fits(next)) {
      joined = true;
      // When the next word was picked too, it joins with this one itself.
      if (!next.corrected) {
        this.decide_(
          reading + "-" + next.reading,
          t.value + next.value,
          rejected === undefined ? undefined : rejected + next.value,
        );
      }
    }
    if (!joined) {
      this.decide_(reading, t.value, rejected);
      return;
    }
    // By itself the word only gains a little each time (three picks in
    // different places are about one homophone's lead), and what it replaced
    // only loses what it had gained the same way.
    const entry = this.entry_(reading, t.value);
    entry.m = clamp(entry.m + 1, 0, 3);
    if (rejected !== undefined) {
      const other = this.phrases_.get(reading)?.get(rejected);
      if (other) {
        other.m = clamp(other.m - 1, 0, 3);
      }
    }
  }

  /** Three or more words picked one after another make one new word (a name). */
  private learnRuns_(
    tokens: LearnedToken[],
    isZh: (t: LearnedToken | undefined) => t is LearnedToken,
  ): void {
    let i = 0;
    while (i < tokens.length) {
      let j = i;
      while (j < tokens.length && isZh(tokens[j]) && tokens[j].corrected) {
        j++;
      }
      if (j - i >= 3) {
        const run = tokens.slice(i, j);
        const reading = run.map((t) => t.reading).join("-");
        if (syllableCount(reading) <= kMaxSyllables) {
          this.decide_(reading, run.map((t) => t.value).join(""));
        }
      }
      i = Math.max(j, i + 1);
    }
  }

  private pruneIfLarge_(factor: number): void {
    const { maxPhrases, maxPairs, maxWords } = this.limits_;
    if (this.phraseCount_ > maxPhrases * factor) {
      const all: { reading: string; value: string; weight: number }[] = [];
      for (const [reading, byValue] of this.phrases_) {
        for (const [value, e] of byValue) {
          all.push({
            reading,
            value,
            weight: e.n + 10 * Math.abs(e.c) + 5 * Math.abs(e.m),
          });
        }
      }
      all.sort((a, b) => b.weight - a.weight);
      for (const { reading, value } of all.slice(maxPhrases)) {
        const byValue = this.phrases_.get(reading)!;
        byValue.delete(value);
        if (byValue.size === 0) {
          this.phrases_.delete(reading);
        }
        this.phraseCount_--;
      }
    }
    const trim = (map: Map<string, number>, max: number): void => {
      if (map.size <= max * factor) {
        return;
      }
      const keys = Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(max)
        .map(([key]) => key);
      for (const key of keys) {
        map.delete(key);
      }
    };
    trim(this.pairs_, maxPairs);
    trim(this.words_, maxWords);
  }

  /** Forgets everything. */
  clear(): void {
    this.phrases_.clear();
    this.phraseCount_ = 0;
    this.pairs_.clear();
    this.words_.clear();
    this.apps_.clear();
    this.appWords_.clear();
    this.revision_++;
  }

  /** The model as JSON, to keep in a file. */
  save(): string {
    this.pruneIfLarge_(1);
    const phrases: { [key: string]: number[] } = {};
    for (const [reading, byValue] of this.phrases_) {
      for (const [value, e] of byValue) {
        phrases[reading + "|" + value] = [e.n, e.c, e.m];
      }
    }
    return JSON.stringify({
      version: 1,
      phrases,
      pairs: Object.fromEntries(this.pairs_),
      words: Object.fromEntries(this.words_),
      apps: Object.fromEntries(this.apps_),
      appWords: Object.fromEntries(this.appWords_),
    });
  }

  /**
   * Adds what {@link save} returned to the model. Anything malformed is
   * skipped; call {@link clear} first to replace the model.
   */
  load(json: string): void {
    let data: any;
    try {
      data = JSON.parse(json);
    } catch {
      return;
    }
    if (typeof data !== "object" || data === null) {
      return;
    }
    const entries = (o: unknown): [string, unknown][] =>
      typeof o === "object" && o !== null ? Object.entries(o) : [];
    const isCount = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v);
    for (const [key, v] of entries(data.phrases)) {
      const at = key.indexOf("|");
      if (at <= 0 || !Array.isArray(v) || v.length !== 3 || !v.every(isCount)) {
        continue;
      }
      const entry = this.entry_(key.substring(0, at), key.substring(at + 1));
      entry.n = Math.max(0, v[0]);
      entry.c = clamp(v[1], -2, 3);
      entry.m = clamp(v[2], 0, 3);
    }
    for (const [key, v] of entries(data.pairs)) {
      if (isCount(v) && v > 0 && key.includes("\t")) {
        this.pairs_.set(key, v);
      }
    }
    for (const [key, v] of entries(data.words)) {
      if (isCount(v) && v > 0 && isWord(key)) {
        this.words_.set(key, v);
      }
    }
    for (const [key, v] of entries(data.apps)) {
      if (Array.isArray(v) && v.length === 2 && v.every(isCount)) {
        this.apps_.set(normalizeApp(key), [Math.max(0, v[0]), Math.max(0, v[1])]);
      }
    }
    for (const [key, v] of entries(data.appWords)) {
      if (isCount(v) && key.includes("\t")) {
        this.appWords_.set(key, clamp(v, -3, 3));
      }
    }
    this.revision_++;
  }
}
