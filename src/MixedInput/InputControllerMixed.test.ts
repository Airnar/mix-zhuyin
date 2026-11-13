/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

import { InputController } from "../McBopomofo/InputController";
import { Key, KeyName } from "../McBopomofo/Key";

interface UiState {
  composingBuffer: { text: string; style: string }[];
  cursorIndex: number;
  candidates: { candidate: { displayedText: string }; selected: boolean }[];
}

function setUp(): { controller: InputController; last: () => UiState } {
  let last = "";
  const ui = {
    reset: jest.fn(),
    commitString: jest.fn(),
    update: jest.fn((state: string) => {
      last = state;
    }),
  };
  const controller = new InputController(ui);
  controller.setMixedMode(true);
  // PIME's candidate window is vertical: Up and Down move between items.
  controller.setUserVerticalCandidates(true);
  return { controller, last: () => JSON.parse(last) as UiState };
}

function type(controller: InputController, keys: string): void {
  for (const ch of keys) {
    controller.mcbopomofoKeyEvent(
      ch === " " ? new Key(" ", KeyName.SPACE) : Key.asciiKey(ch),
    );
  }
}

describe("InputController in mixed mode", () => {
  test("choosing candidates highlights the character being changed", () => {
    const { controller, last } = setUp();
    type(controller, "ru42k7294n03");
    controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.LEFT));
    controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.DOWN));

    const state = last();
    expect(state.composingBuffer).toEqual([
      { text: "記得", style: "normal" },
      { text: "帶", style: "highlighted" },
      { text: "傘", style: "normal" },
    ]);
    expect(state.cursorIndex).toBe(3);
    const selected = state.candidates.find((c) => c.selected);
    expect(selected?.candidate.displayedText).toBe("帶");
  });

  test("the highlight stays while moving through the candidates", () => {
    const { controller, last } = setUp();
    type(controller, "ru42k7294n03");
    controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.LEFT));
    controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.DOWN));
    const before = last().candidates.findIndex((c) => c.selected);
    controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.DOWN));
    const state = last();
    expect(state.candidates.findIndex((c) => c.selected)).toBe(before + 1);
    expect(state.composingBuffer[1]).toEqual({
      text: "帶",
      style: "highlighted",
    });
  });

  test("leaving the candidates clears the highlight", () => {
    const { controller, last } = setUp();
    type(controller, "ru42k7294n03");
    controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.DOWN));
    controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.ESC));
    expect(last().composingBuffer).toEqual([
      { text: "記得帶傘", style: "normal" },
    ]);
  });

  // The settings file loads a moment after the backend starts and applies
  // every setting again. Keys typed before that must not be lost.
  test("applying unchanged settings keeps what is being typed", () => {
    const { controller, last } = setUp();
    type(controller, "s");
    controller.setTraditionalMode(false);
    controller.setKeyboardLayout("Standard");
    controller.setMixedMode(true);
    controller.setMixedAutoSpace(true);
    controller.setMixedDropStrayKeys(true);
    type(controller, "u3cl3");
    expect(last().composingBuffer.map((s) => s.text).join("")).toBe("你好");
  });

  test("switching traditional mode keeps what mixed mode learned", () => {
    const { controller } = setUp();
    type(controller, "103");
    controller.mixedShiftTap();
    controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.RETURN));
    const learned = controller.exportMixedLearning();
    expect(learned).toContain("103");

    controller.setTraditionalMode(false);
    expect(controller.exportMixedLearning()).toBe(learned);
    controller.setTraditionalMode(true);
    expect(controller.exportMixedLearning()).toBe(learned);
    controller.setTraditionalMode(false);
    expect(controller.exportMixedLearning()).toBe(learned);
  });
});
