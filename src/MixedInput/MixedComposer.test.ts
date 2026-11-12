/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

import { webData } from "../McBopomofo/WebData";
import { WebLanguageModel } from "../McBopomofo/WebLanguageModel";
import { englishData } from "./EnglishData";
import { EnglishModel } from "./EnglishModel";
import {
  MixedCandidateKind,
  MixedComposer,
  needsSpaceBetween,
} from "./MixedComposer";
import { MixedDecoder } from "./MixedDecoder";

const lm = new WebLanguageModel(webData);
const english = new EnglishModel(englishData);

function composer(): MixedComposer {
  return new MixedComposer(new MixedDecoder(lm, english));
}

function type(c: MixedComposer, keys: string): void {
  for (const k of keys) {
    c.insert(k);
  }
}

describe("MixedComposer", () => {
  test("adds a space between Chinese and English", () => {
    const c = composer();
    type(c, "ji3rup wu0 ul4d9 meeting");
    expect(c.view().text).toBe("我今天要開 meeting");
    expect(c.commit()).toBe("我今天要開 meeting");
    expect(c.isEmpty).toBe(true);
  });

  test("does not double a space the user typed", () => {
    const c = composer();
    type(c, "1; ji3check u vu84");
    expect(c.commit()).toBe("幫我 check 一下");
  });

  test("auto spacing can be turned off", () => {
    const c = composer();
    c.autoSpace = false;
    type(c, "ji3vu;3t pizza");
    expect(c.commit()).toBe("我想吃pizza");
  });

  test("spaces against text committed earlier", () => {
    const c = composer();
    type(c, "ji3");
    expect(c.commit()).toBe("我");
    type(c, "love");
    expect(c.commit()).toBe(" love");
  });

  test("puts digits apart from Chinese", () => {
    expect(needsSpaceBetween("年", "3")).toBe(true);
    expect(needsSpaceBetween("，", "a")).toBe(false);
  });

  test("Shift tap flips a word and flips it back", () => {
    const c = composer();
    type(c, "up ");
    expect(c.view().text).toBe("up ");
    expect(c.flip()).toBe(true);
    expect(c.view().text).toBe("因");
    expect(c.flip()).toBe(true);
    expect(c.view().text).toBe("up ");
    // Nothing is left forced, so later keys can still change the reading.
    type(c, "jo4");
    expect(c.view().text).toBe("因為");
  });

  test("flipping an unfinished syllable keeps the word English", () => {
    const c = composer();
    type(c, "jo");
    expect(c.view().segments[0].pending).toBe(true);
    expect(c.flip()).toBe(true);
    type(c, "b");
    expect(c.view().text).toBe("job");
  });

  test("refuses to flip letters that are not Bopomofo", () => {
    const c = composer();
    type(c, "hello");
    expect(c.flip()).toBe(false);
    expect(c.view().text).toBe("hello");
  });

  test("Tab accepts the predicted word", () => {
    const c = composer();
    type(c, "ji3d9 meet");
    expect(c.prediction).toBe("meeting");
    expect(c.acceptPrediction()).toBe(true);
    expect(c.view().text).toBe("我開 meeting");
  });

  test("choosing a candidate pins it and is remembered", () => {
    const c = composer();
    type(c, "294");
    const first = c.view().text;
    const list = c.candidates();
    const other = list.find(
      (x) => x.kind === MixedCandidateKind.Phrase && x.value !== first,
    )!;
    expect(c.selectCandidate(other)).toBe(true);
    expect(c.view().text).toBe(other.value);
    expect(c.commit()).toBe(other.value);
    type(c, "294");
    expect(c.view().text).toBe(other.value);
  });

  test("candidates include switching to English", () => {
    const c = composer();
    type(c, "up ");
    c.flip();
    const flip = c.candidates().find((x) => x.kind === MixedCandidateKind.Flip);
    expect(flip?.value).toBe("en");
  });

  test("the cursor moves between units", () => {
    const c = composer();
    type(c, "su3cl3check");
    expect(c.view().cursorIndex).toBe(c.view().text.length);
    expect(c.moveFocus(-1)).toBe(true);
    expect(c.view().cursorIndex).toBe(2);
    expect(c.moveFocus(-1)).toBe(true);
    expect(c.view().cursorIndex).toBe(1);
    expect(c.moveFocus(-1)).toBe(false);
  });

  test("backspace removes one key at a time", () => {
    const c = composer();
    type(c, "su3");
    expect(c.backspace()).toBe(true);
    expect(c.view().text).toBe("ㄋㄧ");
    c.clear();
    expect(c.backspace()).toBe(false);
  });

  test("English lock keeps everything English", () => {
    const c = composer();
    c.englishLock = true;
    type(c, "su3");
    expect(c.view().text).toBe("su3");
  });

  test("numpad digits stay digits", () => {
    const c = composer();
    c.insert("1", true);
    c.insert("8", true);
    c.insert("7", true);
    expect(c.commit()).toBe("187");
  });

  test("long compositions commit their beginning", () => {
    const c = composer();
    type(c, "ji3rup wu0 ul4d9 meeting ".repeat(3));
    const out = c.commitOverflow();
    expect(out.length).toBeGreaterThan(0);
    expect(c.raw.length).toBeLessThan(30);
  });

  test("learning survives export and import", () => {
    const a = composer();
    type(a, "294");
    const pick = a
      .candidates()
      .find(
        (x) =>
          x.kind === MixedCandidateKind.Phrase && x.value !== a.view().text,
      )!;
    a.selectCandidate(pick);
    const saved = a.exportLearning();
    const b = composer();
    b.importLearning(saved);
    type(b, "294");
    expect(b.view().text).toBe(pick.value);
  });
});
