/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

import { webData } from "../McBopomofo/WebData";
import { WebLanguageModel } from "../McBopomofo/WebLanguageModel";
import { bigramData } from "./BigramData";
import { BigramModel } from "./BigramModel";
import { englishData } from "./EnglishData";
import { EnglishModel } from "./EnglishModel";
import { MixedCandidateKind, MixedComposer } from "./MixedComposer";
import { keysForReading, MixedDecoder, MixedTokenType } from "./MixedDecoder";
import { PersonalModel } from "./PersonalModel";
import sentences from "./testdata/sentences.json";
import { trigramData } from "./TrigramData";
import { TrigramModel } from "./TrigramModel";

const lm = new WebLanguageModel(webData);
const english = new EnglishModel(englishData);
const bigram = new BigramModel(bigramData);

function composer(model = new PersonalModel()): MixedComposer {
  const decoder = new MixedDecoder(lm, english);
  decoder.bigramModel = bigram;
  decoder.personalModel = model;
  return new MixedComposer(decoder);
}

function type(c: MixedComposer, keys: string): void {
  for (const k of keys) {
    c.insert(k);
  }
}

/** Types the keys and returns what shows. */
function shows(c: MixedComposer, keys: string): string {
  type(c, keys);
  const text = c.view().text;
  c.clear();
  return text;
}

/** Puts the cursor on the unit showing `from` and picks `to` for it. */
function pick(c: MixedComposer, from: string, to: string): void {
  while (c.moveFocus(1)) {
    // Start from the end.
  }
  while (
    c.view().focusRange === undefined ||
    c.view().text.slice(c.view().focusRange!.start, c.view().focusRange!.end) !== from
  ) {
    if (!c.moveFocus(-1)) {
      throw new Error("no unit shows " + from + " in " + c.view().text);
    }
  }
  const candidate = c
    .candidates()
    .find((x) => x.kind === MixedCandidateKind.Phrase && x.value === to);
  if (!candidate) {
    throw new Error("no candidate " + to);
  }
  c.selectCandidate(candidate);
}

describe("learning from corrections", () => {
  test("a word picked next to others is offered there again, and only there", () => {
    const c = composer();
    expect(shows(c, "w8 gji ")).toBe("他說");
    type(c, "w8 gji ");
    pick(c, "他", "她");
    expect(c.commit()).toBe("她說");

    expect(shows(c, "w8 gji ")).toBe("她說");
    expect(shows(c, "w8 gji ek7")).toBe("她說個");
    // The same reading elsewhere is not turned around by one pick.
    expect(shows(c, "w8 ")).toBe("他");
    expect(shows(c, "w8 2k7")).toBe("他的");
  });

  test("correcting 的 to 得 after one verb leaves 的 alone elsewhere", () => {
    const c = composer();
    type(c, "ql32k7dj94");
    const before = c.view().text;
    if (before !== "跑得快") {
      pick(c, "的", "得");
    }
    expect(c.commit()).toBe("跑得快");
    expect(shows(composer(c.decoder.personalModel), "ql32k7dj94")).toBe("跑得快");
    expect(shows(composer(c.decoder.personalModel), "ji32k7")).toBe("我的");
    expect(shows(composer(c.decoder.personalModel), "2k7")).toBe("的");
  });

  test("picking the other one again turns it back", () => {
    const c = composer();
    type(c, "w8 gji ");
    pick(c, "他", "她");
    c.commit();
    type(c, "w8 gji ");
    pick(c, "她", "他");
    expect(c.commit()).toBe("他說");
    expect(shows(c, "w8 gji ")).toBe("他說");
  });

  test("a word picked on its own is offered again", () => {
    const c = composer();
    type(c, "w8 ");
    pick(c, "他", "她");
    expect(c.commit()).toBe("她");
    expect(shows(c, "w8 ")).toBe("她");
  });

  test("a pick that is undone before committing teaches nothing", () => {
    const model = new PersonalModel();
    const c = composer(model);
    type(c, "w8 gji ");
    pick(c, "他", "她");
    c.clear();
    expect(model.isEmpty).toBe(true);
    expect(shows(c, "w8 gji ")).toBe("他說");
  });

  test("words picked one after another come back as one word", () => {
    const c = composer();
    type(c, "5; vul3au/6");
    const before = c.view().text;
    expect(Array.from(before)).toHaveLength(3);
    const picks = ["張", "曉", "銘"];
    Array.from(before).forEach((ch, i) => {
      if (ch !== picks[i]) {
        pick(c, c.view().text[i], picks[i]);
      }
    });
    expect(c.commit()).toBe("張曉銘");
    expect(shows(c, "5; vul3au/6")).toBe("張曉銘");
    // And inside a sentence.
    expect(shows(c, "5; vul3au/6gji ")).toBe("張曉銘說");
  });

  test("learning can be turned off", () => {
    const model = new PersonalModel();
    const c = composer(model);
    c.personalLearning = false;
    type(c, "w8 gji ");
    c.commit();
    expect(model.isEmpty).toBe(true);
  });
});

