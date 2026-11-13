// Starts the installed settings page server (config_tool.js) the way the
// input method does, logs in like the browser would, and reads the settings.
//
// Usage: node config_tool_test.js <path to config_tool.js>
"use strict";

const child_process = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const script = path.resolve(process.argv[2]);
const local = fs.mkdtempSync(path.join(os.tmpdir(), "mixzhuyin-local-"));
const roaming = fs.mkdtempSync(path.join(os.tmpdir(), "mixzhuyin-roaming-"));
const child = child_process.spawn(process.execPath, [script, "options"], {
  env: Object.assign({}, process.env, { LOCALAPPDATA: local, APPDATA: roaming }),
  stdio: "inherit",
});

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(Object.assign({ host: "127.0.0.1" }, options), (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const launch = path.join(local, "MixZhuyin", "launch_options.html");
  for (let i = 0; i < 100 && !fs.existsSync(launch); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const html = fs.readFileSync(launch, "utf8");
  const port = Number(/127\.0\.0\.1:(\d+)\//.exec(html)[1]);
  const token = /name="token" value="([0-9a-f]+)"/.exec(html)[1];

  const login = await request(
    { port, method: "POST", path: "/login/options", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    `token=${token}`
  );
  if (login.status !== 302) throw new Error(`login: ${login.status}`);
  const cookie = String(login.headers["set-cookie"]).split(";")[0];

  const page = await request({ port, method: "GET", path: "/options.html" });
  if (page.status !== 200 || !page.body.includes("混打注音偏好設定")) throw new Error("options.html");

  const config = await request({ port, method: "GET", path: "/config", headers: { Cookie: cookie } });
  const settings = JSON.parse(config.body);
  if (settings.candidate_font_name !== "Microsoft JhengHei UI") throw new Error(`config: ${config.body}`);
  const snippetsPage = await request({ port, method: "GET", path: "/snippets.html" });
  if (snippetsPage.status !== 200 || !snippetsPage.body.includes("快捷文字本")) throw new Error("snippets.html");
  const snippets = await request({ port, method: "GET", path: "/snippets", headers: { Cookie: cookie } });
  if (snippets.status !== 200 || !snippets.body.startsWith("#")) throw new Error(`snippets: ${snippets.body}`);
  console.log("PASS  settings page server answers on port " + port);

  // The cloud API key is stored with DPAPI: not in the file in plain text,
  // not sent back to the page, and readable again by this Windows user.
  const plain = "sk-test-" + Date.now();
  const saved = await request({ port, method: "POST", path: "/ai_key", headers: { Cookie: cookie } }, plain);
  if (JSON.parse(saved.body).set !== true) throw new Error(`ai_key: ${saved.body}`);
  const configText = fs.readFileSync(path.join(roaming, "MixZhuyin", "config.json"), "utf8");
  const sealed = JSON.parse(configText).ai_cloud_key_dpapi;
  if (!sealed || configText.includes(plain)) throw new Error("the key is not encrypted");
  const configPage = await request({ port, method: "GET", path: "/config", headers: { Cookie: cookie } });
  if (configPage.body.includes(plain) || configPage.body.includes(sealed)) throw new Error("/config leaks the key");
  const unprotect = [
    "Add-Type -AssemblyName System.Security",
    "$entropy = [Text.Encoding]::UTF8.GetBytes('MixZhuyin')",
    "$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, 'CurrentUser'))",
  ].join("\n");
  const opened = child_process.spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(unprotect, "utf16le").toString("base64")],
    { input: sealed, encoding: "utf8" }
  );
  if (opened.stdout.trim() !== plain) throw new Error(`DPAPI round trip failed: ${opened.stderr}`);
  console.log("PASS  the cloud API key is stored with DPAPI");
}

main().then(
  () => {
    child.kill();
    process.exit(0);
  },
  (e) => {
    console.error(e);
    child.kill();
    process.exit(1);
  }
);
