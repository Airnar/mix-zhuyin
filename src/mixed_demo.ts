/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

// Entry point for the standalone mixed-input demo page.
export {
  BopomofoCharacterMap,
  BopomofoKeyboardLayout,
  BopomofoSyllable,
} from "./Mandarin";
export { webData } from "./McBopomofo/WebData";
export { WebLanguageModel } from "./McBopomofo/WebLanguageModel";
export {
  EnglishModel,
  englishData,
  keysForReading,
  MixedCandidateKind,
  MixedComposer,
  MixedDecoder,
  MixedTokenType,
} from "./MixedInput";
