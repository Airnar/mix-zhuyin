/**
 * Helpers for what the PIME backend keeps of the user's personal model
 * (`personal-model.json` in the user data folder).
 */

/**
 * Notices when the settings page asked to forget what was learned. The page's
 * server stamps `learning_reset_at` in the settings file; the backend clears
 * its model when it sees a newer stamp than the one it started with.
 */
export class LearningResetWatcher {
  private last_: number | undefined;
  private started_ = false;

  /**
   * Looks at the stamp in freshly loaded settings.
   * @param stamp The settings' `learning_reset_at`.
   * @returns True if the model should be cleared now.
   */
  seen(stamp: unknown): boolean {
    const value =
      typeof stamp === "number" && Number.isFinite(stamp) ? stamp : undefined;
    if (!this.started_) {
      // Whatever the file says at startup happened before this run.
      this.started_ = true;
      this.last_ = value;
      return false;
    }
    if (value === undefined || (this.last_ !== undefined && value <= this.last_)) {
      return false;
    }
    this.last_ = value;
    return true;
  }
}

/**
 * What to tell the user after learning from a text file.
 * @param result How much was learned.
 * @returns The message.
 */
export const learnTextSummary = (result: {
  sentences: number;
  words: number;
}): string =>
  result.words === 0
    ? "這個檔案裡沒有可以學的中文或英文。"
    : `已從 ${result.sentences} 個句子學了 ${result.words} 個詞的用法。\n之後選字會優先用你常用的詞和搭配。`;

/** Text files larger than this are not read for learning. */
export const kMaxLearnFileBytes = 20 * 1024 * 1024;
