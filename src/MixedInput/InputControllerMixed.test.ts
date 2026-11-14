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

function setUp(): {
  controller: InputController;
  last: () => UiState;
  committed: () => string;
} {
  let last = "";
  let committed = "";
  const ui = {
    reset: jest.fn(),
    commitString: jest.fn((text: string) => {
      committed += text;
    }),
    update: jest.fn((state: string) => {
      last = state;
    }),
  };
  const controller = new InputController(ui);
  controller.setMixedMode(true);
  // PIME's candidate window is vertical: Up and Down move between items.
  controller.setUserVerticalCandidates(true);
  return {
    controller,
    last: () => JSON.parse(last) as UiState,
    committed: () => committed,
  };
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

  test("what mixed mode learned can be forgotten", () => {
    const { controller } = setUp();
    type(controller, "103");
    controller.mixedShiftTap();
    controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.RETURN));
    expect(controller.exportMixedLearning()).toContain("103");
    controller.clearMixedLearning();
    expect(controller.exportMixedLearning()).not.toContain("103");
  });

  describe("personal learning", () => {
    const text = (last: () => UiState): string =>
      last().composingBuffer.map((s) => s.text).join("");
    // Types 他說, moves to 他, opens the candidates and picks 她.
    const pickShe = (controller: InputController, last: () => UiState): void => {
      type(controller, "w8 gji ");
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.LEFT));
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.LEFT));
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.DOWN));
      const index = last().candidates.findIndex(
        (c) => c.candidate.displayedText === "她",
      );
      expect(index).toBeGreaterThan(0);
      for (let i = 0; i < index; i++) {
        controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.DOWN));
      }
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.RETURN));
      expect(text(last)).toBe("她說");
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.RETURN));
    };

    test("a picked word is offered again, and survives saving", () => {
      const { controller, last } = setUp();
      const before = controller.personalModelRevision;
      pickShe(controller, last);
      expect(controller.personalModelRevision).toBeGreaterThan(before);
      type(controller, "w8 gji ");
      expect(text(last)).toBe("她說");
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.ESC));

      const saved = controller.exportPersonalModel();
      const other = setUp();
      other.controller.importPersonalModel(saved);
      type(other.controller, "w8 gji ");
      expect(text(other.last)).toBe("她說");
    });

    test("survives a traditional mode switch, and can be cleared", () => {
      const { controller, last } = setUp();
      pickShe(controller, last);
      controller.setTraditionalMode(true);
      controller.setTraditionalMode(false);
      controller.setMixedMode(true);
      type(controller, "w8 gji ");
      expect(text(last)).toBe("她說");
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.ESC));

      controller.clearPersonalModel();
      type(controller, "w8 gji ");
      expect(text(last)).toBe("他說");
    });

    test("can be turned off", () => {
      const { controller, last } = setUp();
      controller.setMixedPersonalLearning(false);
      const before = controller.exportPersonalModel();
      type(controller, "w8 gji ");
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.RETURN));
      expect(controller.exportPersonalModel()).toBe(before);
      expect(last).toBeDefined();
    });

    test("learns from existing text", () => {
      const { controller, last } = setUp();
      type(controller, "w8 gji ");
      expect(text(last)).toBe("他說");
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.ESC));
      const result = controller.learnFromText(
        "kubectl get pods\nkubectl apply\n今天要開會。kubectl logs",
      );
      expect(result.sentences).toBe(4);
      expect(result.words).toBeGreaterThan(6);
      const saved = JSON.parse(controller.exportPersonalModel());
      expect(saved.words.kubectl).toBe(3);
      expect(Object.keys(saved.phrases).some((k) => k.endsWith("|今天"))).toBe(true);
    });

    test("the program typed in is passed on", () => {
      const { controller } = setUp();
      controller.setMixedApp("Code.exe");
      type(controller, "check ");
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.RETURN));
      expect(JSON.parse(controller.exportPersonalModel()).apps).toEqual({
        "code.exe": [0, 1],
      });
    });
  });

  describe("text snippets (快捷文字本)", () => {
    const snippets = ["台北市信義區市府路1號", "謝謝您的來信！\n祝 順心"];

    test("` and Space list the snippets", () => {
      const { controller, last } = setUp();
      controller.setSnippets(snippets);
      type(controller, "` ");
      const state = last();
      expect(state.candidates.map((c) => c.candidate.displayedText)).toEqual([
        "台北市信義區市府路1號",
        "謝謝您的來信！⏎祝 順心",
      ]);
      expect(state.candidates[0].selected).toBe(true);
    });

    test("choosing a snippet commits all of it", () => {
      const { controller, committed, last } = setUp();
      controller.setSnippets(snippets);
      type(controller, "` ");
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.DOWN));
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.RETURN));
      expect(committed()).toBe("謝謝您的來信！\n祝 順心");
      expect(last().composingBuffer).toEqual([]);
    });

    test("a candidate key picks a snippet", () => {
      const { controller, committed } = setUp();
      controller.setSnippets(snippets);
      type(controller, "` 1");
      expect(committed()).toBe("台北市信義區市府路1號");
    });

    test("Esc goes back to the backtick", () => {
      const { controller, last } = setUp();
      controller.setSnippets(snippets);
      type(controller, "` ");
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.ESC));
      const state = last();
      expect(state.candidates).toEqual([]);
      expect(state.composingBuffer.map((s) => s.text).join("")).toBe("`");
    });

    test("without snippets, Space is a space", () => {
      const { controller, last } = setUp();
      type(controller, "` ");
      expect(last().candidates).toEqual([]);
    });

    test("long snippets are shortened in the list", () => {
      const { controller, last } = setUp();
      controller.setSnippets(["一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十"]);
      type(controller, "` ");
      const shown = last().candidates[0].candidate.displayedText;
      expect(Array.from(shown).length).toBe(25);
      expect(shown.endsWith("…")).toBe(true);
    });
  });

  describe("readingOf", () => {
    test("reads phrases from the dictionary, longest words first", () => {
      const { controller } = setUp();
      expect(controller.readingOf("銀行")).toBe("ㄧㄣˊ-ㄏㄤˊ");
      expect(controller.readingOf("王小明")).toBe("ㄨㄤˊ-ㄒㄧㄠˇ-ㄇㄧㄥˊ");
    });

    test("has no reading for text outside the dictionary", () => {
      const { controller } = setUp();
      expect(controller.readingOf("abc")).toBeUndefined();
      expect(controller.readingOf("王a")).toBeUndefined();
      expect(controller.readingOf("")).toBeUndefined();
    });
  });

  describe("AI suggestions", () => {
    test("mixedSnapshot tells what is being typed and how it reads", () => {
      const { controller } = setUp();
      expect(controller.mixedSnapshot()).toBeUndefined();
      type(controller, "ru42k7 meeting");
      expect(controller.mixedSnapshot()).toEqual({
        raw: "ru42k7 meeting",
        text: "記得 meeting",
        readings: "ㄐㄧˋ ㄉㄜ˙ meeting",
      });
    });

    test("showAiCandidates lists sentences and commits the chosen one", () => {
      const { controller, last, committed } = setUp();
      type(controller, "ru42k7294n03");
      expect(controller.showAiCandidates(["記得帶傘", "記得帶傘喔"])).toBe(true);
      const state = last();
      expect(state.candidates.map((c) => c.candidate.displayedText)).toEqual([
        "記得帶傘",
        "記得帶傘喔",
      ]);
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.DOWN));
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.RETURN));
      expect(committed()).toBe("記得帶傘喔");
      expect(controller.mixedSnapshot()).toBeUndefined();
    });

    test("Esc keeps what was typed", () => {
      const { controller, last } = setUp();
      type(controller, "ru42k7294n03");
      controller.showAiCandidates(["記得帶傘"]);
      controller.mcbopomofoKeyEvent(Key.namedKey(KeyName.ESC));
      expect(last().candidates).toEqual([]);
      expect(controller.mixedSnapshot()?.raw).toBe("ru42k7294n03");
    });

    test("needs a composition and suggestions", () => {
      const { controller } = setUp();
      expect(controller.showAiCandidates(["你好"])).toBe(false);
      type(controller, "su3cl3");
      expect(controller.showAiCandidates([])).toBe(false);
    });
  });
});
