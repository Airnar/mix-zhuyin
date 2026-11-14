import { sentencesForLearning } from "./TextLearning";

const segment = (text: string): { value: string; reading?: string }[] =>
  Array.from(text).map((value) =>
    value === "龘" ? { value } : { value, reading: "r" + value },
  );

describe("sentencesForLearning", () => {
  test("splits into sentences of Chinese phrases, English words and the rest", () => {
    expect(sentencesForLearning("我開 meeting，好。OK!\n\n123", segment)).toEqual([
      [
        { kind: "zh", value: "我", reading: "r我" },
        { kind: "zh", value: "開", reading: "r開" },
        { kind: "other", value: " " },
        { kind: "en", value: "meeting" },
        { kind: "other", value: "，" },
        { kind: "zh", value: "好", reading: "r好" },
      ],
      [{ kind: "en", value: "OK" }],
    ]);
  });

  test("a character without a reading breaks the phrases around it", () => {
    expect(sentencesForLearning("我龘好", segment)).toEqual([
      [
        { kind: "zh", value: "我", reading: "r我" },
        { kind: "other", value: "龘" },
        { kind: "zh", value: "好", reading: "r好" },
      ],
    ]);
  });

  test("nothing to learn, no sentences", () => {
    expect(sentencesForLearning("", segment)).toEqual([]);
    expect(sentencesForLearning("123，456。\n", segment)).toEqual([]);
    expect(sentencesForLearning("don't", segment)).toEqual([[{ kind: "en", value: "don't" }]]);
  });
});
