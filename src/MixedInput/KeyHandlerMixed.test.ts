/**
 * @license
 * Copyright (c) 2026 and onwards The MixZhuyin Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 */

import { BopomofoKeyboardLayout } from "../Mandarin";
import {
  ChoosingCandidate,
  Committing,
  Empty,
  InputState,
  Inputting,
} from "../McBopomofo/InputState";
import { Key, KeyName } from "../McBopomofo/Key";
import { KeyHandler } from "../McBopomofo/KeyHandler";
import { LocalizedStrings } from "../McBopomofo/LocalizedStrings";
import { webData } from "../McBopomofo/WebData";
import { WebLanguageModel } from "../McBopomofo/WebLanguageModel";
import { BigramModel } from "./BigramModel";
import { keysForReading } from "./MixedDecoder";

function keyFor(ch: string): Key {
  if (ch === " ") {
    return new Key(" ", KeyName.SPACE);
  }
  return Key.asciiKey(ch);
}

class Session {
  state: InputState = new Empty();
  committed = "";
  handled: boolean[] = [];
  errors = 0;
  constructor(readonly handler: KeyHandler) {}

  private onState = (s: InputState): void => {
    if (s instanceof Committing) {
      this.committed += s.text;
    }
    this.state = s;
  };

  key(k: Key): boolean {
    const r = this.handler.handle(
      k,
      this.state,
      this.onState,
      () => this.errors++,
    );
    this.handled.push(r);
    return r;
  }

  type(keys: string): void {
    for (const ch of keys) {
      this.key(keyFor(ch));
    }
  }

  get composing(): string {
    return this.state instanceof Inputting ? this.state.composingBuffer : "";
  }
}

function mixedHandler(
  layout = BopomofoKeyboardLayout.StandardLayout,
): KeyHandler {
  const h = new KeyHandler(
    new WebLanguageModel(webData),
    new LocalizedStrings(),
  );
  h.keyboardLayout = layout;
  h.mixedMode = true;
  return h;
}

describe("KeyHandler in mixed mode", () => {
  test("types Chinese and English without switching", () => {
    const s = new Session(mixedHandler());
    s.type("1; ji3check u vu84");
    expect(s.composing).toBe("幫我 check 一下");
    s.key(Key.namedKey(KeyName.RETURN));
    expect(s.committed).toBe("幫我 check 一下");
  });

  test("lets keys through when nothing is being composed", () => {
    const s = new Session(mixedHandler());
    expect(s.key(new Key(" ", KeyName.SPACE))).toBe(false);
    expect(s.key(Key.namedKey(KeyName.RETURN))).toBe(false);
    expect(s.key(Key.namedKey(KeyName.BACKSPACE))).toBe(false);
  });

  test("Down opens candidates and choosing one updates the text", () => {
    const h = mixedHandler();
    const s = new Session(h);
    s.type("294");
    const before = s.composing;
    s.key(Key.namedKey(KeyName.DOWN));
    expect(s.state).toBeInstanceOf(ChoosingCandidate);
    const choosing = s.state as ChoosingCandidate;
    const other = choosing.candidates.find((c) => c.value !== before)!;
    h.candidateSelected(
      other,
      choosing.originalCursorIndex,
      (st) => (s.state = st),
    );
    expect(s.composing).toBe(other.value);
  });

  test("Shift tap switches the segment", () => {
    const h = mixedHandler();
    const s = new Session(h);
    s.type("up ");
    expect(s.composing).toBe("up ");
    expect(
      h.mixedShiftTapped(
        (st) => (s.state = st),
        () => {},
      ),
    ).toBe(true);
    expect(s.composing).toBe("因");
  });

  test("Shift tap is left to the host when nothing is composed", () => {
    const h = mixedHandler();
    expect(
      h.mixedShiftTapped(
        () => {},
        () => {},
      ),
    ).toBe(false);
  });

  test("Tab accepts the English prediction", () => {
    const s = new Session(mixedHandler());
    s.type("ji3d9 meet");
    expect((s.state as Inputting).tooltip).toContain("meeting");
    s.key(Key.namedKey(KeyName.TAB));
    expect(s.composing).toBe("我開 meeting");
  });

  test("full-width punctuation follows Chinese", () => {
    const s = new Session(mixedHandler());
    s.type("su3cl3?");
    expect(s.composing).toBe("你好？");
  });

  test("works on the 許氏 layout", () => {
    const s = new Session(mixedHandler(BopomofoKeyboardLayout.HsuLayout));
    s.type("xhfdebug lgse jlftem ");
    s.key(Key.namedKey(KeyName.RETURN));
    expect(s.committed).toBe("我 debug 了一整天");
  });

  test("turning mixed mode off restores normal behavior", () => {
    const h = mixedHandler();
    h.mixedMode = false;
    const s = new Session(h);
    s.type("su3cl3");
    expect(s.composing).toBe("你好");
  });
});

describe("KeyHandler mixed mode and the bigram model", () => {
  test("a host can attach a bigram model to the mixed decoder", () => {
    const h = mixedHandler();
    h.mixedComposer.decoder.bigramModel = new BigramModel("帶\t傘 200\n");
    const s = new Session(h);
    s.type("ru42k7294n03");
    expect(s.composing).toBe("記得帶傘");
  });
});

describe("KeyHandler mixed mode with the bundled bigram model", () => {
  test("picks homophones from context out of the box", () => {
    const s = new Session(mixedHandler());
    s.type("ru42k7294n03");
    expect(s.composing).toBe("記得帶傘");
  });

  test("keeps everyday words that encyclopedic text would get wrong", () => {
    const s = new Session(mixedHandler());
    s.type(keysForReading("ㄉㄨㄟˋ-ㄚ", BopomofoKeyboardLayout.StandardLayout));
    expect(s.composing).toBe("對啊");
  });
});
