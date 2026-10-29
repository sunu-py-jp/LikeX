"use client";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createModelEditorController, type ModelEditorAdapter } from "../core";
import { createTextEditorModel, normalizeTextEditorModel, serializeTextEditorModel, executeTextEditorCommands } from "../model/index";
import type { TextEditorModel, TextEditorCommand } from "../model/types";
import type { TextEditorProps, TextEditorFeature } from "../props";

export const textEditorAdapter: ModelEditorAdapter<TextEditorModel, TextEditorCommand, TextEditorFeature> = {
  normalize: normalizeTextEditorModel,
  serialize: serializeTextEditorModel,
  execute: executeTextEditorCommands,
  features: ["editing", "history", "import", "export"],
  getCommandFeatures: command => command.type === "document.replace" ? ["import", "editing"] : ["editing"],
};
export function useTextEditor(props: TextEditorProps) {
  const [controller] = useState(() => createModelEditorController(textEditorAdapter,
    props.initialDocument ?? createTextEditorModel({ text: props.initialText ?? "", mode: props.mode ?? "text", title: props.title ?? "Untitled" }), props));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => controller.configure(props));
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  return { controller, snapshot };
}
