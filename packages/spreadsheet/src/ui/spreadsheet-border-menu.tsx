"use client";

import { useLayoutEffect, useRef } from "react";
import type { SpreadsheetBorderPreset } from "../model";
import { rangeBounds, selectionRanges } from "../state/selection";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { Icon } from "./spreadsheet-controls";

const presets: readonly [SpreadsheetBorderPreset, string][] = [
  ["all", "格子"], ["outside", "外枠"], ["inside", "内側"],
  ["top", "上罫線"], ["bottom", "下罫線"], ["left", "左罫線"], ["right", "右罫線"], ["none", "罫線なし"],
];

export function SpreadsheetBorderMenu({ controller: c, onDetails }: {
  controller: SpreadsheetController;
  onDetails: () => void;
}) {
  const latest = useRef(c), mounted = useRef(false);
  useLayoutEffect(() => { latest.current = c; });
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = c.disabled || c.requesting || c.pendingObjectEdit || !!c.selectedDrawingId;
  if (c.readOnly || !c.features.formatting) return null;

  const choose = (value: string) => {
    const current = latest.current;
    if (current.readOnly || !current.features.formatting || current.disabled || current.requesting || current.pendingObjectEdit || current.selectedDrawingId) return;
    const preset = presets.find(([key]) => key === value)?.[0];
    if (!preset && value !== "details") return;
    const selection = current.selectionApi.getSelection(), selectionKey = JSON.stringify(selection);
    const ranges = selectionRanges(selection).map(rangeBounds), structureRevision = current.getStructureRevision();
    const targetCurrent = () => mounted.current && latest.current.features.formatting && !latest.current.readOnly &&
      !latest.current.disabled && !latest.current.pendingObjectEdit && !latest.current.selectionApi.getSelectedDrawing() &&
      latest.current.getStructureRevision() === structureRevision && JSON.stringify(latest.current.selectionApi.getSelection()) === selectionKey;
    current.afterCommit(() => {
      if (!targetCurrent()) return;
      if (!preset) { onDetails(); return; }
      const revision = current.getRevision();
      void Promise.resolve(current.executeCommands([{ type: "cells.borders", sheetId: selection.sheetId, ranges, preset }], {
        isCurrent: () => targetCurrent() && current.getRevision() === revision,
        historySelection: selection,
      })).then(result => {
        if (result.ok && mounted.current) latest.current.requestGridFocus();
      }, current.reportError);
    });
  };
  // A native popup is not clipped by the horizontally scrolling ribbon and
  // retains the platform's keyboard, focus, and outside-click behavior.
  return <label className="lxs-border-menu" title="罫線">
    <Icon name="borders" /><span aria-hidden="true">▾</span>
    <select aria-label="罫線" disabled={disabled} value="" onChange={event => choose(event.currentTarget.value)}>
      <option value="" disabled>罫線</option>
      {presets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      <option value="details">罫線の詳細設定…</option>
    </select>
  </label>;
}
