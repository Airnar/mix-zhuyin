/**
 * The settings page server, a Node.js port of PIME's Python config_tool.py
 * so the all-in-one build needs no Python.
 *
 * It serves the settings, user phrases and help pages on 127.0.0.1 and
 * guards the endpoints that read or change files with a random token. The
 * token reaches the browser through a local HTML file that POSTs it, so it is
 * never in a URL.
 */
import child_process from "child_process";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";

import { localDataDir, userDataDir } from "./pime_paths";
import { defaultSettings } from "./pime_settings";

/** The cookie that carries the token. */
export const kCookieName = "mixzhuyin_config_token";

/** Pages the launcher may open. */
export const kPages = ["options", "user_phrases", "help"];

/** The server quits after this long without a request. */
export const kIdleTimeoutMs = 120 * 1000;

/** What the server needs. */
export interface ConfigHandlerOptions {
  /** The folder with the pages (output/pime). */
  staticDir: string;
  /** The user data folder (config.json, data.txt, exclude-phrases.txt). */
  configDir: string;
  /** The login token. */
  token: string;
  /** Opens a folder or file with its default program. */
  openPath: (target: string) => void;
  /** Called on every request, to keep the server alive. */
  onActivity?: () => void;
}

const kContentTypes: { [ext: string]: string } = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Top-level pages and the asset folders, as in config_tool.py.
const kStaticPattern = /^\/(?:[\w-]+\.html|(?:css|images|js|fonts)\/[\w./-]+)$/;

const readBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const parseCookies = (header: string | undefined): { [name: string]: string } => {
  const cookies: { [name: string]: string } = {};
  for (const part of (header || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
  }
  return cookies;
};

const sameToken = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const send = (
  res: http.ServerResponse,
  status: number,
  body: string | Buffer,
  contentType = "application/json; charset=utf-8",
): void => {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
};

const sendJson = (res: http.ServerResponse, value: unknown): void =>
  send(res, 200, JSON.stringify(value));

const readText = (file: string): string => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

/**
 * Creates the request handler of the settings page server.
 * @param options Folders, token and callbacks.
 * @returns A handler for `http.createServer`.
 */
export const createConfigHandler = (
  options: ConfigHandlerOptions,
): ((req: http.IncomingMessage, res: http.ServerResponse) => void) => {
  const { staticDir, configDir, token, openPath } = options;
  const configFile = path.join(configDir, "config.json");
  const userPhrasesFile = path.join(configDir, "data.txt");
  const excludedPhrasesFile = path.join(configDir, "exclude-phrases.txt");
  const staticRoot = path.resolve(staticDir) + path.sep;

  const ensureFile = (file: string): void => {
    fs.mkdirSync(configDir, { recursive: true });
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "");
    }
  };

  const serveStatic = (urlPath: string, res: http.ServerResponse): void => {
    if (!kStaticPattern.test(urlPath) || urlPath.includes("..")) {
      send(res, 404, '{"return":false}');
      return;
    }
    const file = path.resolve(staticDir, "." + urlPath);
    if (!file.startsWith(staticRoot)) {
      send(res, 404, '{"return":false}');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        send(res, 404, '{"return":false}');
        return;
      }
      const type = kContentTypes[path.extname(file).toLowerCase()];
      send(res, 200, data, type || "application/octet-stream");
    });
  };

  const handle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    options.onActivity?.();
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let urlPath: string;
    try {
      urlPath = decodeURIComponent(url.pathname);
    } catch {
      send(res, 404, '{"return":false}');
      return;
    }
    const method = req.method || "GET";

    const login = /^\/login\/(.+)$/.exec(urlPath);
    if (login) {
      if (method !== "POST" || !kPages.includes(login[1])) {
        send(res, 404, '{"return":false}');
        return;
      }
      const form = new URLSearchParams(await readBody(req));
      if (!sameToken(form.get("token") || "", token)) {
        send(res, 403, '{"return":false}');
        return;
      }
      res.writeHead(302, {
        Location: `/${login[1]}.html`,
        "Set-Cookie": `${kCookieName}=${token}; Path=/; HttpOnly; SameSite=Strict`,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    if (method === "GET" && kStaticPattern.test(urlPath)) {
      serveStatic(urlPath, res);
      return;
    }

    const loggedIn = sameToken(parseCookies(req.headers.cookie)[kCookieName] || "", token);
    const route = `${method} ${urlPath}`;
    const known = [
      "GET /config",
      "POST /config",
      "GET /keep_alive",
      "GET /open_user_data_folder",
      "GET /open_user_phrases",
      "GET /open_excluded_phrases",
      "GET /user_phrases",
      "POST /user_phrases",
      "GET /excluded_phrases",
      "POST /excluded_phrases",
    ];
    if (!known.includes(route)) {
      send(res, 404, '{"return":false}');
      return;
    }
    if (!loggedIn) {
      send(res, 403, '{"return":false}');
      return;
    }

    try {
      switch (route) {
        case "GET /config": {
          let saved = {};
          try {
            saved = JSON.parse(readText(configFile) || "{}");
          } catch {
            saved = {};
          }
          sendJson(res, Object.assign({}, defaultSettings, saved));
          return;
        }
        case "POST /config": {
          const value = JSON.parse(await readBody(req));
          if (value === null || typeof value !== "object" || Array.isArray(value)) {
            sendJson(res, { return: false, error: "not a JSON object" });
            return;
          }
          fs.mkdirSync(configDir, { recursive: true });
          fs.writeFileSync(configFile, JSON.stringify(value, null, 2));
          sendJson(res, { return: true });
          return;
        }
        case "GET /keep_alive":
          sendJson(res, { return: true });
          return;
        case "GET /open_user_data_folder":
          fs.mkdirSync(configDir, { recursive: true });
          openPath(configDir);
          sendJson(res, { return: true, path: configDir });
          return;
        case "GET /open_user_phrases":
          ensureFile(userPhrasesFile);
          openPath(userPhrasesFile);
          sendJson(res, { return: true, path: configDir });
          return;
        case "GET /open_excluded_phrases":
          ensureFile(excludedPhrasesFile);
          openPath(excludedPhrasesFile);
          sendJson(res, { return: true, path: configDir });
          return;
        case "GET /user_phrases":
          send(res, 200, readText(userPhrasesFile), "text/plain; charset=utf-8");
          return;
        case "POST /user_phrases":
          fs.mkdirSync(configDir, { recursive: true });
          fs.writeFileSync(userPhrasesFile, await readBody(req));
          sendJson(res, { return: true });
          return;
        case "GET /excluded_phrases":
          send(res, 200, readText(excludedPhrasesFile), "text/plain; charset=utf-8");
          return;
        case "POST /excluded_phrases":
          fs.mkdirSync(configDir, { recursive: true });
          fs.writeFileSync(excludedPhrasesFile, await readBody(req));
          sendJson(res, { return: true });
          return;
      }
    } catch (e) {
      sendJson(res, { return: false, error: String(e) });
    }
  };

  return (req, res) => {
    handle(req, res).catch((e) => send(res, 500, JSON.stringify({ return: false, error: String(e) })));
  };
};

/**
 * The local HTML file that logs the browser in by POSTing the token.
 * @param port The server's port.
 * @param page One of {@link kPages}.
 * @param token The login token.
 * @returns The HTML.
 */
export const launchPageHtml = (port: number, page: string, token: string): string =>
  `<!DOCTYPE html>
<html>
<meta charset="utf-8">
<form id="auth" action="http://127.0.0.1:${port}/login/${page}" method="POST">
  <input type="hidden" name="token" value="${token}">
</form>
<script>document.getElementById("auth").submit();</script>
</html>
`;

/**
 * Opens a folder or file with its default program on Windows.
 * @param target The folder or file.
 */
export const openWithShell = (target: string): void => {
  const child = child_process.spawn("explorer.exe", [target], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (e) => console.error(e));
  child.unref();
};

/**
 * Starts the server and opens a page in the default browser. The process
 * exits after {@link kIdleTimeoutMs} without requests.
 * @param page One of {@link kPages}; anything else opens the settings page.
 * @param staticDir The folder with the pages.
 */
export const runConfigTool = (page: string | undefined, staticDir: string): void => {
  const pageName = page && kPages.includes(page) ? page : "options";
  const token = crypto.randomBytes(16).toString("hex");
  let timer: NodeJS.Timeout | undefined;
  const resetTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => process.exit(0), kIdleTimeoutMs);
  };
  const server = http.createServer(
    createConfigHandler({
      staticDir,
      configDir: userDataDir(process.env),
      token,
      openPath: openWithShell,
      onActivity: resetTimer,
    }),
  );
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      process.exit(1);
      return;
    }
    const launchDir = localDataDir(process.env);
    fs.mkdirSync(launchDir, { recursive: true });
    const launchFile = path.join(launchDir, `launch_${pageName}.html`);
    fs.writeFileSync(launchFile, launchPageHtml(address.port, pageName, token));
    openWithShell(launchFile);
    resetTimer();
  });
};
