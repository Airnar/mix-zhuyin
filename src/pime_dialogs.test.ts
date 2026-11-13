import child_process from "child_process";

import {
  messageBoxScript,
  openFileDialogScript,
  powerShellArgs,
  runPowerShell,
} from "./pime_dialogs";

jest.mock("child_process");

describe("PowerShell dialogs", () => {
  test("the file dialog prints the chosen path", () => {
    const script = openFileDialogScript("匯入", "文字檔 (*.txt)|*.txt");
    expect(script).toContain("OpenFileDialog");
    expect(script).toContain("$dialog.Title = '匯入'");
    expect(script).toContain("$dialog.Filter = '文字檔 (*.txt)|*.txt'");
    expect(script).toContain("[Text.Encoding]::UTF8");
  });

  test("quotes text so it cannot end the string", () => {
    const script = messageBoxScript("t", "it's'; Remove-Item x; '");
    expect(script).toContain("'it''s''; Remove-Item x; '''");
  });

  test("passes the script Base64-encoded", () => {
    const args = powerShellArgs("Write-Output '你好'");
    const encoded = args[args.indexOf("-EncodedCommand") + 1];
    expect(Buffer.from(encoded, "base64").toString("utf16le")).toBe(
      "Write-Output '你好'",
    );
    expect(args).toContain("-STA");
    expect(args).toContain("-NoProfile");
  });

  test("runs powershell.exe hidden, feeds stdin and trims what it prints", async () => {
    const { EventEmitter } = jest.requireActual("events");
    const spawn = child_process.spawn as unknown as jest.Mock;
    const fake = (code: number, stdout: string, stderr = "") => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const written: string[] = [];
      child.stdin = {
        on: () => undefined,
        end: (text: string) => {
          written.push(text);
          setImmediate(() => {
            child.stdout.emit("data", Buffer.from(stdout));
            child.stderr.emit("data", Buffer.from(stderr));
            child.emit("close", code);
          });
        },
      };
      return { child, written };
    };

    const ok = fake(0, "C:\\Users\\me\\詞彙.txt\r\n");
    spawn.mockReturnValueOnce(ok.child);
    await expect(runPowerShell("x", "secret")).resolves.toBe("C:\\Users\\me\\詞彙.txt");
    expect(spawn.mock.calls[0][0]).toBe("powershell.exe");
    expect(spawn.mock.calls[0][2]).toMatchObject({ windowsHide: true });
    expect(ok.written).toEqual(["secret"]);
    // The secret is not on the command line.
    expect(JSON.stringify(spawn.mock.calls[0][1])).not.toContain("secret");

    const failed = fake(1, "", "Access denied");
    spawn.mockReturnValueOnce(failed.child);
    await expect(runPowerShell("x")).rejects.toThrow("Access denied");
  });

  test("a broken stdin rejects instead of crashing the backend", async () => {
    const { EventEmitter } = jest.requireActual("events");
    const spawn = child_process.spawn as unknown as jest.Mock;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    // PowerShell went away before reading what we wrote.
    child.stdin.end = () =>
      setImmediate(() => child.stdin.emit("error", new Error("write EPIPE")));
    spawn.mockReturnValueOnce(child);
    await expect(runPowerShell("x", "secret")).rejects.toThrow("EPIPE");
  });
});
