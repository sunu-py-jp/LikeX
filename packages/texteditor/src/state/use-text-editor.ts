"use client";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createModelEditorController, type ModelEditorAdapter } from "../core";
import { createTextEditorModel, normalizeTextEditorModel, executeTextEditorCommands } from "../model/index";
import type { TextEditorModel, TextEditorCommand } from "../model/types";
import type { TextEditorProps, TextEditorFeature } from "../props";

/**
 * The controller only compares this value to detect changes and unsaved state. Escaping the
 * whole text into JSON on every edit is the slow part for a large file, so the text is kept
 * as is after one line that holds the other fields.
 */
function textEditorIdentity(input: TextEditorModel): string {
  const model = normalizeTextEditorModel(input);
  return `${JSON.stringify([model.id, model.title, model.mode])}\n${model.text}`;
}
export const textEditorAdapter: ModelEditorAdapter<TextEditorModel, TextEditorCommand, TextEditorFeature> = {
  normalize: normalizeTextEditorModel,
  serialize: textEditorIdentity,
  execute: executeTextEditorCommands,
  features: ["editing", "history", "import", "export", "search", "replace", "formatting", "validation", "save", "refresh"],
  getCommandFeatures: command => {
    if (command.type === "document.replace") return ["import", "editing"];
    if (command.type === "text.format" || command.type.startsWith("markdown.")) return ["formatting", "editing"];
    if (command.type === "text.replaceAll") return ["search", "replace", "editing"];
    return ["editing"];
  },
};
export function useTextEditor(props: TextEditorProps) {
  const [controller] = useState(() => createModelEditorController(textEditorAdapter,
    props.initialDocument ?? createTextEditorModel({ text: props.initialText ?? "", mode: props.mode,
      fileName: props.fileName, mimeType: props.mimeType, title: props.title ?? props.fileName ?? "Untitled" }), props));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => controller.configure(props));
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  return { controller, snapshot };
}
