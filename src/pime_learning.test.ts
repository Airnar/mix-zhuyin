import { LearningResetWatcher, learnTextSummary } from "./pime_learning";

describe("LearningResetWatcher", () => {
  test("the stamp found at startup does not clear anything", () => {
    const watcher = new LearningResetWatcher();
    expect(watcher.seen(1000)).toBe(false);
    expect(watcher.seen(1000)).toBe(false);
  });

  test("a newer stamp clears once", () => {
    const watcher = new LearningResetWatcher();
    expect(watcher.seen(undefined)).toBe(false);
    expect(watcher.seen(2000)).toBe(true);
    expect(watcher.seen(2000)).toBe(false);
    expect(watcher.seen(3000)).toBe(true);
  });

  test("a missing, older or malformed stamp does nothing", () => {
    const watcher = new LearningResetWatcher();
    watcher.seen(2000);
    expect(watcher.seen(undefined)).toBe(false);
    expect(watcher.seen(1000)).toBe(false);
    expect(watcher.seen("9999")).toBe(false);
    expect(watcher.seen(NaN)).toBe(false);
    expect(watcher.seen(2001)).toBe(true);
  });
});

describe("learnTextSummary", () => {
  test("says how much was learned", () => {
    expect(learnTextSummary({ sentences: 12, words: 80 })).toContain("12 個句子");
    expect(learnTextSummary({ sentences: 12, words: 80 })).toContain("80 個詞");
    expect(learnTextSummary({ sentences: 0, words: 0 })).toContain("沒有可以學");
  });
});
