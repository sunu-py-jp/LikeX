"use client";

import { useId, useLayoutEffect, useRef } from "react";
import type { MaybePromise } from "../../core";
import type { SpreadsheetController } from "../../state/use-spreadsheet";

/** Only the native picker needs an opaque sRGB value. Never normalize the saved color on focus. */
function preparePicker(input: HTMLInputElement, swatch: HTMLElement | null) {
  if (!swatch) return;
  const doc = input.ownerDocument;
  const color = doc.defaultView?.getComputedStyle?.(swatch).backgroundColor;
  if (!color) return;
  const canvas = doc.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  input.value = `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

function pickerHex(color: string): string | undefined {
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color)) return color.slice(0, 7).toLowerCase();
  if (/^#[\da-f]{3,4}$/i.test(color)) return `#${[...color.slice(1, 4)].map(value => value + value).join("")}`.toLowerCase();
}

/** Color selection is an ordinary drawing command, with no editable CSS/code field. */
export function ColorPropertyField({ label, value, controller: c, onCommit, reset }: {
  label: string;
  value: string;
  controller: SpreadsheetController;
  onCommit: (value: string) => MaybePromise<boolean>;
  reset: Readonly<{ label: "なし" | "自動"; value: string }>;
}) {
  const id = useId(), swatch = useRef<HTMLSpanElement>(null), input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!input.current) return;
    const hex = pickerHex(value);
    if (hex) input.current.value = hex; else preparePicker(input.current, swatch.current);
  }, [value]);
  const disabled = c.disabled || c.requesting;
  const resetSelected = value.toLowerCase() === reset.value.toLowerCase() || (reset.value === "transparent" && value.toLowerCase() === "none");
  const change = (next: string) => { if (!disabled && next !== value) void onCommit(next); };
  return <div className="lxs-object-property">
    <label htmlFor={id}>{label}</label>
    <div className="lxs-object-color-controls">
      <span className="lxs-object-color-picker">
        <span ref={swatch} className="lxs-object-color-swatch" aria-hidden="true" style={{ backgroundColor: value === "none" ? "transparent" : value }} />
        <input ref={input} id={id} type="color" defaultValue={pickerHex(value) ?? "#000000"} aria-label={label} title={`${label}を選択`} disabled={disabled}
          onFocus={event => preparePicker(event.currentTarget, swatch.current)}
          onClick={event => preparePicker(event.currentTarget, swatch.current)}
          onInput={event => change(event.currentTarget.value)}
          onKeyDown={event => {
            event.stopPropagation();
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void c.save(); }
          }} />
      </span>
      <button type="button" className="lxs-object-color-reset" aria-label={`${label}を${reset.label}にする`}
        aria-pressed={resetSelected} disabled={disabled} onClick={() => change(reset.value)}>{reset.label}</button>
    </div>
  </div>;
}
