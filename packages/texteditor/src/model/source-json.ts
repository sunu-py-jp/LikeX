import { createScanner, format, printParseErrorCode, visit } from "jsonc-parser";
import type { TextEditorDiagnostic } from "./types";
import { applySourceEdits, sourceDiagnostic, sourceLineEnding, SOURCE_MAX_DEPTH } from "./source-format-utils";
import { TEXT_EDITOR_LIMITS } from "./validation";

const jsonErrorMessages: Record<string, string> = {
  InvalidSymbol: "利用できない文字があります。", InvalidNumberFormat: "数値の形式が正しくありません。",
  PropertyNameExpected: "プロパティ名を二重引用符で指定してください。", ValueExpected: "値が必要です（末尾の余分なカンマも確認してください）。",
  ColonExpected: "プロパティ名の後にコロンが必要です。", CommaExpected: "値の間にカンマが必要です。",
  CloseBraceExpected: "閉じ波括弧 } が必要です。", CloseBracketExpected: "閉じ角括弧 ] が必要です。",
  EndOfFileExpected: "値の後に余分な文字があります。", InvalidCommentToken: "JSONではコメントを利用できません。",
  UnexpectedEndOfComment: "コメントが閉じられていません。", UnexpectedEndOfString: "文字列の二重引用符が閉じられていません。",
  UnexpectedEndOfNumber: "数値が途中で終わっています。", InvalidUnicode: "Unicodeエスケープが正しくありません。",
  InvalidEscapeCharacter: "文字列のエスケープが正しくありません。", InvalidCharacter: "文字列に利用できない文字があります。",
};
// Public jsonc-parser token identifiers. Its declarations use ambient const
// enums, which cannot be consumed with this library's isolatedModules build.
const SyntaxKind = { OpenBraceToken: 1, CloseBraceToken: 2, OpenBracketToken: 3, CloseBracketToken: 4, CommaToken: 5, ColonToken: 6, EOF: 17 } as const;

export function validateJsonSource(text: string): TextEditorDiagnostic[] {
  const scanner = createScanner(text);
  let depth = 0;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
    if (kind === SyntaxKind.OpenBraceToken || kind === SyntaxKind.OpenBracketToken) depth++;
    if (kind === SyntaxKind.CloseBraceToken || kind === SyntaxKind.CloseBracketToken) depth--;
    if (depth > SOURCE_MAX_DEPTH) return [sourceDiagnostic(text, scanner.getTokenOffset(), scanner.getPosition(), "JSON: 入れ子が深すぎるため構文確認・整形できません。")];
  }
  const errors: TextEditorDiagnostic[] = [], stop = {};
  try {
    visit(text, { onError(code, offset, length) {
      const name = printParseErrorCode(code);
      errors.push(sourceDiagnostic(text, offset, offset + length, `JSON構文エラー: ${jsonErrorMessages[name] ?? name}`));
      throw stop;
    } }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  } catch (error) { if (error !== stop) throw error; }
  return errors;
}

export function formatJsonSource(text: string, indent: number): string {
  // Preflight the exact compact-to-pretty upper bound before the dependency
  // allocates indentation edits (a wide, deeply nested array can expand a lot).
  const scanner = createScanner(text, true), eol = sourceLineEnding(text);
  let depth = 0, previous: number | undefined, length = /(?:\r\n|\r|\n)$/.test(text) ? eol.length : 0;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
    if (kind === SyntaxKind.CloseBraceToken || kind === SyntaxKind.CloseBracketToken) depth--;
    const closesEmpty = previous === SyntaxKind.OpenBraceToken && kind === SyntaxKind.CloseBraceToken || previous === SyntaxKind.OpenBracketToken && kind === SyntaxKind.CloseBracketToken;
    if (!closesEmpty && (kind === SyntaxKind.CloseBraceToken || kind === SyntaxKind.CloseBracketToken || previous === SyntaxKind.OpenBraceToken || previous === SyntaxKind.OpenBracketToken || previous === SyntaxKind.CommaToken)) length += eol.length + depth * indent;
    else if (previous === SyntaxKind.ColonToken) length++;
    length += scanner.getTokenLength();
    if (length > TEXT_EDITOR_LIMITS.textLength) throw new RangeError("整形後の本文が文字数上限を超えています。");
    if (kind === SyntaxKind.OpenBraceToken || kind === SyntaxKind.OpenBracketToken) depth++;
    previous = kind;
  }
  // The formatter edits token gaps, never decoded values: duplicate properties,
  // numeric lexemes and the spelling of escapes survive unchanged.
  const edits = format(text, undefined, { insertSpaces: true, tabSize: indent, eol, insertFinalNewline: /(?:\r\n|\r|\n)$/.test(text) });
  return applySourceEdits(text, edits.map(edit => ({ from: edit.offset, to: edit.offset + edit.length, text: edit.content })));
}
