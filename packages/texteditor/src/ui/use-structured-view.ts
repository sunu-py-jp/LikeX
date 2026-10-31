import { useMemo, useState } from "react";
import { formatTextEditorSource } from "../model/index";
import type { TextEditorMode } from "../model/types";
import type { TextEditorFormattingOptions, TextEditorViewMode } from "../props";

type Session = {
  key: string;
  view: "source" | "formatted" | null;
  literal: boolean;
  pendingText: string | null;
};

/** A projection is never written to the model until the user edits it. */
export function useStructuredView(options: {
  text: string;
  documentId: string;
  mode: TextEditorMode;
  formatting: boolean | TextEditorFormattingOptions | undefined;
  enabled: boolean;
  pendingInput: boolean;
  epoch: number;
  initialViewMode: TextEditorViewMode | undefined;
}) {
  const inputIndent = options.formatting && typeof options.formatting === "object" ? options.formatting.indent ?? 2 : 2;
  const validIndent = Number.isInteger(inputIndent) && inputIndent >= 1 && inputIndent <= 8;
  const requestedIndent = validIndent ? inputIndent : 2;
  const requestedEnabled = !!options.formatting && validIndent;
  const [config, setConfig] = useState({ enabled: requestedEnabled, indent: requestedIndent });
  // Finish a pending edit against the projection it started from before changing its layout.
  if (!options.pendingInput && (config.enabled !== requestedEnabled || config.indent !== requestedIndent)) {
    setConfig({ enabled: requestedEnabled, indent: requestedIndent });
  }
  const enabled = options.enabled && config.enabled && ["json", "xml", "yaml"].includes(options.mode);
  const key = JSON.stringify([options.documentId, options.mode, enabled, config.indent, options.epoch]);
  const [stored, setStored] = useState<Session>({ key: "", view: null, literal: false, pendingText: null });
  const session: Session = stored.key === key ? stored : { key, view: null, literal: false, pendingText: null };
  const preserveInput = session.literal || session.pendingText !== null && session.pendingText === options.text;
  const projection = useMemo(() => {
    if (!enabled || preserveInput) return { text: options.text, changed: false };
    try { return formatTextEditorSource(options.text, { mode: options.mode, indent: config.indent }); }
    catch { return { text: options.text, changed: false }; }
  }, [options.text, options.mode, config.indent, enabled, preserveInput]);
  const view = session.view ?? (enabled && projection.changed && options.initialViewMode !== "source" ? "formatted" : "source");
  if (stored.key !== key || stored.view === null) setStored({ ...session, view });
  const showingFormatted = enabled && view === "formatted";
  return {
    key,
    showingFormatted,
    available: enabled && (projection.changed || showingFormatted),
    text: showingFormatted ? projection.text : options.text,
    change(next: "source" | "formatted") {
      if (next === view) return;
      setStored({ key, view: next, literal: false, pendingText: null });
    },
    beginInput(text: string) {
      if (showingFormatted) setStored(current => current.key === key ? { ...current, pendingText: text } : current);
    },
    finishInput(text: string, accepted: boolean) {
      if (showingFormatted) setStored(current => current.key === key && current.pendingText === text
        ? { ...current, literal: current.literal || accepted, pendingText: null } : current);
    },
  };
}
