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

function typeKeys(text) {
  let committed = "";
  let composing = "";
  for (const ch of text) {
    const k = keyFor(ch);
    const keyStates = new Array(256).fill(0);
    if (k.shift) keyStates[16] = 0x80;
    const base = { keyCode: k.keyCode, charCode: k.charCode, keyStates, scanCode: 0, repeatCount: 0, isExtended: false };
    const filtered = send(Object.assign({ method: "filterKeyDown" }, base));
    let r = filtered;
    if (filtered.return) {
      r = send(Object.assign({ method: "onKeyDown" }, base));
    } else if (ch !== "\n") {
      committed += ch; // The app would receive the key itself.
    }
    if (r.commitString) committed += r.commitString;
    if (typeof r.compositionString === "string") composing = r.compositionString;
    send(Object.assign({ method: "filterKeyUp" }, base));
    send(Object.assign({ method: "onKeyUp" }, base));
  }
  return { committed, composing };
}

send({ method: "init", isWindows8Above: true, isMetroApp: false, isUiLess: false, isConsole: false });
send({ method: "onActivate", isKeyboardOpen: true });

// Each case ends with a second Enter (a new line in the app), so spacing
// does not carry over from the previous case.
const cases = [
  ["su3cl3\n\n", "你好"],
  ["1; ji3check u vu84\n\n", "幫我 check 一下"],
  ["hello world\n\n", "hello world"],
  ["ru42k7294n03\n\n", "記得帶傘"],
  ["ji3d9 meeting\n\n", "我開 meeting"],
];

let failures = 0;
for (const [keys, want] of cases) {
  const { committed } = typeKeys(keys);
  const ok = committed === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(keys)} -> ${JSON.stringify(committed)}${ok ? "" : " (expected " + JSON.stringify(want) + ")"}`);
}
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
