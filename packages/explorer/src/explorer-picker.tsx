"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { X } from "lucide-react";
import { ExplorerWorkspaceView } from "./explorer";
import type { ExplorerProps } from "./props";
import type { ExplorerPickerDialogProps, ExplorerPickerHandle, ExplorerPickerProps } from "./picker-props";
import { resolveExplorerPickerItems } from "./model/picker";
import { useExplorerFields } from "./state/explorer-context";
import { useExplorerWorkspace, type ExplorerWorkspace } from "./state/use-explorer-workspace";
import { Dialog } from "./ui/explorer-overlays";
import { buttonClass, iconButtonClass } from "./ui/explorer-controls";
import { explorerThemeStyle, useExplorerColorScheme } from "./ui/explorer-theme";

type PickerActions = {
  confirm(ids?: readonly string[]): Promise<boolean>;
  selectCurrentFolder(): Promise<boolean>;
  cancel(): void;
};
function createPickerBridge() {
  let current: PickerActions | null = null;
  return {
    confirm: (ids?: readonly string[]) => current?.confirm(ids) ?? Promise.resolve(false),
    selectCurrentFolder: () => current?.selectCurrentFolder() ?? Promise.resolve(false),
    cancel: () => current?.cancel(),
    register(actions: PickerActions) {
      current = actions;
      return () => { if (current === actions) current = null; };
    },
  };
}
type PickerBridge = ReturnType<typeof createPickerBridge>;
type SessionProps = ExplorerPickerProps & { onAccepted?(): void; onCancelled?(): void };

/** Embedded file/folder picker. Display operations share the Explorer controller. */
export function ExplorerPicker(props: ExplorerPickerProps) {
  return <PickerSession {...props} />;
}

function PickerSession({ ref, kind = "file", multiple = false, initialSelectedIds,
  onConfirm, onCancel, onSelectionChange, confirmLabel, cancelLabel, footerMessage, onAccepted, onCancelled,
  ...explorerProps }: SessionProps) {
  const props: ExplorerProps = {
    ...explorerProps, ref: undefined, readOnly: true, onSave: undefined, onEditRequest: undefined,
    selectedFileMode: "select", warnOnUnsavedChanges: false,
    selection: { mode: multiple ? "multiple" : "single", kind },
    features: { ...explorerProps.features, tabs: false, detachTabs: false, preview: false, download: false, details: false },
    ui: { ...explorerProps.ui, contextMenu: false, rowActions: false },
  };
  const workspace = useExplorerWorkspace(props);
  const [bridge] = useState(createPickerBridge);
  const interaction = useMemo(() => ({ onFileActivate: (id: string) => { void bridge.confirm([id]); } }), [bridge]);
  useImperativeHandle(ref, () => ({
    navigate: workspace.navigation.handle.navigate,
    selectFiles: workspace.navigation.handle.selectFiles,
    selectEntries: workspace.navigation.handle.selectEntries,
    openContainingFolder: workspace.navigation.handle.openContainingFolder,
    confirm: () => bridge.confirm(),
    selectCurrentFolder: bridge.selectCurrentFolder,
    cancel: bridge.cancel,
  }), [workspace.navigation, bridge]);
  return <ExplorerWorkspaceView props={props} workspace={workspace}
    ownerDocument={typeof document === "undefined" ? null : document} interaction={interaction}
    footer={<PickerFooter workspace={workspace} bridge={bridge} kind={kind} multiple={multiple}
      initialSelectedIds={initialSelectedIds} onConfirm={onConfirm} onCancel={onCancel}
      onSelectionChange={onSelectionChange} onAccepted={onAccepted} onCancelled={onCancelled}
      confirmLabel={confirmLabel} cancelLabel={cancelLabel} footerMessage={footerMessage} rootLabel={props.rootLabel} />} />;
}

