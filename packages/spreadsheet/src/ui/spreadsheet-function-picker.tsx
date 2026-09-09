"use client";

import { useLayoutEffect, useRef } from "react";
import { SUPPORTED_SPREADSHEET_FUNCTIONS } from "../model/function-definitions";
import type { SpreadsheetController } from "../state/use-spreadsheet";

/** Starts an ordinary cell edit; choosing a function never commits its example. */
export function SpreadsheetFunctionPicker({ controller: c }: { controller: SpreadsheetController }) {
  const select = useRef<HTMLSelectElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const disabled = c.disabled || !!c.selectedDrawingId;

  useLayoutEffect(() => {
    const example = pendingFocus.current;
    if (!example) return;
    pendingFocus.current = null;
    if (disabled || !c.features.formulas || c.editing?.value !== example) return;
    const input = select.current?.closest("[data-likex-spreadsheet]")?.querySelector<HTMLInputElement>("[data-lxs-formula]");
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(example.indexOf("(") + 1, example.lastIndexOf(")"));
  });

  if (!c.features.formulas || c.readOnly) return null;
  return <div className="lxs-tool-group">
    <select ref={select} aria-label="関数を挿入" className="lxs-select" value="" disabled={disabled}
      title="関数の例を入力します。引数を変更して Enter で確定します。"
      onChange={event => {
        if (disabled || !c.features.formulas) return;
        const definition = SUPPORTED_SPREADSHEET_FUNCTIONS.find(item => item.name === event.target.value);
        if (!definition) return;
        pendingFocus.current = definition.example;
        c.beginEdit(c.selection.focus, definition.example);
      }}>
      <option value="" disabled>ƒx 関数</option>
      {SUPPORTED_SPREADSHEET_FUNCTIONS.map(definition => <option key={definition.name} value={definition.name}
        title={`${definition.syntax} — ${definition.description}`}>{definition.name} · {definition.label}</option>)}
    </select>
  </div>;
}
