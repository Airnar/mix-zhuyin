/**
 * Small Windows dialogs for the input method backend, shown with PowerShell
 * and Windows Forms so the backend needs no native module.
 */
import child_process from "child_process";

/** Quotes text as a PowerShell single-quoted string. */
const psQuote = (text: string): string => "'" + text.replace(/'/g, "''") + "'";

// Print UTF-8, so paths and text with Chinese survive the pipe.
const kUtf8Output = "[Console]::OutputEncoding = [Text.Encoding]::UTF8";

// A hidden top-most form owns the dialogs, so they open in front of the app
// the user is typing in.
const kOwner =
  "Add-Type -AssemblyName System.Windows.Forms\n" +
  "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }";

/**
 * A PowerShell script that shows a file-open dialog and prints the chosen
 * path, or nothing if the user cancels.
 * @param title The dialog title.
 * @param filter A Windows Forms filter, e.g. `文字檔 (*.txt)|*.txt`.
 * @returns The script.
 */
export const openFileDialogScript = (title: string, filter: string): string =>
  [
    kUtf8Output,
    kOwner,
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    `$dialog.Title = ${psQuote(title)}`,
    `$dialog.Filter = ${psQuote(filter)}`,
    "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.FileName }",
  ].join("\n");

/**
 * A PowerShell script that shows a message box.
 * @param title The window title.
 * @param text The message.
 * @returns The script.
 */
export const messageBoxScript = (title: string, text: string): string =>
  [
    kOwner,
    `[void][System.Windows.Forms.MessageBox]::Show($owner, ${psQuote(text)}, ${psQuote(title)})`,
  ].join("\n");

/**
 * The arguments that run a script with Windows PowerShell. The script goes
 * Base64-encoded (UTF-16LE, as `-EncodedCommand` wants), so nothing in it
 * needs command-line quoting.
 * @param script The script.
 * @returns Arguments for powershell.exe.
 */
export const powerShellArgs = (script: string): string[] => [
  "-NoProfile",
  "-NonInteractive",
  "-STA",
  "-ExecutionPolicy",
  "Bypass",
  "-EncodedCommand",
  Buffer.from(script, "utf16le").toString("base64"),
];

/**
 * Runs a script with Windows PowerShell, hidden.
 * @param script The script.
 * @param input Text for the script's standard input (secrets go here, never
 *   on the command line).
 * @returns What it printed, trimmed.
 */
export const runPowerShell = (script: string, input = ""): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = child_process.spawn("powershell.exe", powerShellArgs(script), {
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    // Writing to a PowerShell that already quit fails with EPIPE; without a
    // listener that error would end the backend.
    child.stdin.on("error", reject);
    child.on("close", (code: number) => {
      if (code !== 0) {
        reject(
          new Error(
            Buffer.concat(err).toString("utf8").trim() ||
              "PowerShell exited with " + code,
          ),
        );
        return;
      }
      resolve(Buffer.concat(out).toString("utf8").trim());
    });
    child.stdin.end(input, "utf8");
  });
