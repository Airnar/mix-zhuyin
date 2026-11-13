// Types key sequences into the MixZhuyin PIME module the way PIME's Node.js
// backend does, and checks what gets committed.
//
// Usage: node type_test.js [path to the module's index.js]
// Exits with status 1 if any case fails.
"use strict";

const path = require("path");
const os = require("os");
const fs = require("fs");

if (!process.env.APPDATA) {
  process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), "mixzhuyin-"));
}
const modulePath = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "..", "output", "pime", "index.js")
);
const ime = require(modulePath);

let seq = 0;
function send(request) {
  request.seqNum = ++seq;
  return ime.response(request, ime.textReducer(request, {}));
}

// Windows virtual-key codes for the characters we type.
const OEM = { ";": 186, "=": 187, ",": 188, "-": 189, ".": 190, "/": 191, "'": 222 };
function keyFor(ch) {
  if (ch === "\n") return { keyCode: 13, charCode: 13 };
  if (ch === " ") return { keyCode: 32, charCode: 32 };
  if (/[a-z]/.test(ch)) return { keyCode: ch.toUpperCase().charCodeAt(0), charCode: ch.charCodeAt(0) };
  if (/[A-Z]/.test(ch)) return { keyCode: ch.charCodeAt(0), charCode: ch.charCodeAt(0), shift: true };
  if (/[0-9]/.test(ch)) return { keyCode: ch.charCodeAt(0), charCode: ch.charCodeAt(0) };
  if (OEM[ch]) return { keyCode: OEM[ch], charCode: ch.charCodeAt(0) };
  throw new Error("No key for " + JSON.stringify(ch));
}

// "⇧" in a key sequence is a Shift tap on its own.
const SHIFT_TAP = "⇧";
const VK_SHIFT = 16;

// Mirrors libIME's TextService and PIME's Client: TSF calls OnTestKey* and
// then OnKey*, and OnKey* filters the key again before asking for an edit
// session. Only on* responses come with an edit session, so only they can
// change the composition or commit text; filter* responses can't.
function pressKey(base, edge, state) {
  const filterMethod = edge === "down" ? "filterKeyDown" : "filterKeyUp";
  const onMethod = edge === "down" ? "onKeyDown" : "onKeyUp";
  if (!send(Object.assign({ method: filterMethod }, base)).return) return false;
  if (!send(Object.assign({ method: filterMethod }, base)).return) return false;
  const r = send(Object.assign({ method: onMethod }, base));
  if (r.commitString) state.committed += r.commitString;
  if (typeof r.compositionString === "string") state.composing = r.compositionString;
  return true;
}

function typeKeys(text) {
  const state = { committed: "", composing: "" };
  for (const ch of text) {
    if (ch === SHIFT_TAP) {
      const down = new Array(256).fill(0);
      down[VK_SHIFT] = 0x80;
      const key = { keyCode: VK_SHIFT, charCode: 0, scanCode: 0, repeatCount: 0, isExtended: false };
      pressKey(Object.assign({ keyStates: down }, key), "down", state);
      pressKey(Object.assign({ keyStates: new Array(256).fill(0) }, key), "up", state);
      continue;
    }
    const k = keyFor(ch);
    const keyStates = new Array(256).fill(0);
    if (k.shift) keyStates[VK_SHIFT] = 0x80;
    const base = { keyCode: k.keyCode, charCode: k.charCode, keyStates, scanCode: 0, repeatCount: 0, isExtended: false };
    if (!pressKey(base, "down", state) && ch !== "\n") {
      state.committed += ch; // The app would receive the key itself.
    }
    pressKey(base, "up", state);
  }
  return state;
}

send({ method: "init", isWindows8Above: true, isMetroApp: false, isUiLess: false, isConsole: false });
const activated = send({ method: "onActivate", isKeyboardOpen: true });
const ui = activated.customizeUI || {};
if (ui.candFontName !== "Microsoft JhengHei UI" || ui.candPerRow !== 1) {
  console.log(`FAIL  candidate window settings ${JSON.stringify(ui)}`);
  process.exit(1);
}
console.log(`PASS  candidate window settings ${JSON.stringify(ui)}`);

// Each case ends with a second Enter (a new line in the app), so spacing
// does not carry over from the previous case.
const cases = [
  ["su3cl3\n\n", "你好"],
  ["1; ji3check u vu84\n\n", "幫我 check 一下"],
  ["hello world\n\n", "hello world"],
  ["ru42k7294n03\n\n", "記得帶傘"],
  ["ji3d9 meeting\n\n", "我開 meeting"],
  // A Shift tap while composing flips the segment: "up " becomes 因, and the
  // app has to show it before anything else is typed. A second tap flips it
  // back. (Keep this order: committing a flip teaches "up " to read as 因.)
  ["up " + SHIFT_TAP + SHIFT_TAP, "", "up "],
  ["\n\n", "up "],
  ["up " + SHIFT_TAP, "", "因"],
  ["\n\n", "因"],
];

let failures = 0;
// The third element, when present, is the composition the app shows at the
// end of the keys.
for (const [keys, want, wantComposing] of cases) {
  const { committed, composing } = typeKeys(keys);
  let ok = committed === want;
  let got = JSON.stringify(committed);
  let expected = JSON.stringify(want);
  if (wantComposing !== undefined) {
    ok = ok && composing === wantComposing;
    got += ` composing ${JSON.stringify(composing)}`;
    expected += ` composing ${JSON.stringify(wantComposing)}`;
  }
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(keys)} -> ${got}${ok ? "" : " (expected " + expected + ")"}`);
}
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
