import { isOpenSettingsHotkey, Throttle } from "./pime_hotkeys";

const states = (...down: number[]): number[] => {
  const keyStates = new Array(256).fill(0);
  for (const key of down) {
    keyStates[key] = 0x80;
  }
  return keyStates;
};
const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_LWIN = 0x5b;
const VK_COMMA = 0xbc;

describe("isOpenSettingsHotkey", () => {
  test("Ctrl+Alt+comma", () => {
    expect(isOpenSettingsHotkey(VK_COMMA, states(VK_CONTROL, VK_MENU))).toBe(true);
  });

  test("nothing else", () => {
    expect(isOpenSettingsHotkey(VK_COMMA, states())).toBe(false);
    expect(isOpenSettingsHotkey(VK_COMMA, states(VK_CONTROL))).toBe(false);
    expect(isOpenSettingsHotkey(VK_COMMA, states(VK_MENU))).toBe(false);
    expect(isOpenSettingsHotkey(VK_COMMA, states(VK_CONTROL, VK_MENU, VK_SHIFT))).toBe(false);
    expect(isOpenSettingsHotkey(VK_COMMA, states(VK_CONTROL, VK_MENU, VK_LWIN))).toBe(false);
    expect(isOpenSettingsHotkey(0xbe, states(VK_CONTROL, VK_MENU))).toBe(false);
    // A toggled key (low bit) is not a key held down.
    const toggled = states(VK_CONTROL);
    toggled[VK_MENU] = 1;
    expect(isOpenSettingsHotkey(VK_COMMA, toggled)).toBe(false);
    expect(isOpenSettingsHotkey(VK_COMMA, [])).toBe(false);
  });
});

describe("Throttle", () => {
  test("allows once per interval", () => {
    const throttle = new Throttle(2000);
    expect(throttle.allow(10000)).toBe(true);
    expect(throttle.allow(10500)).toBe(false);
    expect(throttle.allow(11999)).toBe(false);
    expect(throttle.allow(12000)).toBe(true);
    expect(throttle.allow(12001)).toBe(false);
  });
});
