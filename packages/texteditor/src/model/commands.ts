import type { TextEditorCommand, TextEditorModel } from "./types";
import { normalizeTextEditorModel } from "./document";
import { replaceTextEditorMatches } from "./search";
import { checkedArray, checkedOffset, checkedText, record, TEXT_EDITOR_LIMITS } from "./validation";
import { applyMarkdownCommand, applyMarkdownTaskCommand } from "../markdown/index";

const keys: Record<TextEditorCommand["type"], readonly string[]> = {
  "text.set": ["type", "text"],
  "text.insert": ["type", "offset", "text"],
  "text.replaceRange": ["type", "from", "to", "text"],
  "text.replaceRanges": ["type", "edits"],
  "text.replaceAll": ["type", "query", "replacement", "caseSensitive", "wholeWord", "regex"],
  "markdown.format": ["type", "selection", "action", "options"],
  "markdown.toggleTask": ["type", "position"],
  "document.update": ["type", "title", "mode"],
  "document.replace": ["type", "document"],
};

function replaceRange(model: TextEditorModel, from: number, to: number, text: string): TextEditorModel {
  if (from > to) throw new RangeError("置換範囲の開始位置は終了位置以下で指定してください。");
  if (model.text.length - (to - from) + text.length > TEXT_EDITOR_LIMITS.textLength) throw new RangeError("変更後の本文が文字数上限を超えています。");
  return normalizeTextEditorModel({ ...model, text: model.text.slice(0, from) + text + model.text.slice(to) });
}

function replaceRanges(model: TextEditorModel, input: unknown): TextEditorModel {
  const edits = checkedArray(input).map(value => {
    const raw = record(value, ["from", "to", "text"], "置換範囲");
    const from = checkedOffset(raw.from, model.text.length), to = checkedOffset(raw.to, model.text.length);
    if (from > to) throw new RangeError("置換範囲の開始位置は終了位置以下で指定してください。");
    return { from, to, text: checkedText(raw.text) };
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  let length = model.text.length;
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index], previous = edits[index - 1];
    if (previous && (previous.to > edit.from || previous.from === edit.from)) throw new RangeError("置換範囲の重複や同じ開始位置は指定できません。");
    length += edit.text.length - (edit.to - edit.from);
  }
  if (length > TEXT_EDITOR_LIMITS.textLength) throw new RangeError("変更後の本文が文字数上限を超えています。");
  if (!edits.length) return model;
  const parts: string[] = []; let offset = 0;
  for (const edit of edits) { parts.push(model.text.slice(offset, edit.from), edit.text); offset = edit.to; }
  parts.push(model.text.slice(offset));
  return normalizeTextEditorModel({ ...model, text: parts.join("") });
}

/** Commands execute in order against a private immutable result; failures leave input untouched. */
export function executeTextEditorCommands(input: TextEditorModel, commands: TextEditorCommand | readonly TextEditorCommand[]): TextEditorModel {
  let model = normalizeTextEditorModel(input);
  const list = checkedArray(Array.isArray(commands) ? commands : [commands]);
  for (const command of list) {
    const raw = record(command, [...new Set(Object.values(keys).flat())], "コマンド");
    if (typeof raw.type !== "string" || !Object.hasOwn(keys, raw.type)) throw new Error("未対応のテキスト編集コマンドです。");
    record(raw, keys[raw.type as TextEditorCommand["type"]], "コマンド");
    switch (raw.type) {
      case "text.set": model = normalizeTextEditorModel({ ...model, text: checkedText(raw.text) }); break;
      case "text.insert": {
        const offset = checkedOffset(raw.offset, model.text.length);
        model = replaceRange(model, offset, offset, checkedText(raw.text)); break;
      }
      case "text.replaceRange": model = replaceRange(model, checkedOffset(raw.from, model.text.length), checkedOffset(raw.to, model.text.length), checkedText(raw.text)); break;
      case "text.replaceRanges": model = replaceRanges(model, raw.edits); break;
      case "text.replaceAll": {
        const typed = raw as unknown as Extract<TextEditorCommand, { type: "text.replaceAll" }>;
        const { query, caseSensitive, wholeWord, regex } = typed;
        model = normalizeTextEditorModel({ ...model, text: replaceTextEditorMatches(model.text, { query, caseSensitive, wholeWord, regex }, checkedText(raw.replacement, "置換文字列")) }); break;
      }
      case "document.update": model = normalizeTextEditorModel({ ...model, ...(raw.title === undefined ? {} : { title: raw.title }), ...(raw.mode === undefined ? {} : { mode: raw.mode }) }); break;
      case "document.replace": model = normalizeTextEditorModel(raw.document); break;
      case "markdown.format": {
        const typed = raw as unknown as Extract<TextEditorCommand, { type: "markdown.format" }>;
        model = normalizeTextEditorModel({ ...model, text: applyMarkdownCommand(model.text, typed.selection, typed.action, typed.options).text }); break;
      }
      case "markdown.toggleTask": {
        model = normalizeTextEditorModel({ ...model, text: applyMarkdownTaskCommand(model.text, raw.position as number).text }); break;
      }
    }
  }
  return model;
}
