/**
 * Keeps secrets (the cloud AI's API key) encrypted with Windows DPAPI for
 * the current user, so the settings file never holds them in plain text and
 * only this Windows account can read them back.
 */
import { runPowerShell } from "./pime_dialogs";

/** Extra entropy, so other apps' DPAPI blobs and ours do not mix. */
const kEntropy = "MixZhuyin";

const kPrelude = [
  "Add-Type -AssemblyName System.Security",
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
  `$entropy = [Text.Encoding]::UTF8.GetBytes('${kEntropy}')`,
  "$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser",
  "$text = [Console]::In.ReadToEnd()",
];

/** A PowerShell script that encrypts its standard input (Base64 out). */
export const protectScript = (): string =>
  [
    ...kPrelude,
    "$bytes = [Text.Encoding]::UTF8.GetBytes($text)",
    "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope))",
  ].join("\n");

/** A PowerShell script that decrypts the Base64 on its standard input. */
export const unprotectScript = (): string =>
  [
    ...kPrelude,
    "$bytes = [Convert]::FromBase64String($text.Trim())",
    "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope))",
  ].join("\n");

/** Runs a script with input; see `runPowerShell`. */
export type ScriptRunner = (script: string, input: string) => Promise<string>;

/**
 * Encrypts a secret for the current Windows user.
 * @param plain The secret.
 * @param run Runs the PowerShell script.
 * @returns Base64 of the DPAPI blob.
 */
export const protectSecret = (
  plain: string,
  run: ScriptRunner = runPowerShell,
): Promise<string> => run(protectScript(), plain);

/**
 * Decrypts what `protectSecret` returned.
 * @param protectedText Base64 of the DPAPI blob.
 * @param run Runs the PowerShell script.
 * @returns The secret.
 */
export const unprotectSecret = (
  protectedText: string,
  run: ScriptRunner = runPowerShell,
): Promise<string> => run(unprotectScript(), protectedText);
