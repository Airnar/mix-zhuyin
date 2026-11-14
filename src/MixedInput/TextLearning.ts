/**
 * Turns existing text (notes, chat logs) into sentences the personal model
 * can learn from.
 */

import { LearnedToken } from "./PersonalModel";

/**
 * Splits a run of Chinese characters into phrases with their readings. A
 * phrase without a reading is not learned.
 */
export type PhraseSegmenter = (
  text: string,
) => { value: string; reading?: string }[];

const kPiece =
  /([㐀-䶿一-鿿]+)|([A-Za-z][A-Za-z']*)|([\n。！？!?；;]+)|([^㐀-䶿一-鿿A-Za-z\n。！？!?；;]+)/g;

/**
 * The sentences of a text, as words to learn.
 * @param text The text.
 * @param segment Splits Chinese into phrases and gives their readings.
 * @returns One list of words per sentence; sentences with nothing to learn
 *   are left out.
 */
export const sentencesForLearning = (
  text: string,
  segment: PhraseSegmenter,
): LearnedToken[][] => {
  const sentences: LearnedToken[][] = [];
  let current: LearnedToken[] = [];
  const end = (): void => {
    if (current.some((t) => t.kind !== "other")) {
      sentences.push(current);
    }
    current = [];
  };
  for (const m of text.matchAll(kPiece)) {
    if (m[1]) {
      for (const phrase of segment(m[1])) {
        current.push(
          phrase.reading
            ? { kind: "zh", value: phrase.value, reading: phrase.reading }
            : { kind: "other", value: phrase.value },
        );
      }
    } else if (m[2]) {
      current.push({ kind: "en", value: m[2] });
    } else if (m[3]) {
      end();
    } else {
      current.push({ kind: "other", value: m[4] });
    }
  }
  end();
  return sentences;
};
