// Types key sequences into MixZhuyin the way the text service does, and
// checks what gets committed.
//
// Usage:
//   node type_test.js [path to the module's index.js]
//     Loads the module directly (as PIME's Node.js backend would).
//   node type_test.js --pipe
//     Talks to the running MixZhuyinLauncher over its named pipe, so the
//     launcher, the Node.js backend and the module are all in the loop.
// Exits with status 1 if any case fails.
"use strict";

const path = require("path");
const os = require("os");
const fs = require("fs");
const net = require("net");

const GUID = "{99f99d2e-4c0a-4e5e-bae6-2876aefc9a94}";

// A transport sends one request and resolves with its response.
function moduleTransport(modulePath) {
  if (!process.env.APPDATA) {
    process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), "mixzhuyin-"));
  }
  const ime = require(modulePath);
  return {
    send: (request) => Promise.resolve(ime.response(request, ime.textReducer(request, {}))),
    close: () => {},
  };
}

// The launcher speaks JSON, one message per line, on
// \\.\pipe\<user name>\MixZhuyin\Launcher (see PIMEClient::getPipeName).
function pipeTransport() {
  const pipeName = `\\\\.\\pipe\\${os.userInfo().username}\\MixZhuyin\\Launcher`;
  const socket = net.connect(pipeName);
  socket.setEncoding("utf8");
  const waiting = new Map();
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const pending = waiting.get(message.seqNum);
      if (pending) {
        waiting.delete(message.seqNum);
        clearTimeout(pending.timer);
        pending.resolve(message);
      }
    }
  });
  const connected = new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return {
    send: (request) =>
      connected.then(
        () =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`No reply to ${request.method} #${request.seqNum}`)),
              15000
            );
            waiting.set(request.seqNum, { resolve, timer });
            socket.write(JSON.stringify(request) + "\n");
          })
      ),
    close: () => socket.end(),
  };
}

const usePipe = process.argv[2] === "--pipe";
const transport = usePipe
  ? pipeTransport()
  : moduleTransport(
      path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "output", "pime", "index.js"))
    );

let seq = 0;
function send(request) {
  request.seqNum = ++seq;
  return transport.send(request);
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
async function pressKey(base, edge, state) {
  const filterMethod = edge === "down" ? "filterKeyDown" : "filterKeyUp";
  const onMethod = edge === "down" ? "onKeyDown" : "onKeyUp";
  if (!(await send(Object.assign({ method: filterMethod }, base))).return) return false;
  if (!(await send(Object.assign({ method: filterMethod }, base))).return) return false;
  const r = await send(Object.assign({ method: onMethod }, base));
  if (r.commitString) state.committed += r.commitString;
  if (typeof r.compositionString === "string") state.composing = r.compositionString;
  return true;
}

async function typeKeys(text) {
  const state = { committed: "", composing: "" };
  for (const ch of text) {
    if (ch === SHIFT_TAP) {
      const down = new Array(256).fill(0);
      down[VK_SHIFT] = 0x80;
      const key = { keyCode: VK_SHIFT, charCode: 0, scanCode: 0, repeatCount: 0, isExtended: false };
      await pressKey(Object.assign({ keyStates: down }, key), "down", state);
      await pressKey(Object.assign({ keyStates: new Array(256).fill(0) }, key), "up", state);
      continue;
    }
    const k = keyFor(ch);
    const keyStates = new Array(256).fill(0);
    if (k.shift) keyStates[VK_SHIFT] = 0x80;
    const base = { keyCode: k.keyCode, charCode: k.charCode, keyStates, scanCode: 0, repeatCount: 0, isExtended: false };
    if (!(await pressKey(base, "down", state)) && ch !== "\n") {
      state.committed += ch; // The app would receive the key itself.
    }
    await pressKey(base, "up", state);
  }
  return state;
}

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

async function main() {
  await send({
    method: "init",
    id: GUID,
    isWindows8Above: true,
    isMetroApp: false,
    isUiLess: false,
    isConsole: false,
  });
  const activated = await send({ method: "onActivate", isKeyboardOpen: true });
  const ui = activated.customizeUI || {};
  if (ui.candFontName !== "Microsoft JhengHei UI" || ui.candPerRow !== 1) {
    console.log(`FAIL  candidate window settings ${JSON.stringify(ui)}`);
    return 1;
  }
  console.log(`PASS  candidate window settings ${JSON.stringify(ui)}`);

  let failures = 0;
  // The third element, when present, is the composition the app shows at the
  // end of the keys.
  for (const [keys, want, wantComposing] of cases) {
    const { committed, composing } = await typeKeys(keys);
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
  console.log(failures ? `${failures} failed` : `all passed${usePipe ? " (through the launcher)" : ""}`);
  return failures ? 1 : 0;
}

main().then(
  (code) => {
    transport.close();
    process.exit(code);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
