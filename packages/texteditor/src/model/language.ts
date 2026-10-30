import type { TextEditorMode, TextEditorModeOptions } from "./types";
import { checkedText, record, TEXT_EDITOR_LIMITS } from "./validation";

const modes: readonly string[] = ["text", "markdown", "json", "xml", "yaml"];

export function isTextEditorMode(value: unknown): value is TextEditorMode {
  return typeof value === "string" && modes.includes(value);
}

const extensions: Readonly<Record<string, TextEditorMode>> = Object.freeze({
  txt: "text", text: "text", log: "text",
  md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown", mkdn: "markdown",
  json: "json", xml: "xml", xsd: "xml", xsl: "xml", xslt: "xml", svg: "xml", xhtml: "xml",
  yaml: "yaml", yml: "yaml",
});

function modeForMimeType(value: string): TextEditorMode | undefined {
  const mime = value.split(";", 1)[0].trim().toLowerCase();
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  if (mime === "application/json" || mime === "text/json" || /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+\+json$/.test(mime)) return "json";
  if (mime === "application/xml" || mime === "text/xml" || /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+\+xml$/.test(mime)) return "xml";
  if (["application/yaml", "application/x-yaml", "text/yaml", "text/x-yaml"].includes(mime)) return "yaml";
  return undefined;
}

/** Explicit mode > specific MIME > filename extension > saved mode > plain text. Never inspects or executes source. */
export function resolveTextEditorMode(options: TextEditorModeOptions = {}): TextEditorMode {
  const raw = record(options, ["mode", "fileName", "mimeType", "fallbackMode"], "モード判定設定");
  if (raw.mode !== undefined && raw.mode !== "auto" && !isTextEditorMode(raw.mode))
    throw new Error("モードはauto、text、markdown、json、xml、yamlで指定してください。");
  if (raw.fallbackMode !== undefined && !isTextEditorMode(raw.fallbackMode))
    throw new Error("既定モードはtext、markdown、json、xml、yamlで指定してください。");
  const fileName = raw.fileName === undefined ? undefined : checkedText(raw.fileName, "ファイル名", TEXT_EDITOR_LIMITS.titleLength);
  const mimeType = raw.mimeType === undefined ? undefined : checkedText(raw.mimeType, "MIMEタイプ", TEXT_EDITOR_LIMITS.titleLength);
  if (isTextEditorMode(raw.mode)) return raw.mode;
  const fromMime = mimeType === undefined ? undefined : modeForMimeType(mimeType);
  if (fromMime) return fromMime;
  const basename = fileName?.trim().split(/[\\/]/).at(-1) ?? "";
  const dot = basename.lastIndexOf(".");
  const extension = dot > 0 ? basename.slice(dot + 1).toLowerCase() : "";
  if (Object.hasOwn(extensions, extension)) return extensions[extension];
  return raw.fallbackMode as TextEditorMode | undefined ?? "text";
}
