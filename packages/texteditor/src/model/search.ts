import { createTextSearchMatcher } from "../text-search";
import type { TextEditorModel, TextEditorRange, TextEditorSearchOptions } from "./types";
import { normalizeTextEditorModel } from "./document";
import { checkedText, record, TEXT_EDITOR_LIMITS } from "./validation";

const wordCharacter = /[\p{L}\p{M}\p{N}_]/u;
function isWholeWord(text: string, from: number, to: number): boolean {
  let previous = from - 1;
  if (previous > 0 && text.charCodeAt(previous) >= 0xdc00 && text.charCodeAt(previous) <= 0xdfff && text.charCodeAt(previous - 1) >= 0xd800 && text.charCodeAt(previous - 1) <= 0xdbff) previous--;
  const before = previous >= 0 ? String.fromCodePoint(text.codePointAt(previous)!) : "";
  const after = to < text.length ? String.fromCodePoint(text.codePointAt(to)!) : "";
  return !wordCharacter.test(before) && !wordCharacter.test(after);
}

export function* textEditorMatches(text: string, input: TextEditorSearchOptions): Iterable<TextEditorRange> {
  const raw = record(input, ["query", "caseSensitive", "wholeWord", "regex"], "検索設定");
  const query = checkedText(raw.query, "検索語", 100_000);
  for (const key of ["caseSensitive", "wholeWord", "regex"] as const)
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") throw new Error(`検索設定の${key}をbooleanで指定してください。`);
  const matcher = createTextSearchMatcher({ text: query, matchCase: raw.caseSensitive === true, useRegex: raw.regex === true });
  for (const match of matcher.matches(text)) if (!raw.wholeWord || isWholeWord(text, match.from, match.to)) yield match;
}

/** Returns every result or throws when maxMatches is exceeded; never truncates. */
export function findTextEditorMatches(input: TextEditorModel | string, options: TextEditorSearchOptions, maxMatches: number = TEXT_EDITOR_LIMITS.matches): readonly TextEditorRange[] {
  const text = typeof input === "string" ? checkedText(input) : normalizeTextEditorModel(input).text;
  if (!Number.isSafeInteger(maxMatches) || maxMatches < 0) throw new RangeError("一致件数の上限は0以上の安全な整数で指定してください。");
  const results: TextEditorRange[] = [];
  for (const match of textEditorMatches(text, options)) {
    if (results.length >= maxMatches) throw new RangeError(`一致件数が上限（${maxMatches}件）を超えています。`);
    results.push(match);
  }
  return Object.freeze(results);
}

export function replaceTextEditorMatches(text: string, options: TextEditorSearchOptions, replacement: string): string {
  checkedText(replacement, "置換文字列");
  const parts: string[] = [];
  let previous = 0, outputLength = 0, buffer = "";
  const append = (value: string) => {
    if (!value) return;
    if (value.length > TEXT_EDITOR_LIMITS.textLength - outputLength) throw new RangeError("置換後の本文が文字数上限を超えています。");
    outputLength += value.length;
    if (buffer.length + value.length > 16_384) { if (buffer) parts.push(buffer); buffer = ""; }
    if (value.length >= 16_384) parts.push(value); else buffer += value;
  };
  for (const match of textEditorMatches(text, options)) {
    append(text.slice(previous, match.from)); append(replacement); previous = match.to;
  }
  append(text.slice(previous));
  if (buffer) parts.push(buffer);
  return parts.join("");
}
