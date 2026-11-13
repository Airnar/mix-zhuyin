import {
  protectScript,
  protectSecret,
  unprotectScript,
  unprotectSecret,
} from "./pime_secrets";

describe("DPAPI secrets", () => {
  test("encrypt and decrypt for the current user, reading stdin", () => {
    for (const script of [protectScript(), unprotectScript()]) {
      expect(script).toContain("ProtectedData");
      expect(script).toContain("DataProtectionScope]::CurrentUser");
      expect(script).toContain("[Console]::In.ReadToEnd()");
    }
    expect(protectScript()).toContain("::Protect(");
    expect(unprotectScript()).toContain("::Unprotect(");
  });

  test("pass the secret on standard input", async () => {
    const run = jest.fn(async (_script: string, input: string) => "<" + input + ">");
    await expect(protectSecret("sk-ant-1", run)).resolves.toBe("<sk-ant-1>");
    expect(run.mock.calls[0][0]).toBe(protectScript());
    await expect(unprotectSecret("QUJD", run)).resolves.toBe("<QUJD>");
    expect(run.mock.calls[1][0]).toBe(unprotectScript());
  });
});
