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

/**
 * Ctrl+Alt+, as a TSF preserved key, which is how TSF means shortcuts to be
 * registered: Windows calls the text service with the GUID
 * (`onPreservedKey`). Watching for the keys in `filterKeyDown` alone did not
 * work on a real Windows 11 keyboard (why was not established).
 * `modifiers` is TF_MOD_ALT | TF_MOD_CONTROL.
 */
export const kSettingsPreservedKey = {
  keyCode: VK_Keys.VK_OEM_COMMA as number,
  modifiers: 0x0001 | 0x0002,
  guid: "{B87FDE99-97E2-4077-BF22-6D4794BF874B}",
};

/**
 * Whether a preserved key's GUID is {@link kSettingsPreservedKey}'s.
 * @param guid The GUID from an `onPreservedKey` request (any case, with or
 *   without braces).
 * @returns True if it is the settings key.
 */
export const isSettingsPreservedKey = (guid: unknown): boolean => {
  const plain = (s: string): string => s.replace(/[{}]/g, "").toLowerCase();
  return (
    typeof guid === "string" &&
    guid.length > 0 &&
    plain(guid) === plain(kSettingsPreservedKey.guid)
  );
};

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
