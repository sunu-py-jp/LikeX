import type { TextEditorDiagnostic, TextEditorRangeEdit } from "./types";
import { TEXT_EDITOR_LIMITS } from "./validation";

// A parser nesting guard, not a document-size limit. Prevents recursive third-party
// parsers/string builders from overflowing on deliberately deeply nested input.
export const SOURCE_MAX_DEPTH = 256;

export function sourceDiagnostic(text: string, from: number, to: number, message: string): TextEditorDiagnostic {
  from = Math.max(0, Math.min(text.length, from));
  to = Math.max(from, Math.min(text.length, to));
  let line = 1, start = 0;
  for (let index = 0; index < from; index++) {
    if (text[index] === "\r") {
      if (text[index + 1] === "\n" && index + 1 < from) index++;
      line++; start = index + 1;
    } else if (text[index] === "\n") { line++; start = index + 1; }
  }
  return { from, to, line, column: from - start + 1, message };
}

/** Linear application with a preflight output limit; never builds an oversized result. */
export function applySourceEdits(text: string, edits: readonly TextEditorRangeEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  let length = text.length, previousEnd = 0;
  for (const edit of sorted) {
    if (edit.from < previousEnd || edit.to < edit.from) throw new Error("整形範囲が重複しています。");
    previousEnd = edit.to;
    length += edit.text.length - (edit.to - edit.from);
  }
  if (length > TEXT_EDITOR_LIMITS.textLength) throw new RangeError("整形後の本文が文字数上限を超えています。");
  const pieces: string[] = []; let offset = 0;
  for (const edit of sorted) { pieces.push(text.slice(offset, edit.from), edit.text); offset = edit.to; }
  pieces.push(text.slice(offset));
  return pieces.join("");
}

export function sourceLineEnding(text: string): string { return /\r\n|\r|\n/.exec(text)?.[0] ?? "\n"; }