type FooterProps = Pick<SessionProps, "kind" | "multiple" | "initialSelectedIds" | "onConfirm" | "onCancel" |
  "onSelectionChange" | "onAccepted" | "onCancelled" | "confirmLabel" | "cancelLabel" | "footerMessage" | "rootLabel"> & {
  workspace: ExplorerWorkspace;
  bridge: PickerBridge;
};
function PickerFooter({ workspace, bridge, kind = "file", multiple = false, rootLabel, initialSelectedIds,
  onConfirm, onCancel, onSelectionChange, onAccepted, onCancelled, confirmLabel, cancelLabel, footerMessage }: FooterProps) {
  const { entries, selected, locationInfo, query, activeTabId, folderPending, searchPending, folderError, searchError } =
    useExplorerFields("entries", "selected", "locationInfo", "query", "activeTabId", "folderPending", "searchPending", "folderError", "searchError");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const mounted = useRef(false);
  const request = useRef<{ controller: AbortController; view: string; selections: Set<string>; ids: readonly string[]; items: string } | null>(null);
  const initial = useRef(initialSelectedIds), initialized = useRef(false);
  const options = useMemo(() => ({ kind, multiple, rootLabel }), [kind, multiple, rootLabel]);
  const selection = useMemo(() => resolveExplorerPickerItems(entries, selected, options), [entries, selected, options]);
  const selectionKey = JSON.stringify(selection.ok ? selection.items : []);
  const selectedKey = JSON.stringify(selected);
  const viewKey = JSON.stringify([activeTabId, locationInfo, query, kind, multiple]);
  const failureKey = `${viewKey}:${selectionKey}`;
  const error = failure?.key === failureKey ? failure.message : null;
  const setError = useCallback((message: string | null) => {
    setFailure(message === null ? null : { key: failureKey, message });
  }, [failureKey]);
  const abort = useCallback(() => {
    request.current?.controller.abort(); request.current = null;
    if (mounted.current) setPending(false);
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.controller.abort(); request.current = null; };
  }, []);
  useLayoutEffect(() => {
    const operation = request.current;
    if (!operation) return;
    const latest = resolveExplorerPickerItems(entries, operation.ids, options);
    if (operation.view !== viewKey || !operation.selections.has(selectedKey) ||
      !latest.ok || JSON.stringify(latest.items) !== operation.items) abort();
  }, [viewKey, selectedKey, entries, options, abort]);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (!initial.current) return;
    const result = workspace.navigation.handle.selectEntries(initial.current.map(id => ({ id })));
    if (!result.ok) setError(result.message);
  }, [workspace.navigation, setError]);
  const reportedSelection = useRef<string | null>(null);
  useEffect(() => {
    if (reportedSelection.current === selectionKey) return;
    reportedSelection.current = selectionKey;
    onSelectionChange?.(selection.ok ? selection.items : []);
  }, [selection, selectionKey, onSelectionChange]);

  async function confirm(ids?: readonly string[]): Promise<boolean> {
    if (!mounted.current || request.current) return false;
    const latest = workspace.tabs.forWindow("main");
    if (latest.activeTabId !== activeTabId || latest.activeTab.query !== query ||
      (locationInfo.kind === "folder" && latest.activeTab.requestedLocation !== locationInfo.id)) return false;
    if (folderPending || searchPending || folderError || searchError) {
      setError("一覧の読み込みが完了してから選択してください"); return false;
    }
    const result = resolveExplorerPickerItems(workspace.draft.getEntries(), ids ?? selected, options);
    if (!result.ok) { setError(result.message); return false; }
    const operation = { controller: new AbortController(), view: viewKey,
      selections: new Set([selectedKey, JSON.stringify(result.items.map(item => item.id))]),
      ids: result.items.map(item => item.id), items: JSON.stringify(result.items) };
    request.current = operation;
    setError(null); setPending(true);
    try {
      await onConfirm(result.items, { signal: operation.controller.signal });
      if (!mounted.current || request.current !== operation || operation.controller.signal.aborted) return false;
      request.current = null; setPending(false);
      onAccepted?.();
      return true;
    } catch (caught) {
      if (mounted.current && request.current === operation && !operation.controller.signal.aborted)
        setError(caught instanceof Error ? caught.message : "選択を確定できませんでした");
      return false;
    } finally {
      if (mounted.current && request.current === operation) { request.current = null; setPending(false); }
    }
  }
  function selectCurrentFolder(): Promise<boolean> {
    if (kind === "file" || locationInfo.kind !== "folder" || query) return Promise.resolve(false);
    return confirm([locationInfo.id]);
  }
  function cancel() {
    if (!mounted.current) return;
    abort(); setError(null);
    try { onCancel?.(); } finally { onCancelled?.(); }
  }
  useLayoutEffect(() => bridge.register({ confirm, selectCurrentFolder, cancel }));
  const unavailable = pending || folderPending || searchPending || Boolean(folderError || searchError);
  return <div data-explorer-picker-footer className="lxe:shrink-0 lxe:border-t lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-panel)] lxe:p-3"
    onKeyDown={event => event.stopPropagation()}>
    {error && <p role="alert" className="lxe:mb-2 lxe:text-sm lxe:text-[var(--explorer-danger)]">{error}</p>}
    <div className="lxe:flex lxe:flex-wrap lxe:items-center lxe:gap-2">
      <p aria-live="polite" className="lxe:min-w-0 lxe:flex-1 lxe:truncate lxe:text-xs lxe:text-[var(--explorer-muted)]">
        {pending ? "選択を確定しています…" : selection.ok ? `${selection.items.length} 件選択：${selection.items.map(item => item.name).join("、")}`
          : kind === "folder" ? "フォルダを選択してください" : kind === "both" ? "ファイルまたはフォルダを選択してください" : "ファイルを選択してください"}
      </p>
      {kind !== "file" && <button type="button" className={buttonClass}
        disabled={unavailable || locationInfo.kind !== "folder" || Boolean(query)} onClick={() => { void selectCurrentFolder(); }}>現在のフォルダを選択</button>}
      {(onCancel || onCancelled) && <button type="button" className={buttonClass} onClick={cancel}>{cancelLabel ?? "キャンセル"}</button>}
      <button type="button" className={`${buttonClass} lxe:bg-[var(--explorer-accent)] lxe:text-[var(--explorer-accent-foreground)]`}
        disabled={unavailable || !selection.ok} onClick={() => { void confirm(); }}>{confirmLabel ?? "選択"}</button>
    </div>
    {footerMessage != null && typeof footerMessage !== "boolean" && footerMessage !== "" &&
      <div data-explorer-picker-message className="lxe:mt-2 lxe:min-w-0 lxe:whitespace-pre-wrap lxe:break-words lxe:text-xs lxe:leading-relaxed lxe:text-[var(--explorer-muted)]">
        {footerMessage}
      </div>}
  </div>;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value); else if (ref) ref.current = value;
}

