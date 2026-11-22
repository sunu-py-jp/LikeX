import { defaultMarkdownParser } from "prosemirror-markdown";
import { checkedText } from "../model/validation";

/** Extensions outside this editor's CommonMark scope remain editable in source mode. */
export function getMarkdownCompatibilityWarnings(source: string): string[] {
  const warnings = new Set<string>();
  // Every warning needs one of these characters, so most sources are answered without tokenizing.
  if (!/[<|]|~~/.test(checkedText(source, "Markdown"))) return [];
  // Tokenization distinguishes code fences/inline code from extension-like text.
  const tokens = defaultMarkdownParser.tokenizer.parse(source, {});
  for (const token of tokens) {
    if (token.type !== "inline") continue;
    const text = maskInlineLiterals(token.content);
    if (hasHtmlTag(text)) warnings.add("HTML");
    if (/~~[^~]+~~/.test(text)) warnings.add("取り消し線");
    if (/(?:^|\n)\s*\|?\s*:?-{3,}:?\s*\|[| :\-]*$/.test(text)
      || /(?:^|\n)\s*\|?\s*:?-{3,}:?\s*\|(?:\s*:?-{3,}:?\s*\|?)+/m.test(text)) warnings.add("表");
  }
  return [...warnings];
}

function maskInlineLiterals(source: string): string {
  let output = "";
  for (let index = 0; index < source.length;) {
    if (source[index] === "\\") { output += " "; index += 2; continue; }
    if (source[index] === "`") {
      let end = index + 1; while (source[end] === "`") end++;
      const delimiter = source.slice(index, end), close = source.indexOf(delimiter, end);
      if (close >= 0) { output += " "; index = close + delimiter.length; continue; }
      output += delimiter; index = end; continue;
    }
    output += source[index++];
  }
  return output;
}
function hasHtmlTag(source: string): boolean {
  for (let index = source.indexOf("<"); index >= 0; index = source.indexOf("<", index + 1)) {
    if (!/[a-z/!]/i.test(source[index + 1] ?? "")) continue;
    const end = source.indexOf(">", index + 1);
    if (end < 0) return false;
    // CommonMark autolinks remain supported; active/raw HTML stays in source mode.
    if (!/^<(?:https?:\/\/|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@)/i.test(source.slice(index, end + 1))) return true;
    index = end;
  }
  return false;
}
