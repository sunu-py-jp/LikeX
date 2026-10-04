"use client";

import { useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";
import type { SpreadsheetSearchMatch, SpreadsheetSearchQuery } from "../api/editing-commands";
import type { SpreadsheetSearchScope } from "../api/search";
import { createSpreadsheetSearchMatcher, findSpreadsheetCells, validateSpreadsheetSearchMatches } from "../model/editing/search";
import { serializeStableJson } from "../json";
import { copyQuerySnapshot } from "../model/query-snapshot";
import type { SpreadsheetController } from "./use-spreadsheet";

const EMPTY: readonly SpreadsheetSearchMatch[] = Object.freeze([]);
type Conditions = { query: SpreadsheetSearchQuery; scope: SpreadsheetSearchScope; params?: Readonly<Record<string, unknown>>; paramsKey: string; paramsError?: string };
function conditionsKey(value: Conditions) {
  const { query } = value;
  return JSON.stringify([query.text, query.matchCase ?? false, query.wholeCell ?? false, query.useRegex ?? false, query.lookIn ?? "values", value.scope, value.paramsKey, value.paramsError]);
}
/** Search results belong to confirmed conditions and a precise workbook snapshot. */
export function useSpreadsheetSearch(c: SpreadsheetController, mode: "find" | "replace") {
  const [query, updateQuery] = useState<SpreadsheetSearchQuery>({ text: "", lookIn: mode === "replace" ? "formulas" : "values" });
  const [scope, updateScope] = useState<SpreadsheetSearchScope>("sheet");
  const [replacement, setReplacement] = useState("");
  const [composing, setComposing] = useState(false);
  const [confirmed, setConfirmed] = useState<Conditions | null>(null), [submission, setSubmission] = useState(0);
  const active = useRef<AbortController | null>(null);
  let params: Conditions["params"], paramsKey = "", paramsError: string | undefined;
  try {
    if (c.search?.params !== undefined) {
      paramsKey = serializeStableJson(c.search.params, { maxLength: 100_000 });
      params = copyQuerySnapshot(JSON.parse(paramsKey));
      if (!params || Array.isArray(params) || typeof params !== "object") throw new Error("検索条件はJSONオブジェクトで指定してください");
    }
  }
  catch (reason) { paramsError = reason instanceof Error ? reason.message : "検索条件はJSON形式で指定してください"; }
  const draft: Conditions = { query, scope: c.features.sheets ? scope : "sheet", params, paramsKey, paramsError };
  const trigger = c.search?.trigger ?? "input", external = !!c.onSearchRequest;
  const configuredDelay = c.search?.debounceMs ?? 0, delay = external ? configuredDelay : 0;
  const applied = trigger === "submit" ? confirmed : draft;
  const workbook = c.workbook, appliedKey = applied ? conditionsKey(applied) : "";
  const sheetId = !applied || applied.scope === "sheet" || !c.features.sheets ? c.activeSheet.id : undefined;
  const paused = trigger !== "submit" && composing;
  const identity = useMemo(() => ({ workbook, appliedKey, sheetId, external, trigger, configuredDelay, delay, paused, submission }),
    [workbook, appliedKey, sheetId, external, trigger, configuredDelay, delay, paused, submission]);
  const latest = useRef({ identity, applied, draft, composing, controller: c });
  useInsertionEffect(() => { latest.current = { identity, applied, draft, composing, controller: c }; });
  const [outcome, setOutcome] = useState<{ identity: typeof identity; results: readonly SpreadsheetSearchMatch[]; error: string | null } | null>(null);
  const settled = outcome?.identity === identity ? outcome : null;
  const searching = !paused && !!applied?.query.text && !settled;
  const cancel = () => { active.current?.abort(); active.current = null; };
  const invalidate = () => { cancel(); setOutcome(null); };
  const setQuery = (next: SpreadsheetSearchQuery) => {
    if (conditionsKey({ ...latest.current.draft, query: next }) === conditionsKey(latest.current.draft)) return;
    if (trigger !== "submit") invalidate(); updateQuery({ ...next });
  };
  const setScope = (next: SpreadsheetSearchScope) => { if (next === latest.current.draft.scope) return; if (trigger !== "submit") invalidate(); updateScope(next); };
  const onCompositionStart = () => { if (trigger !== "submit") invalidate(); setComposing(true); };
  const onCompositionEnd = () => setComposing(false);
  const submit = () => {
    if (latest.current.composing) return;
    cancel(); setConfirmed({ ...latest.current.draft, query: copyQuerySnapshot(latest.current.draft.query) }); setSubmission(value => value + 1);
  };
  const clear = () => { invalidate(); updateQuery(previous => ({ ...previous, text: "" })); setConfirmed(null); };
  useEffect(() => {
    const { applied: conditions, controller: capturedController } = latest.current;
    if (identity.paused || !conditions?.query.text) return;
    const controller = new AbortController(); active.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => active.current === controller && !controller.signal.aborted &&
      latest.current.identity === identity && latest.current.controller.getWorkbook() === identity.workbook;
    const fail = (reason: unknown) => {
      if (current()) setOutcome({ identity, results: EMPTY, error: reason instanceof Error ? reason.message : "検索に失敗しました" });
    };
    const run = async () => {
      if (!current()) return;
      try {
        const callback = latest.current.controller.onSearchRequest;
        const found = callback ? await callback(Object.freeze({ workbook: copyQuerySnapshot(identity.workbook), query: copyQuerySnapshot(conditions.query),
          scope: identity.sheetId ? "sheet" : "workbook", ...(identity.sheetId ? { sheetId: identity.sheetId } : {}), ...(conditions.params ? { params: conditions.params } : {}) }), { signal: controller.signal })
          : findSpreadsheetCells(identity.workbook, conditions.query, { sheetId: identity.sheetId, calculated: capturedController.calculated });
        if (!current()) return;
        const validated = callback ? validateSpreadsheetSearchMatches(identity.workbook, conditions.query, found, { sheetId: identity.sheetId, calculated: capturedController.calculated }) : found;
        setOutcome({ identity, results: validated, error: null });
      } catch (reason) { fail(reason); }
    };
    const start = async () => {
      // Publish completion asynchronously; loading and invalidated results are derived from identity.
      await Promise.resolve();
      if (!current()) return;
      try {
        if (!["input", "submit"].includes(identity.trigger) || !Number.isFinite(identity.configuredDelay) || identity.configuredDelay < 0 || identity.configuredDelay > 60_000) throw new Error("検索の実行方法または待機時間が正しくありません");
        if (!["sheet", "workbook"].includes(conditions.scope)) throw new Error("検索範囲が正しくありません");
        if (conditions.paramsError) throw new Error(conditions.paramsError);
        createSpreadsheetSearchMatcher(conditions.query);
        if (identity.trigger === "input" && identity.delay) timer = setTimeout(() => { void run(); }, identity.delay);
        else void run();
      } catch (reason) { fail(reason); }
    };
    void start();
    return () => { if (timer !== undefined) clearTimeout(timer); controller.abort(); if (active.current === controller) active.current = null; };
  }, [identity]);
  return { query, setQuery, scope: draft.scope, setScope, replacement, setReplacement,
    results: settled?.results ?? EMPTY, searching, error: settled?.error ?? null,
    pending: trigger === "submit" && (!confirmed ? !!query.text : conditionsKey(draft) !== conditionsKey(confirmed)),
    submit, clear, onCompositionStart, onCompositionEnd };
}
