import { LearnedToken, PersonalModel } from "./PersonalModel";

const zh = (reading: string, value: string, extra: Partial<LearnedToken> = {}): LearnedToken => ({
  kind: "zh",
  reading,
  value,
  ...extra,
});
const en = (value: string): LearnedToken => ({ kind: "en", value });
const other: LearnedToken = { kind: "other", value: "，" };

describe("PersonalModel phrases", () => {
  test("phrases the user keeps typing get a small bonus", () => {
    const model = new PersonalModel();
    expect(model.phraseBonus("ㄋㄧˇ-ㄏㄠˇ", "你好")).toBe(0);
    model.learnSentence([zh("ㄋㄧˇ-ㄏㄠˇ", "你好")]);
    const once = model.phraseBonus("ㄋㄧˇ-ㄏㄠˇ", "你好");
    expect(once).toBeGreaterThan(0);
    for (let i = 0; i < 500; i++) {
      model.learnSentence([zh("ㄋㄧˇ-ㄏㄠˇ", "你好")]);
    }
    const often = model.phraseBonus("ㄋㄧˇ-ㄏㄠˇ", "你好");
    expect(often).toBeGreaterThan(once);
    expect(often).toBeLessThanOrEqual(0.6);
  });

  test("a correction with neighbors is learned in its context", () => {
    const model = new PersonalModel();
    model.learnSentence([
      zh("ㄊㄚ", "她", { corrected: true, rejected: "他" }),
      zh("ㄕㄨㄛ", "說"),
    ]);
    // The picked word with its neighbor is lifted, what it replaced is lowered.
    expect(model.lift("ㄊㄚ-ㄕㄨㄛ", "她說")).toBeGreaterThan(0);
    expect(model.phraseBonus("ㄊㄚ-ㄕㄨㄛ", "他說")).toBeLessThan(0);
    // On its own the word only moves a little: 他 is still right elsewhere.
    expect(model.lift("ㄊㄚ", "她")).toBe(0);
    expect(model.phraseBonus("ㄊㄚ", "她")).toBeGreaterThan(0);
    expect(model.phraseBonus("ㄊㄚ", "她")).toBeLessThan(1);
    expect(model.userPhrases("ㄊㄚ-ㄕㄨㄛ")).toEqual(["她說"]);
  });

  test("a correction with no Chinese neighbor is learned on its own", () => {
    const model = new PersonalModel();
    model.learnSentence([
      en("ok"),
      zh("ㄊㄚ", "她", { corrected: true, rejected: "他" }),
      other,
    ]);
    expect(model.lift("ㄊㄚ", "她")).toBeGreaterThan(0);
    expect(model.phraseBonus("ㄊㄚ", "他")).toBeLessThan(0);
  });

  test("correcting back undoes it", () => {
    const model = new PersonalModel();
    model.learnSentence([zh("ㄊㄚ", "她", { corrected: true, rejected: "他" })]);
    model.learnSentence([zh("ㄊㄚ", "他", { corrected: true, rejected: "她" })]);
    expect(model.lift("ㄊㄚ", "她")).toBe(0);
    expect(model.phraseBonus("ㄊㄚ", "他")).toBeGreaterThanOrEqual(0);
  });

  test("words picked one after another become one new word", () => {
    const model = new PersonalModel();
    model.learnSentence([
      zh("ㄓㄤ", "張", { corrected: true, rejected: "章" }),
      zh("ㄒㄧㄠˇ", "曉", { corrected: true, rejected: "小" }),
      zh("ㄇㄧㄥˊ", "銘", { corrected: true, rejected: "明" }),
      zh("ㄕㄨㄛ", "說"),
    ]);
    expect(model.userPhrases("ㄓㄤ-ㄒㄧㄠˇ-ㄇㄧㄥˊ")).toEqual(["張曉銘"]);
    expect(model.lift("ㄓㄤ-ㄒㄧㄠˇ-ㄇㄧㄥˊ", "張曉銘")).toBeGreaterThan(0);
  });

  test("does not join past six syllables", () => {
    const model = new PersonalModel();
    model.learnSentence([
      zh("ㄧ-ㄦˋ-ㄙㄢ-ㄙˋ-ㄨˇ", "一二三四五"),
      zh("ㄌㄧㄡˋ-ㄑㄧ", "六七", { corrected: true }),
    ]);
    expect(model.userPhrases("ㄧ-ㄦˋ-ㄙㄢ-ㄙˋ-ㄨˇ-ㄌㄧㄡˋ-ㄑㄧ")).toEqual([]);
  });
});

describe("PersonalModel pairs", () => {
  test("words typed next to each other fit together better", () => {
    const model = new PersonalModel();
    expect(model.pairBonus("今天", "開會")).toBe(0);
    model.learnSentence([zh("ㄐㄧㄣ-ㄊㄧㄢ", "今天"), zh("ㄎㄞ-ㄏㄨㄟˋ", "開會")]);
    expect(model.pairBonus("今天", "開會")).toBeGreaterThan(0);
    expect(model.pairBonus("開會", "今天")).toBe(0);
  });

  test("not across punctuation or English", () => {
    const model = new PersonalModel();
    model.learnSentence([zh("ㄐㄧㄣ-ㄊㄧㄢ", "今天"), other, zh("ㄎㄞ-ㄏㄨㄟˋ", "開會")]);
    expect(model.pairBonus("今天", "開會")).toBe(0);
  });
});

