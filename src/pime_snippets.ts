/**
 * The text snippets file (快捷文字本), `%APPDATA%\MixZhuyin\snippets.txt`.
 *
 * One snippet per line. Lines that start with # and blank lines are skipped.
 * `\n` starts a new line, `\t` is a tab and `\\` a backslash.
 */

/** What a new snippets file says. */
export const kSnippetsTemplate =
  "# 快捷文字本：一行一段文字。打 ` 再按空白鍵叫出清單，用數字鍵或 Enter 選。\n" +
  "# 要換行請寫 \\n，例如：謝謝您的來信！\\n祝 順心\n" +
  "# 以 # 開頭的行不會出現在清單裡。\n";

/**
 * Reads the snippets out of the file's text.
 * @param text The file's text.
 * @param newline What `\n` becomes. Windows apps expect CR LF.
 * @returns The snippets, in file order.
 */
export const parseSnippets = (text: string, newline = "\r\n"): string[] => {
  const snippets: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    snippets.push(
      line.replace(/\\([nt\\])/g, (_, c: string) =>
        c === "n" ? newline : c === "t" ? "\t" : "\\",
      ),
    );
  }
  return snippets;
};
