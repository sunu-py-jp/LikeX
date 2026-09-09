"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normalizeWorkbook, workbooksEqual } from "../model";
import type { SpreadsheetProps } from "../props";
import type { SpreadsheetFeatureSettings } from "./features";
import { notifySpreadsheetHost } from "./notifications";
import { clampSelection } from "./selection";
import type { DraftSelection, Workbook, WorkbookOperation } from "./types";

type HistoryDirection = "past" | "future";
type SaveSession = {
  commitEdit: () => boolean;
  hasPendingEdits: () => boolean;
  resetView: (workbook: Workbook) => void;
};

/** Owns immutable draft snapshots, bounded history, host persistence, and their synchronous guards. */
export function useWorkbookDraft(props: SpreadsheetProps, features: SpreadsheetFeatureSettings) {
  const [workbook, setWorkbook] = useState(() => normalizeWorkbook(props.initialWorkbook));
  const workbookRef = useRef(workbook);
  const propsRef = useRef(props);
  useLayoutEffect(() => { propsRef.current = props; });
  const [saved, setSaved] = useState(workbook);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const reportError = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : "操作に失敗しました"), []);
  const history = useRef<{ past: Workbook[]; future: Workbook[] }>({ past: [], future: [] });
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false });
  const readOnly = props.readOnly === true || !props.onSave;
  const disabled = readOnly || saving;
  const dirty = useMemo(() => !workbooksEqual(workbook, saved), [workbook, saved]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const apply = useCallback((operation: WorkbookOperation, selection: DraftSelection): boolean => {
    if (!mounted.current || propsRef.current.readOnly || !propsRef.current.onSave || savingRef.current) return false;
    try {
      const before = workbookRef.current;
      const next = operation(before);
      if (next === before) return true;
      // Selection normalization may reject a structural change. Nothing has been published yet.
      const nextSelection = clampSelection(selection.selectionRef.current, next);
      if (propsRef.current.features?.undoRedo !== false) {
        history.current.past = [...history.current.past.slice(-49), before];
        history.current.future = [];
      } else history.current = { past: [], future: [] };
      setHistoryStatus({ canUndo: history.current.past.length > 0, canRedo: false });
      workbookRef.current = next;
      setWorkbook(next);
      selection.setSelection(nextSelection);
      setError(null);
      notifySpreadsheetHost(propsRef.current.onChange, next);
      return true;
    } catch (cause) { reportError(cause); return false; }
  }, [reportError]);

  const changeHistory = (direction: HistoryDirection, resetView: (workbook: Workbook) => void) => {
    if (disabled || !features.undoRedo) return;
    const next = history.current[direction].at(-1);
    if (!next) return;
    const opposite = direction === "past" ? "future" : "past";
    history.current[opposite] = [...history.current[opposite].slice(-49), workbookRef.current];
    history.current[direction] = history.current[direction].slice(0, -1);
    setHistoryStatus({ canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0 });
    workbookRef.current = next;
    setWorkbook(next);
    setError(null);
    resetView(next);
    notifySpreadsheetHost(propsRef.current.onChange, next);
  };

  const save = async (session: SaveSession) => {
    if (propsRef.current.readOnly || !propsRef.current.onSave || savingRef.current || !session.commitEdit()) return;
    if (session.hasPendingEdits()) { reportError(new Error("編集中の内容を確定してください")); return; }
    const snapshot = workbookRef.current;
    if (workbooksEqual(snapshot, saved)) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await propsRef.current.onSave(snapshot);
      const accepted = normalizeWorkbook(response ?? snapshot);
      if (!mounted.current) return;
      workbookRef.current = accepted;
      setWorkbook(accepted);
      setSaved(accepted);
      history.current = { past: [], future: [] };
      setHistoryStatus({ canUndo: false, canRedo: false });
      session.resetView(accepted);
    } catch (cause) { if (mounted.current) reportError(cause); }
    finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };

  return { workbook, workbookRef, propsRef, readOnly, disabled, dirty, saving, error, setError, reportError,
    apply, changeHistory, save, ...historyStatus };
}
