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
const OEM = { ";": 186, "=": 187, ",": 188, "-": 189, ".": 190, "/": 191, "`": 192, "'": 222 };
// Arrow keys and Esc, written as symbols in key sequences.
const NAMED = { "←": 37, "↑": 38, "→": 39, "↓": 40, "⎋": 27 };
function keyFor(ch) {
  if (NAMED[ch]) return { keyCode: NAMED[ch], charCode: 0, named: true };
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
  if (typeof r.compositionString === "string") {
    state.composing = r.compositionString;
    state.highlight = r.compositionHighlight;
  }
  if (Array.isArray(r.candidateList)) state.candidates = r.candidateList;
  if (typeof r.candidateCursor === "number") state.candidateCursor = r.candidateCursor;
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
    if (!(await pressKey(base, "down", state)) && ch !== "\n" && !k.named) {
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
  // Digits that spell a toned syllable read as Chinese at the end (1 0 3 =
  // ㄅㄢˇ); Shift turns them back into a number, which is then remembered.
  // A stray key typed too fast between syllables is dropped (刪除贅字).
  ["su3ccl3\n\n", "你好"],
  ["103\n\n", "版"],
  ["103" + SHIFT_TAP + "\n\n", "103"],
  ["103\n\n", "103"],
];

// Sends one key down and up with Ctrl held, as libIME does. Returns the
// onKeyDown response if the key was claimed.
async function ctrlKey(keyCode) {
  const states = new Array(256).fill(0);
  states[17] = 0x80;
  const key = { keyCode, charCode: 0, scanCode: 0, repeatCount: 0, isExtended: false, keyStates: states };
  let claimed = false;
  for (let i = 0; i < 2; i++) {
    claimed = (await send(Object.assign({ method: "filterKeyDown" }, key))).return || claimed;
  }
  const r = claimed ? await send(Object.assign({ method: "onKeyDown" }, key)) : undefined;
  for (let i = 0; i < 2; i++) await send(Object.assign({ method: "filterKeyUp" }, key));
  return r;
}

// Asks onRefresh until `done` likes a response, as the text service's timer would.
async function refreshUntil(done) {
  for (let i = 0; i < 30; i++) {
    const r = await send({ method: "onRefresh" });
    if (done(r)) return r;
    if (!r.refreshAfter) return r;
    await new Promise((resolve) => setTimeout(resolve, r.refreshAfter));
  }
  return undefined;
}

async function testAi() {
  const http = require("http");
  const asked = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const prompt = JSON.parse(body).messages.map((m) => m.content).join("\n");
      asked.push(req.url);
      const content = prompt.includes("讀音") ? "1. 記得帶傘\n2. 記得帶傘喔" : "存放和借貸金錢的機構";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const configFile = path.join(process.env.APPDATA, "MixZhuyin", "config.json");
  const before = fs.readFileSync(configFile, "utf8");
  const config = Object.assign(JSON.parse(before), {
    ai_enabled: true,
    ai_base_url: `http://127.0.0.1:${server.address().port}/v1`,
    ai_model: "test",
  });
  fs.writeFileSync(configFile, JSON.stringify(config));
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let failures = 0;
  const check = (ok, label) => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  };

  await typeKeys("ru42k7294n03");
  const started = await ctrlKey(13);
  check(!!started && started.refreshAfter > 0 && !!started.showMessage, "Ctrl+Enter asks the AI " + JSON.stringify(started && started.showMessage));
  const shown = await refreshUntil((r) => Array.isArray(r.candidateList) && r.candidateList.length > 0);
  check(
    !!shown && shown.candidateList[0] === "記得帶傘" && shown.candidateList[1] === "記得帶傘喔" && asked[0] === "/v1/chat/completions",
    "AI suggestions fill the candidate window " + JSON.stringify(shown && shown.candidateList)
  );
  const picked = await typeKeys("2");
  check(picked.committed === "記得帶傘喔", `a candidate key commits the suggestion -> ${JSON.stringify(picked.committed)}`);
  await typeKeys("\n");

  // Lookup, then Ctrl+E.
  const VK_CONTROL = 17;
  let lookup;
  for (let tap = 0; tap < 2; tap++) {
    const down = new Array(256).fill(0);
    down[VK_CONTROL] = 0x80;
    const key = { keyCode: VK_CONTROL, charCode: 0, scanCode: 0, repeatCount: 0, isExtended: false };
    for (let i = 0; i < 2; i++) await send(Object.assign({ method: "filterKeyDown", keyStates: down }, key));
    for (let i = 0; i < 2; i++) {
      const r = await send(Object.assign({ method: "filterKeyUp", keyStates: new Array(256).fill(0), selectionText: "銀行" }, key));
      if (r.showLookup) lookup = r.showLookup;
    }
  }
  check(!!lookup && lookup.message.includes("Ctrl+E"), "the lookup popup mentions the AI keys");
  const explaining = await ctrlKey(0x45);
  check(!!explaining && !!explaining.showLookup && explaining.refreshAfter > 0, "Ctrl+E after a lookup asks the AI");
  const explained = await refreshUntil((r) => r.showLookup && r.showLookup.message.includes("機構"));
  check(!!explained && explained.showLookup.message === "銀行\n存放和借貸金錢的機構", "the explanation shows in the popup");

  fs.writeFileSync(configFile, before);
  server.close();
  return failures;
}

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
  // Fixing a character: ← moves onto 帶, ↓ opens its candidates. The window
  // starts on 帶 (the list leads with 代), the text marks 帶 as the target,
  // and ↓ moves to the next candidate in the vertical window.
  {
    const opened = await typeKeys("ru42k7294n03←↓");
    const current = opened.candidates[opened.candidateCursor];
    const ok1 =
      opened.composing === "記得帶傘" &&
      JSON.stringify(opened.highlight) === "[2,3]" &&
      current === "帶";
    if (!ok1) failures++;
    console.log(
      `${ok1 ? "PASS" : "FAIL"}  candidates open on ${JSON.stringify(current)}, target ${JSON.stringify(opened.highlight)}`
    );
    const moved = await typeKeys("↓");
    const next = opened.candidates[opened.candidateCursor + 1];
    const ok2 = moved.candidateCursor === opened.candidateCursor + 1 && JSON.stringify(moved.highlight) === "[2,3]";
    if (!ok2) failures++;
    console.log(
      `${ok2 ? "PASS" : "FAIL"}  ↓ moves to ${JSON.stringify(next)} (cursor ${moved.candidateCursor})`
    );
    const closed = await typeKeys("⎋");
    const ok3 = closed.highlight === undefined && closed.composing === "記得帶傘";
    if (!ok3) failures++;
    console.log(`${ok3 ? "PASS" : "FAIL"}  Esc closes the window and drops the target`);
    await typeKeys("⎋");
  }

  // 框選查詢: Ctrl tapped twice with text selected shows how it reads. The
  // text service sends the selection with Ctrl key ups, and the popup comes
  // back as showLookup on a filterKeyUp.
  {
    const VK_CONTROL = 17;
    let lookup;
    for (let tap = 0; tap < 2; tap++) {
      const down = new Array(256).fill(0);
      down[VK_CONTROL] = 0x80;
      const key = { keyCode: VK_CONTROL, charCode: 0, scanCode: 0, repeatCount: 0, isExtended: false };
      for (let i = 0; i < 2; i++) await send(Object.assign({ method: "filterKeyDown", keyStates: down }, key));
      for (let i = 0; i < 2; i++) {
        const r = await send(
          Object.assign({ method: "filterKeyUp", keyStates: new Array(256).fill(0), selectionText: "銀行" }, key)
        );
        if (r.showLookup) lookup = r.showLookup;
      }
    }
    const ok = !!lookup && lookup.message.startsWith("銀行　ㄧㄣˊ ㄏㄤˊ");
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  Ctrl twice on 銀行 -> ${JSON.stringify(lookup)}`);
  }

  // Text snippets: ` and Space list them, a candidate key commits one. Only
  // runs when the user has no snippets of their own, and puts the file back.
  {
    const file = path.join(process.env.APPDATA || "", "MixZhuyin", "snippets.txt");
    let before;
    try {
      before = fs.readFileSync(file, "utf8");
    } catch {
      before = undefined;
    }
    const hasOwn = (before || "").split(/\r?\n/).some((l) => l.trim() && !l.trim().startsWith("#"));
    if (hasOwn) {
      console.log("SKIP  snippets (the user has their own)");
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "台北市信義區市府路1號\n謝謝您\n");
      // The backend reloads the file when it changes.
      await new Promise((r) => setTimeout(r, 1500));
      const { committed } = await typeKeys("` 2");
      const ok = committed === "謝謝您";
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"}  "\` 2" -> ${JSON.stringify(committed)}${ok ? "" : ' (expected "謝謝您")'}`);
      await typeKeys("\n");
      if (before === undefined) {
        fs.unlinkSync(file);
      } else {
        fs.writeFileSync(file, before);
      }
    }
  }

  // AI keys against a fake Ollama (module mode only: it changes settings).
  if (!usePipe) {
    failures += await testAi();
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
