import { serializeStableJson } from "../core";
import type { TextEditorInput, TextEditorModel } from "./types";
import { checkedId, checkedText, record, TEXT_EDITOR_LIMITS } from "./validation";
import { isTextEditorMode, resolveTextEditorMode } from "./language";

const knownModels = new WeakSet<object>();

export function normalizeTextEditorModel(input: unknown): TextEditorModel {
  if (input && typeof input === "object" && knownModels.has(input)) return input as TextEditorModel;
  const raw = record(input, ["format", "version", "id", "title", "mode", "text"], "テキスト文書");
  if (raw.format !== "likex.texteditor" || raw.version !== 1) throw new Error("LikeTextEditor version 1のJSONを指定してください。");
  if (!isTextEditorMode(raw.mode)) throw new Error("モードはtext、markdown、json、xml、yamlで指定してください。");
  const model: TextEditorModel = Object.freeze({ format: "likex.texteditor", version: 1, id: checkedId(raw.id), title: checkedText(raw.title, "タイトル", TEXT_EDITOR_LIMITS.titleLength), mode: raw.mode, text: checkedText(raw.text) });
  knownModels.add(model);
  return model;
}

export function createTextEditorModel(input: TextEditorInput = {}): TextEditorModel {
  const raw = record(input, ["id", "title", "mode", "text", "fileName", "mimeType"], "初期文書");
  const title = raw.title === undefined ? "無題の文書" : checkedText(raw.title, "タイトル", TEXT_EDITOR_LIMITS.titleLength);
  const mode = resolveTextEditorMode({ mode: raw.mode as TextEditorInput["mode"], fileName: (raw.fileName === undefined ? title : raw.fileName) as string, mimeType: raw.mimeType as string | undefined });
  return normalizeTextEditorModel({ format: "likex.texteditor", version: 1, id: raw.id === undefined ? crypto.randomUUID() : raw.id, title, mode, text: raw.text === undefined ? "" : raw.text });
}

export function parseTextEditorModel(json: string): TextEditorModel {
  if (typeof json !== "string" || json.length > TEXT_EDITOR_LIMITS.jsonBytes || new TextEncoder().encode(json).byteLength > TEXT_EDITOR_LIMITS.jsonBytes)
    throw new Error("テキスト文書JSONは64 MiB以下で指定してください。");
  return normalizeTextEditorModel(JSON.parse(json));
}

export function serializeTextEditorModel(input: TextEditorModel): string {
  const json = serializeStableJson(normalizeTextEditorModel(input), { space: 2, maxLength: TEXT_EDITOR_LIMITS.jsonBytes - 1 }) + "\n";
  if (new TextEncoder().encode(json).byteLength > TEXT_EDITOR_LIMITS.jsonBytes) throw new Error("テキスト文書JSONは64 MiB以下で指定してください。");
  return json;
}

/** Import decoded source using its mode or file metadata. Encoding/file access remains with the host. */
export function importTextEditorText(text: string, options: Omit<TextEditorInput, "text"> = {}): TextEditorModel {
  const raw = record(options, ["id", "title", "mode", "fileName", "mimeType"], "読み込み設定");
  return createTextEditorModel({ ...raw, text });
}

/** Export exact source, retaining whitespace, Markdown syntax and line endings. */
export function exportTextEditorText(model: TextEditorModel): string { return normalizeTextEditorModel(model).text; }