describe("PersonalModel English", () => {
  test("an unknown word becomes known once typed a few times", () => {
    const model = new PersonalModel();
    model.learnSentence([en("kubectl")]);
    expect(model.wordScore("kubectl")).toBeUndefined();
    model.learnSentence([en("Kubectl")]);
    model.learnSentence([en("kubectl")]);
    expect(model.wordScore("kubectl")).toBeGreaterThan(-6);
    expect(model.wordBonus("kubectl")).toBeGreaterThan(0);
    // One letter, or anything but letters, is never a word.
    for (let i = 0; i < 5; i++) {
      model.learnSentence([en("x"), en("uw0")]);
    }
    expect(model.wordScore("x")).toBeUndefined();
    expect(model.wordScore("uw0")).toBeUndefined();
  });

  test("a word switched by hand is remembered for that program", () => {
    const model = new PersonalModel();
    model.learnFlip("code.exe", "su", "en");
    expect(model.appWordBias("code.exe", "su")).toBeGreaterThan(0);
    expect(model.appWordBias("line.exe", "su")).toBe(0);
    model.learnFlip("code.exe", "su", "zh");
    model.learnFlip("code.exe", "su", "zh");
    expect(model.appWordBias("code.exe", "su")).toBeLessThan(0);
    expect(model.appWordBias("", "su")).toBe(0);
  });
});

describe("PersonalModel programs", () => {
  const typed = (model: PersonalModel, app: string, zhCount: number, enCount: number): void => {
    const tokens: LearnedToken[] = [];
    for (let i = 0; i < zhCount; i++) {
      tokens.push(zh("ㄉㄜ˙", "的"), other);
    }
    for (let i = 0; i < enCount; i++) {
      tokens.push(en("the"));
    }
    model.learnSentence(tokens, app);
  };

  test("a program where the user types more English leans English", () => {
    const model = new PersonalModel();
    typed(model, "line.exe", 300, 20);
    typed(model, "code.exe", 20, 300);
    expect(model.languageBias("code.exe")).toBeGreaterThan(0.3);
    expect(model.languageBias("line.exe")).toBeLessThan(0);
    expect(Math.abs(model.languageBias("code.exe"))).toBeLessThanOrEqual(0.8);
  });

  test("no leaning before there is enough to go on", () => {
    const model = new PersonalModel();
    typed(model, "line.exe", 300, 20);
    typed(model, "code.exe", 0, 10);
    expect(model.languageBias("code.exe")).toBe(0);
    expect(model.languageBias("unknown.exe")).toBe(0);
    expect(model.languageBias("")).toBe(0);
  });
});

describe("PersonalModel saving", () => {
  test("round-trips through JSON", () => {
    const model = new PersonalModel();
    model.learnSentence(
      [
        zh("ㄊㄚ", "她", { corrected: true, rejected: "他" }),
        zh("ㄕㄨㄛ", "說"),
        en("kubectl"),
      ],
      "code.exe",
    );
    model.learnFlip("code.exe", "su", "en");
    const copy = new PersonalModel();
    copy.load(model.save());
    expect(copy.save()).toBe(model.save());
    expect(copy.lift("ㄊㄚ-ㄕㄨㄛ", "她說")).toBe(model.lift("ㄊㄚ-ㄕㄨㄛ", "她說"));
    expect(copy.pairBonus("她", "說")).toBe(model.pairBonus("她", "說"));
    expect(copy.appWordBias("code.exe", "su")).toBeGreaterThan(0);
  });

  test("ignores broken data and can be cleared", () => {
    const model = new PersonalModel();
    model.learnSentence([zh("ㄋㄧˇ-ㄏㄠˇ", "你好")]);
    model.load("not json");
    model.load('{"phrases": {"x": "y"}, "pairs": 3}');
    expect(model.phraseBonus("ㄋㄧˇ-ㄏㄠˇ", "你好")).toBeGreaterThan(0);
    model.clear();
    expect(model.phraseBonus("ㄋㄧˇ-ㄏㄠˇ", "你好")).toBe(0);
    expect(model.isEmpty).toBe(true);
  });

  test("counts changes so the owner knows when to save", () => {
    const model = new PersonalModel();
    const before = model.revision;
    model.learnSentence([zh("ㄋㄧˇ-ㄏㄠˇ", "你好")]);
    expect(model.revision).toBeGreaterThan(before);
  });

  test("drops the least used entries when it grows too large", () => {
    const model = new PersonalModel({ maxPhrases: 10, maxPairs: 10, maxWords: 10 });
    for (let i = 0; i < 50; i++) {
      model.learnSentence([zh("ㄧ" + i, "字" + i), zh("ㄦ" + i, "詞" + i), en("word" + "a".repeat(i))]);
    }
    for (let i = 0; i < 5; i++) {
      model.learnSentence([zh("ㄋㄧˇ-ㄏㄠˇ", "你好", { corrected: true })]);
    }
    const saved = JSON.parse(model.save());
    expect(Object.keys(saved.phrases).length).toBeLessThanOrEqual(10);
    expect(Object.keys(saved.pairs).length).toBeLessThanOrEqual(10);
    expect(Object.keys(saved.words).length).toBeLessThanOrEqual(10);
    expect(saved.phrases["ㄋㄧˇ-ㄏㄠˇ|你好"]).toBeDefined();
  });
});
