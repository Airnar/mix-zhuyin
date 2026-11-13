import fs from "fs";
import os from "os";
import path from "path";

import {
  legacyUserDataDir,
  localDataDir,
  migrateUserData,
  userDataDir,
} from "./pime_paths";

describe("MixZhuyin data folders", () => {
  const env = {
    APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
  };

  test("live in their own folders under AppData", () => {
    expect(userDataDir(env)).toBe(path.join(env.APPDATA, "MixZhuyin"));
    expect(localDataDir(env)).toBe(path.join(env.LOCALAPPDATA, "MixZhuyin"));
    expect(legacyUserDataDir(env)).toBe(
      path.join(env.APPDATA, "PIME", "mixzhuyin"),
    );
  });
});

describe("migrateUserData", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mixzhuyin-paths-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("copies the PIME add-on's files into the new folder once", () => {
    const from = path.join(root, "PIME", "mixzhuyin");
    const to = path.join(root, "MixZhuyin");
    fs.mkdirSync(from, { recursive: true });
    fs.writeFileSync(path.join(from, "data.txt"), "測試 ㄘㄜˋ-ㄕˋ\n");
    fs.writeFileSync(path.join(from, "config.json"), '{"mixed_mode":false}');

    expect(migrateUserData(from, to)).toBe(true);
    expect(fs.readFileSync(path.join(to, "data.txt"), "utf8")).toBe(
      "測試 ㄘㄜˋ-ㄕˋ\n",
    );
    expect(fs.readFileSync(path.join(to, "config.json"), "utf8")).toBe(
      '{"mixed_mode":false}',
    );
    // The old folder stays, in case the add-on is still installed.
    expect(fs.existsSync(path.join(from, "data.txt"))).toBe(true);

    // A second run leaves the new folder alone.
    fs.writeFileSync(path.join(from, "data.txt"), "changed\n");
    expect(migrateUserData(from, to)).toBe(false);
    expect(fs.readFileSync(path.join(to, "data.txt"), "utf8")).toBe(
      "測試 ㄘㄜˋ-ㄕˋ\n",
    );
  });

  test("does nothing without an old folder", () => {
    const to = path.join(root, "MixZhuyin");
    expect(migrateUserData(path.join(root, "missing"), to)).toBe(false);
    expect(fs.existsSync(to)).toBe(false);
  });

  test("skips sub-folders", () => {
    const from = path.join(root, "old");
    const to = path.join(root, "new");
    fs.mkdirSync(path.join(from, "nested"), { recursive: true });
    fs.writeFileSync(path.join(from, "mixed-learning.json"), "{}");
    expect(migrateUserData(from, to)).toBe(true);
    expect(fs.readdirSync(to)).toEqual(["mixed-learning.json"]);
  });
});