describe("learning from what is typed", () => {
  test("committed sentences are learned without picking anything", () => {
    const model = new PersonalModel();
    const c = composer(model);
    type(c, "ji3rup wu0 ul4d9 meeting");
    expect(c.commit()).toBe("我今天要開 meeting");
    expect(model.wordBonus("meeting")).toBeGreaterThan(0);
    expect(model.pairBonus("我", "今天")).toBeGreaterThan(0);
    expect(model.phraseBonus("ㄐㄧㄣ-ㄊㄧㄢ", "今天")).toBeGreaterThan(0);
    // The same keys still read the same.
    expect(shows(composer(model), "ji3rup wu0 ul4d9 meeting")).toBe("我今天要開 meeting");
  });

  test("an English word of the user's own becomes a known word", () => {
    const c = composer();
    const typeOf = (): MixedTokenType => {
      type(c, "kubectl ");
      const t = c.result.tokens[0].type;
      c.commit();
      return t;
    };
    expect(typeOf()).toBe(MixedTokenType.UnknownWord);
    typeOf();
    typeOf();
    expect(typeOf()).toBe(MixedTokenType.English);
  });
});

describe("learning per program", () => {
  test("the program typed in is remembered with the sentence", () => {
    const model = new PersonalModel();
    const c = composer(model);
    c.app = "Code.exe";
    for (let i = 0; i < 30; i++) {
      type(c, "kubectl get pods");
      c.commit();
    }
    c.app = "line.exe";
    for (let i = 0; i < 30; i++) {
      type(c, "ji3rup wu0 ul4d9 ");
      c.commit();
    }
    expect(model.languageBias("code.exe")).toBeGreaterThan(0);
    expect(model.languageBias("line.exe")).toBeLessThan(0);
  });

  test("English costs less in a program where the user types English", () => {
    const model = new PersonalModel();
    const c = composer(model);
    c.app = "code.exe";
    for (let i = 0; i < 30; i++) {
      type(c, "kubectl get pods");
      c.commit();
    }
    c.app = "line.exe";
    for (let i = 0; i < 30; i++) {
      type(c, "ji3rup wu0 ul4d9 ");
      c.commit();
    }
    const cost = (app: string): number => {
      c.app = app;
      return c.decoder.decode("check").cost;
    };
    expect(cost("code.exe")).toBeLessThan(cost("line.exe"));
    expect(cost("other.exe")).toBeGreaterThan(cost("code.exe"));
    expect(cost("other.exe")).toBeLessThan(cost("line.exe"));
  });

  test("English lock does not count toward the program", () => {
    const model = new PersonalModel();
    const c = composer(model);
    c.app = "code.exe";
    c.englishLock = true;
    for (let i = 0; i < 60; i++) {
      type(c, "get pods");
      c.commit();
    }
    c.englishLock = false;
    expect(model.languageBias("code.exe")).toBe(0);
    expect(model.wordBonus("pods")).toBeGreaterThan(0);
  });
});

describe("learning does not wear the decoder down", () => {
  interface Segment {
    lang: string;
    text: string;
    reading?: string;
  }
  const cases = (sentences as Segment[][]).map((segments) => {
    let keys = "";
    let expected = "";
    segments.forEach((seg, i) => {
      if (seg.lang === "zh") {
        keys += keysForReading(seg.reading!, composer().decoder.layout);
      } else {
        keys += seg.text + (i < segments.length - 1 ? " " : "");
      }
      expected += seg.text;
    });
    return { keys, expected };
  });
  const trigram = trigramData.length > 0 ? new TrigramModel(trigramData) : undefined;
  // Types every test sentence and commits it; returns how many came out right.
  const typeAll = (model: PersonalModel | undefined): number => {
    let right = 0;
    for (const { keys, expected } of cases) {
      const decoder = new MixedDecoder(lm, english);
      decoder.bigramModel = bigram;
      decoder.trigramModel = trigram;
      decoder.personalModel = model;
      const c = new MixedComposer(decoder);
      c.autoSpace = false;
      type(c, keys);
      if (c.commit().replace(/ /g, "") === expected.replace(/ /g, "")) {
        right++;
      }
    }
    return right;
  };

  test("typing the test sentences again and again keeps them right", () => {
    const baseline = typeAll(undefined);
    const model = new PersonalModel();
    typeAll(model);
    typeAll(model);
    const third = typeAll(model);
    expect(baseline).toBeGreaterThan(cases.length * 0.8);
    expect(third).toBeGreaterThanOrEqual(baseline);
  });
});