/** Controlled modal. Each opening starts a fresh picker session. */
export function ExplorerPickerDialog({ open, onOpenChange, dialogTitle, dialogDescription, ref, ...props }: ExplorerPickerDialogProps) {
  const session = useRef<ExplorerPickerHandle | null>(null), restoreFocus = useRef<HTMLElement | null>(null);
  const attach = useCallback((value: ExplorerPickerHandle | null) => { session.current = value; assignRef(ref, value); }, [ref]);
  const colorScheme = useExplorerColorScheme(props.colorMode, props.theme, typeof document === "undefined" ? null : document);
  const theme = explorerThemeStyle(props.theme, colorScheme);
  const title = dialogTitle ?? (props.kind === "folder" ? "フォルダを選択" : props.kind === "both" ? "ファイル・フォルダを選択" : "ファイルを選択");
  return <Dialog.Root open={open} onOpenChange={next => {
    if (!next) {
      if (session.current) session.current.cancel();
      else { try { props.onCancel?.(); } finally { onOpenChange(false); } }
    }
  }}>
    {open && <Dialog.Portal>
      <Dialog.Overlay data-explorer-overlay style={theme} className="lxe:fixed lxe:inset-0 lxe:z-50 lxe:bg-black/40" />
      <Dialog.Content style={theme}
        className="lxe:fixed lxe:left-1/2 lxe:top-1/2 lxe:z-50 lxe:flex lxe:h-[min(760px,90dvh)] lxe:w-[min(1100px,96vw)] lxe:-translate-x-1/2 lxe:-translate-y-1/2 lxe:flex-col lxe:overflow-hidden lxe:rounded-lg lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:text-[var(--explorer-foreground)] lxe:shadow-xl lxe:outline-none"
        onOpenAutoFocus={() => { restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={event => { event.preventDefault(); restoreFocus.current?.focus(); }}>
        <div className="lxe:flex lxe:shrink-0 lxe:items-center lxe:gap-3 lxe:border-b lxe:border-[var(--explorer-border)] lxe:px-4 lxe:py-3">
          <div className="lxe:min-w-0 lxe:flex-1">
            <Dialog.Title className="lxe:text-base lxe:font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="lxe:mt-1 lxe:text-xs lxe:text-[var(--explorer-muted)]">{dialogDescription ?? "場所を開いて、項目を選択してください。"}</Dialog.Description>
          </div>
          <Dialog.Close asChild><button type="button" aria-label="選択ダイアログを閉じる" className={iconButtonClass}><X size={18} /></button></Dialog.Close>
        </div>
        <PickerSession {...props} ref={attach} onAccepted={() => onOpenChange(false)} onCancelled={() => onOpenChange(false)}
          style={{ ...props.style, flex: 1, minHeight: 0, border: 0, borderRadius: 0 }} />
      </Dialog.Content>
    </Dialog.Portal>}
  </Dialog.Root>;
}
