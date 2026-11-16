/** All dynamic OOXML text and attributes pass through this XML 1.0 boundary. */
export function xml(value: string | number): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Excelに書き出す数値が正しくありません");
  const text = String(value);
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff)
      throw new Error("Excelに書き出せない制御文字が含まれています");
  }
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** SpreadsheetML interprets _xNNNN_ escapes; protect literal sequences and CRs. */
export function xlsxText(value: string): string {
  xml(value);
  return xml(value.replace(/_x[0-9a-f]{4}_/gi, match => `_x005F_${match.slice(1)}`).replaceAll("\r", "_x000D_"));
}

export { resolveCssColor as xlsxColor } from "../../model/css-color";
export type { CssColor as XlsxColor } from "../../model/css-color";
