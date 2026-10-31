import type { TextEditorDiagnostic, TextEditorFormatOptions, TextEditorFormatResult, TextEditorModeOptions } from "./types";
import { checkedText, record } from "./validation";
import { resolveTextEditorMode } from "./language";
import { formatJsonSource, validateJsonSource } from "./source-json";
import { formatXmlSource, inspectXmlSource } from "./source-xml";
import { formatYamlSource, inspectYamlSource } from "./source-yaml";

/** Syntax diagnostics only: no schema validation, external references or executable tags. */
export function validateTextEditorSource(text: string, options: TextEditorModeOptions = {}): readonly TextEditorDiagnostic[] {
  checkedText(text);
  const mode = resolveTextEditorMode(options);
  if (mode === "json") return validateJsonSource(text);
  if (mode === "xml") return inspectXmlSource(text).diagnostics;
  if (mode === "yaml") return inspectYamlSource(text).diagnostics;
  return [];
}

/** Returns a derived view without changing the authoritative model or its language. */
export function formatTextEditorSource(text: string, options: TextEditorFormatOptions = {}): TextEditorFormatResult {
  checkedText(text);
  const raw = record(options, ["mode", "fileName", "mimeType", "fallbackMode", "indent"], "整形設定");
  const indent = raw.indent === undefined ? 2 : raw.indent;
  if (!Number.isInteger(indent) || (indent as number) < 1 || (indent as number) > 8) throw new RangeError("インデントは1〜8の整数で指定してください。");
  const { mode, fileName, mimeType, fallbackMode } = raw as TextEditorFormatOptions;
  const resolved = resolveTextEditorMode({ mode, fileName, mimeType, fallbackMode });
  let formatted = text;
  if (resolved === "json") {
    if (!validateJsonSource(text).length) formatted = formatJsonSource(text, indent as number);
  } else if (resolved === "xml") {
    const source = inspectXmlSource(text);
    if (!source.diagnostics.length) formatted = formatXmlSource(text, indent as number, source);
  } else if (resolved === "yaml") {
    const source = inspectYamlSource(text);
    if (!source.diagnostics.length) formatted = formatYamlSource(text, indent as number, source);
  }
  return { text: checkedText(formatted), mode: resolved, changed: formatted !== text };
}
