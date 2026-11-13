/**
 * Where MixZhuyin keeps its files on Windows.
 *
 * The all-in-one build is its own product, so its data lives in
 * `%APPDATA%\MixZhuyin`; the earlier PIME add-on used `%APPDATA%\PIME\mixzhuyin`.
 */
import fs from "fs";
import path from "path";

/** The environment variables the folders come from. */
export interface DataDirEnv {
  APPDATA?: string;
  LOCALAPPDATA?: string;
}

/**
 * The roaming folder for settings, user phrases and learning.
 * @param env Usually `process.env`.
 * @returns `%APPDATA%\MixZhuyin`.
 */
export const userDataDir = (env: DataDirEnv): string =>
  path.join(env.APPDATA || "", "MixZhuyin");

/**
 * The folder the PIME add-on used.
 * @param env Usually `process.env`.
 * @returns `%APPDATA%\PIME\mixzhuyin`.
 */
export const legacyUserDataDir = (env: DataDirEnv): string =>
  path.join(env.APPDATA || "", "PIME", "mixzhuyin");

/**
 * The local folder for temporary files such as the settings page launcher.
 * @param env Usually `process.env`.
 * @returns `%LOCALAPPDATA%\MixZhuyin`.
 */
export const localDataDir = (env: DataDirEnv): string =>
  path.join(env.LOCALAPPDATA || "", "MixZhuyin");

/**
 * Copies the files of an old data folder into a new one, the first time only.
 * The old folder is left as it is.
 * @param from The old folder.
 * @param to The new folder.
 * @returns Whether anything was copied.
 */
export const migrateUserData = (from: string, to: string): boolean => {
  if (fs.existsSync(to) || !fs.existsSync(from)) {
    return false;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const source = path.join(from, name);
    if (fs.statSync(source).isFile()) {
      fs.copyFileSync(source, path.join(to, name));
    }
  }
  return true;
};
