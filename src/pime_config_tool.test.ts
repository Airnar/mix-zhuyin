import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import os from "os";
import path from "path";

import { createConfigHandler, kPages, launchPageHtml } from "./pime_config_tool";
import { defaultSettings } from "./pime_settings";
import { kSnippetsTemplate } from "./pime_snippets";

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe("settings page server", () => {
  let root: string;
  let staticDir: string;
  let configDir: string;
  let server: http.Server;
  let port: number;
  const opened: string[] = [];
  let activity = 0;
  const token = "secret-token";

  const request = (
    method: string,
    url: string,
    body?: string,
    headers: http.OutgoingHttpHeaders = {},
  ): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, method, path: url, headers },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode || 0, headers: res.headers, body: data }),
          );
        },
      );
      req.on("error", reject);
      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  const cookie = { Cookie: `mixzhuyin_config_token=${token}` };

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mixzhuyin-config-"));
    staticDir = path.join(root, "static");
    configDir = path.join(root, "data");
    fs.mkdirSync(path.join(staticDir, "css"), { recursive: true });
    fs.writeFileSync(path.join(staticDir, "options.html"), "<h1>設定</h1>");
    fs.writeFileSync(path.join(staticDir, "css", "settings.css"), "body{}");
    fs.writeFileSync(path.join(root, "secret.txt"), "do not serve");
    opened.length = 0;
    activity = 0;
    server = http.createServer(
      createConfigHandler({
        staticDir,
        configDir,
        token,
        openPath: (p) => opened.push(p),
        onActivity: () => activity++,
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("logs in with the token and redirects to the page", async () => {
    const wrong = await request("POST", "/login/options", "token=nope", {
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(wrong.status).toBe(403);
    expect(wrong.headers["set-cookie"]).toBeUndefined();

    const reply = await request("POST", "/login/options", `token=${token}`, {
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(reply.status).toBe(302);
    expect(reply.headers.location).toBe("/options.html");
    expect(String(reply.headers["set-cookie"])).toContain(
      `mixzhuyin_config_token=${token}`,
    );
    expect(String(reply.headers["set-cookie"])).toContain("HttpOnly");
  });

  test("only logs in to known pages", async () => {
    const reply = await request("POST", "/login/..%2Fsecret", `token=${token}`, {
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(reply.status).toBe(404);
  });

  test("serves the pages and their assets, nothing else", async () => {
    const page = await request("GET", "/options.html");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toBe("<h1>設定</h1>");
    const css = await request("GET", "/css/settings.css");
    expect(css.headers["content-type"]).toContain("text/css");

    expect((await request("GET", "/../secret.txt")).status).toBe(404);
    expect((await request("GET", "/css/..%2F..%2Fsecret.txt")).status).toBe(404);
    expect((await request("GET", "/missing.html")).status).toBe(404);
  });

  test("needs the cookie for settings and phrases", async () => {
    expect((await request("GET", "/config")).status).toBe(403);
    expect((await request("POST", "/config", "{}")).status).toBe(403);
    expect((await request("GET", "/user_phrases")).status).toBe(403);
    expect((await request("GET", "/open_user_data_folder")).status).toBe(403);
    expect(opened).toEqual([]);
  });

  test("reads settings over the defaults and saves them", async () => {
    const first = JSON.parse((await request("GET", "/config", undefined, cookie)).body);
    expect(first).toEqual(defaultSettings);

    const saved = await request(
      "POST",
      "/config",
      JSON.stringify({ mixed_mode: false, candidate_font_size: 20 }),
      cookie,
    );
    expect(JSON.parse(saved.body)).toEqual({ return: true });
    const file = JSON.parse(
      fs.readFileSync(path.join(configDir, "config.json"), "utf8"),
    );
    expect(file).toEqual({ mixed_mode: false, candidate_font_size: 20 });

    const again = JSON.parse((await request("GET", "/config", undefined, cookie)).body);
    expect(again.mixed_mode).toBe(false);
    expect(again.candidate_font_size).toBe(20);
    expect(again.layout).toBe(defaultSettings.layout);
  });

  test("rejects settings that are not a JSON object", async () => {
    const reply = await request("POST", "/config", "[1,2]", cookie);
    expect(JSON.parse(reply.body).return).toBe(false);
    expect(fs.existsSync(path.join(configDir, "config.json"))).toBe(false);
  });

  test("reads and writes user and excluded phrases", async () => {
    expect((await request("GET", "/user_phrases", undefined, cookie)).body).toBe("");
    await request("POST", "/user_phrases", "混打 ㄏㄨㄣˋ-ㄉㄚˇ\n", cookie);
    expect(fs.readFileSync(path.join(configDir, "data.txt"), "utf8")).toBe(
      "混打 ㄏㄨㄣˋ-ㄉㄚˇ\n",
    );
    expect((await request("GET", "/user_phrases", undefined, cookie)).body).toBe(
      "混打 ㄏㄨㄣˋ-ㄉㄚˇ\n",
    );

    await request("POST", "/excluded_phrases", "胡大 ㄏㄨˊ-ㄉㄚˋ\n", cookie);
    expect(
      fs.readFileSync(path.join(configDir, "exclude-phrases.txt"), "utf8"),
    ).toBe("胡大 ㄏㄨˊ-ㄉㄚˋ\n");
  });

  test("reads and writes the snippets, starting from the template", async () => {
    expect((await request("GET", "/snippets", undefined, cookie)).body).toBe(
      kSnippetsTemplate,
    );
    await request("POST", "/snippets", "台北市信義區市府路1號\n", cookie);
    expect(fs.readFileSync(path.join(configDir, "snippets.txt"), "utf8")).toBe(
      "台北市信義區市府路1號\n",
    );
    expect((await request("GET", "/snippets", undefined, cookie)).body).toBe(
      "台北市信義區市府路1號\n",
    );
    await request("GET", "/open_snippets", undefined, cookie);
    expect(opened).toEqual([path.join(configDir, "snippets.txt")]);
  });

  test("lets the snippets page log in", async () => {
    expect(kPages).toContain("snippets");
    expect((await request("GET", "/snippets")).status).toBe(403);
  });

  test("opens the data folder and phrase files", async () => {
    const folder = JSON.parse(
      (await request("GET", "/open_user_data_folder", undefined, cookie)).body,
    );
    expect(folder.return).toBe(true);
    await request("GET", "/open_user_phrases", undefined, cookie);
    await request("GET", "/open_excluded_phrases", undefined, cookie);
    expect(opened).toEqual([
      configDir,
      path.join(configDir, "data.txt"),
      path.join(configDir, "exclude-phrases.txt"),
    ]);
    // Opening a phrase file creates it first.
    expect(fs.existsSync(path.join(configDir, "data.txt"))).toBe(true);
  });

  test("counts every request as activity", async () => {
    await request("GET", "/options.html");
    await request("GET", "/keep_alive", undefined, cookie);
    expect(activity).toBe(2);
  });
});

describe("launchPageHtml", () => {
  test("posts the token to the login page", () => {
    const html = launchPageHtml(54321, "options", "abc123");
    expect(html).toContain('action="http://127.0.0.1:54321/login/options"');
    expect(html).toContain('name="token" value="abc123"');
    expect(html).toContain(".submit()");
  });
});
