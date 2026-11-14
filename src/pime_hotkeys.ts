/**
 * Keyboard shortcuts the PIME backend handles itself, whatever is being
 * composed.
 */

import { VK_Keys } from "./pime_keys";

const isDown = (keyStates: ArrayLike<number>, key: number): boolean =>
  ((keyStates[key] ?? 0) & 0x80) !== 0;

/**
 * Whether a key press is Ctrl+Alt+, (comma), which opens the settings page.
 * @param keyCode The Windows virtual-key code.
 * @param keyStates The keyboard state (256 entries, 0x80 = down).
 * @returns True for Ctrl+Alt+, without Shift or the Windows key.
 */
export const isOpenSettingsHotkey = (
  keyCode: number,
  keyStates: ArrayLike<number>,
): boolean =>
  keyCode === VK_Keys.VK_OEM_COMMA &&
  isDown(keyStates, VK_Keys.VK_CONTROL) &&
  isDown(keyStates, VK_Keys.VK_MENU) &&
  !isDown(keyStates, VK_Keys.VK_SHIFT) &&
  !isDown(keyStates, VK_Keys.VK_LWIN) &&
  !isDown(keyStates, VK_Keys.VK_RWIN);

/** Lets something happen at most once in a while (a key may be sent twice). */
export class Throttle {
  private last_ = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs_: number) {}

  /**
   * Asks to go ahead now.
   * @param now The time, in milliseconds.
   * @returns True if enough time has passed since the last go-ahead.
   */
  allow(now: number): boolean {
    if (now - this.last_ < this.intervalMs_) {
      return false;
    }
    this.last_ = now;
    return true;
  }
}
