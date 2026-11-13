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

  test("runs powershell.exe hidden and trims what it prints", async () => {
    const execFile = child_process.execFile as unknown as jest.Mock;
    execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (e: Error | null, out: string) => void,
      ) => callback(null, "C:\\Users\\me\\詞彙.txt\r\n"),
    );
    await expect(runPowerShell("x")).resolves.toBe("C:\\Users\\me\\詞彙.txt");
    expect(execFile.mock.calls[0][0]).toBe("powershell.exe");
    expect(execFile.mock.calls[0][2]).toMatchObject({ windowsHide: true });

    execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (e: Error | null, out: string) => void,
      ) => callback(new Error("no powershell"), ""),
    );
    await expect(runPowerShell("x")).rejects.toThrow("no powershell");
  });
});
