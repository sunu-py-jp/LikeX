"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SpreadsheetAutoFilter, SpreadsheetSheet } from "../model/types";
import type { SpreadsheetCommand } from "../commands/types";
import type { SpreadsheetFilterViewApi } from "../api/filter-view";
import { calculateWorkbook } from "../model/formula";
import { getSpreadsheetFilteredRows, getSpreadsheetFilterValues, normalizeSpreadsheetAutoFilter } from "../model/filters";
import { stageSpreadsheetCommands } from "../commands/stage-spreadsheet-commands";
import { resolveSpreadsheetFeatures } from "../api/resolve-features";
import type { useWorkbookDraft } from "./use-workbook-draft";
import type { useSpreadsheetSelection } from "./use-spreadsheet-selection";
import type { useSpreadsheetCommands } from "./use-spreadsheet-commands";
import { rangeBounds, selectionRanges } from "./selection";

type Override = { revision: number; replacement: number; filter: SpreadsheetAutoFilter | undefined };

/** Persist editable GUI changes; keep viewer filtering in a separate, disposable view overlay. */
export function useSpreadsheetFilters(draft: ReturnType<typeof useWorkbookDraft>, view: ReturnType<typeof useSpreadsheetSelection>,
  commands: ReturnType<typeof useSpreadsheetCommands>, calculated: ReturnType<typeof calculateWorkbook>, hasPendingInput: () => boolean) {
  const overrides = useRef(new Map<string, Override>());
  const [overlays, setOverlays] = useState(new Map<string, Override>());
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const getOverride = (sheetId: string) => {
    const item = overrides.current.get(sheetId);
    // Never attach coordinates from an earlier workbook or edit to a new sheet.
    return item?.revision === draft.revisionRef.current && item.replacement === draft.replacementRevisionRef.current ? item : undefined;
  };
  const sheetFor = (sheetId: string): SpreadsheetSheet | undefined => {
    const sheet = draft.workbookRef.current.sheets.find(item => item.id === sheetId);
    const overlay = getOverride(sheetId);
    return sheet && overlay ? { ...sheet, autoFilter: overlay.filter } : sheet;
  };
  const available = () => mounted.current && draft.propsRef.current.features?.filters !== false && !draft.isOperationPending() && !hasPendingInput();
  const valuesFor = (sheetId: string) => (draft.workbook === draft.workbookRef.current ? calculated : calculateWorkbook(draft.workbookRef.current))[sheetId];
  const publish = (sheetId: string, filter: SpreadsheetAutoFilter | undefined) => {
    const previous = sheetFor(sheetId)?.autoFilter;
    if (JSON.stringify(previous) === JSON.stringify(filter)) return false;
    overrides.current.set(sheetId, { revision: draft.revisionRef.current, replacement: draft.replacementRevisionRef.current, filter });
    setOverlays(new Map(overrides.current));
    draft.emitEvent({ type: "filter-view-change", sheetId, autoFilter: filter ?? null });
    return true;
  };
  const replaceCommands = (sheetId: string, filter: SpreadsheetAutoFilter | null): SpreadsheetCommand[] => filter === null
    ? [{ type: "filters.remove", sheetId }]
    : [{ type: "filters.setRange", sheetId, range: filter.range, inferRows: false },
      { type: "filters.clear", sheetId },
      ...(filter.columns ?? []).map(column => ({ type: "filters.setValues" as const, sheetId, column: column.column, values: column.values }))];
  const stageView = (sheetId: string, operations: readonly SpreadsheetCommand[]) => {
    const sheet = sheetFor(sheetId);
    if (!available() || !sheet) return false;
    const workbook = draft.workbookRef.current;
    const staged = stageSpreadsheetCommands({ ...workbook, sheets: workbook.sheets.map(item => item.id === sheetId ? sheet : item) },
      operations, resolveSpreadsheetFeatures(draft.propsRef.current.features), () => crypto.randomUUID());
    if (!staged.ok) { draft.reportError(new Error(staged.message)); return false; }
    return publish(sheetId, staged.workbook.sheets.find(item => item.id === sheetId)?.autoFilter);
  };
  const filterViewApi: SpreadsheetFilterViewApi = {
    getFilterView: sheetId => sheetFor(sheetId)?.autoFilter,
    setFilterView: (sheetId, filter) => {
      const sheet = sheetFor(sheetId);
      if (!available() || !sheet || filter === undefined) return false;
      try { return publish(sheetId, normalizeSpreadsheetAutoFilter(filter === null ? undefined : filter, sheet)); } catch { return false; }
    },
    resetFilterView: sheetId => {
      if (!available() || !getOverride(sheetId)) return false;
      overrides.current.delete(sheetId); setOverlays(new Map(overrides.current));
      draft.emitEvent({ type: "filter-view-change", sheetId, autoFilter: sheetFor(sheetId)?.autoFilter ?? null });
      return true;
    },
    getFilteredRows: sheetId => {
      const sheet = sheetFor(sheetId);
      return Object.freeze(sheet ? [...getSpreadsheetFilteredRows(sheet, valuesFor(sheetId))] : []);
    },
  };
  // View updates and workbook edits recalculate once; cursor movement reuses the same row set.
  const workbookRevision = draft.revisionRef.current, replacementRevision = draft.replacementRevisionRef.current;
  const activeSheet = useMemo(() => {
    const overlay = overlays.get(view.activeSheet.id);
    return overlay?.revision === workbookRevision && overlay.replacement === replacementRevision
      ? { ...view.activeSheet, autoFilter: overlay.filter } : view.activeSheet;
  }, [view.activeSheet, workbookRevision, replacementRevision, overlays]);
  useEffect(() => {
    for (const [id, item] of overrides.current) if (item.revision !== draft.revisionRef.current || item.replacement !== draft.replacementRevisionRef.current)
      overrides.current.delete(id);
  }, [draft.workbook, draft.revisionRef, draft.replacementRevisionRef]);
  const hiddenRows = useMemo(() => getSpreadsheetFilteredRows(activeSheet, calculated[activeSheet.id]), [activeSheet, calculated]);
  const run = (command: SpreadsheetCommand & { sheetId: string }) => {
    if (!available()) return;
    if (draft.propsRef.current.readOnly || !draft.propsRef.current.onSave) { stageView(command.sheetId, [command]); return; }
    const overlay = getOverride(command.sheetId);
    const items = overlay ? [...replaceCommands(command.sheetId, overlay.filter ?? null), command] : [command];
    const result = commands.executeCommands(items);
    if (result instanceof Promise) void result.catch(draft.reportError);
  };
  const selectedRanges = selectionRanges(view.selection);
  const filters = {
    autoFilter: activeSheet.autoFilter, hiddenRows,
    disabled: draft.propsRef.current.features?.filters === false || draft.isOperationPending() || hasPendingInput(),
    toggle: () => {
      const sheetId = view.selectionRef.current.sheetId;
      if (sheetFor(sheetId)?.autoFilter) { run({ type: "filters.remove", sheetId }); return; }
      const ranges = selectionRanges(view.selectionRef.current);
      if (ranges.length !== 1) { draft.reportError(new Error("フィルターを設定する連続した範囲を1つ選択してください")); return; }
      run({ type: "filters.setRange", sheetId, range: rangeBounds(ranges[0]) });
    },
    clear: () => run({ type: "filters.clear", sheetId: view.selectionRef.current.sheetId }),
    setValues: (column: number, values: readonly string[] | null) => run({ type: "filters.setValues", sheetId: view.selectionRef.current.sheetId, column, values }),
    getValues: (column: number) => getSpreadsheetFilterValues(activeSheet, column, calculated[activeSheet.id]),
    canSetRange: selectedRanges.length === 1,
  };
  return { filters, filterViewApi };
}
