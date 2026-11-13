import { kSnippetsTemplate, parseSnippets } from "./pime_snippets";

describe("snippets file (快捷文字本)", () => {
  test("has one snippet per line and skips comments and blank lines", () => {
    const text = "# 說明\n\n台北市信義區市府路1號\r\n  \n謝謝您\n";
    expect(parseSnippets(text)).toEqual(["台北市信義區市府路1號", "謝謝您"]);
  });

  test("\\n starts a new line, written the Windows way", () => {
    expect(parseSnippets("謝謝您的來信！\\n祝 順心")).toEqual([
      "謝謝您的來信！\r\n祝 順心",
    ]);
  });

  test("\\t is a tab and \\\\ a backslash", () => {
    expect(parseSnippets("a\\tb\\\\n")).toEqual(["a\tb\\n"]);
  });

  test("keeps spaces inside a snippet but trims the ends", () => {
    expect(parseSnippets("  Best regards,  Tony  ")).toEqual([
      "Best regards,  Tony",
    ]);
  });

  test("the template lists nothing", () => {
    expect(parseSnippets(kSnippetsTemplate)).toEqual([]);
  });
});
