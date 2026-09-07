"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import { mergeExplorerClasses } from "./explorer-classnames";
import type { ExplorerEntry } from "../model/draft";
import { useExplorerFields, useExplorerSelector } from "../state/explorer-context";
import { inputClass } from "./explorer-controls";
import { useExplorerDom } from "./explorer-dom-context";
import { isComposingKeyEvent } from "../model/keyboard";

type RenameControl = HTMLInputElement | HTMLTextAreaElement;

function selectRenameInput(input: RenameControl) {
  input.focus();
  input.setSelectionRange(0, Number(input.dataset.renameSelectionEnd));
}

function resizeTextarea(textarea: HTMLTextAreaElement) {
  const style = textarea.ownerDocument.defaultView?.getComputedStyle(textarea);
  if (!style) return;
  const border =
    (Number.parseFloat(style.borderTopWidth) || 0) +
    (Number.parseFloat(style.borderBottomWidth) || 0);
  // Reset before reading scrollHeight so shortening a name also shrinks it.
  textarea.style.height = "0px";
  textarea.style.height = `${Math.ceil(textarea.scrollHeight + border)}px`;
}

/** Keep a menu's closing focus restoration from taking focus out of the editor. */
export function useRenameMenuFocus() {
  const { startRename: beginRename, workspaceRef } = useExplorerFields("startRename", "workspaceRef");
  const requested = useRef(false);
  function startRename(ids?: string[]) {
    requested.current = true;
    beginRename(ids);
  }
  function onCloseAutoFocus(event: Event) {
    if (!requested.current) return;
    requested.current = false;
    event.preventDefault();
    const input = workspaceRef.current?.querySelector<RenameControl>(
      "input[data-explorer-rename-input],textarea[data-explorer-rename-input]",
    );
    if (input) selectRenameInput(input);
  }
  return { startRename, onCloseAutoFocus };
}

/** A second single click renames; a double click still opens the entry. */
export function useEntryRenameDelay() {
  const { document: ownerDocument } = useExplorerDom();
  const {
    selected,
    features,
    busy,
    renamingEntryId,
    startRename,
    location,
    activeTabId,
    view,
    query,
    modal,
    preview,
    previewTrigger,
    details,
  } = useExplorerFields("selected", "features", "busy", "renamingEntryId", "startRename", "location", "activeTabId", "view", "query", "modal", "preview", "previewTrigger", "details");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingRename = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const selectionKey = useMemo(() => JSON.stringify(selected), [selected]);
  useEffect(() => {
    // Interacting with toolbars, another Explorer, or the host cancels the
    // pending click. A normal row click can schedule a fresh timer afterward.
    ownerDocument?.addEventListener("pointerdown", cancelPendingRename, true);
    return () =>
      ownerDocument?.removeEventListener("pointerdown", cancelPendingRename, true);
  }, [cancelPendingRename, ownerDocument]);
  useEffect(() => {
    cancelPendingRename();
    return cancelPendingRename;
  }, [
    selectionKey,
    location,
    activeTabId,
    view,
    query,
    modal,
    preview,
    previewTrigger,
    details,
    renamingEntryId,
    features.rename,
    busy,
    cancelPendingRename,
  ]);

  function scheduleRename(
    entry: ExplorerEntry,
    event: MouseEvent<HTMLElement>,
  ) {
    cancelPendingRename();
    if (
      !features.rename ||
      busy ||
      renamingEntryId ||
      modal ||
      preview ||
      details ||
      event.button !== 0 ||
      event.detail !== 1 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      selected.length !== 1 ||
      selected[0] !== entry.id ||
      (event.target as Element).closest(
        "button,input,select,textarea,[role='checkbox'],[data-explorer-rename-editor]",
      )
    )
      return;
    timer.current = setTimeout(() => {
      timer.current = null;
      startRename([entry.id]);
    }, 400);
  }
  return { scheduleRename, cancelPendingRename };
}

const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();
const stopDrag = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

export const ExplorerEntryName = memo(function ExplorerEntryName({
  entry,
  className,
  editorClassName,
  multiline = false,
}: {
  entry: ExplorerEntry;
  className?: string;
  editorClassName?: string;
  multiline?: boolean;
}) {
  const { document: ownerDocument } = useExplorerDom();
  const {
    renamingEntryId,
    renameValue,
    renameExtension,
    renameError,
    setRenameValue,
    commitRename,
    cancelRename,
    entryId,
    previewTrigger,
    features,
    busy,
  } = useExplorerSelector(value => ({
    renamingEntryId: value.renamingEntryId === entry.id ? entry.id : null,
    renameValue: value.renamingEntryId === entry.id ? value.renameValue : "",
    renameExtension: value.renamingEntryId === entry.id ? value.renameExtension : "",
    renameError: value.renamingEntryId === entry.id ? value.renameError : "",
    setRenameValue: value.setRenameValue, commitRename: value.commitRename,
    cancelRename: value.cancelRename, entryId: value.entryId,
    previewTrigger: value.previewTrigger, features: value.features,
    busy: value.busy,
  }));
  const editing = renamingEntryId === entry.id;
  const inputRef = useRef<RenameControl>(null);
  const setInputRef = useCallback((control: RenameControl | null) => {
    inputRef.current = control;
  }, []);
  const editorMounted = useRef(false);
  const finished = useRef(false);
  const committing = useRef(false);
  const composing = useRef(false);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorId = `${entryId(entry.id)}-rename-error`;
  const extensionId = `${entryId(entry.id)}-rename-extension`;

  useLayoutEffect(() => {
    const control = inputRef.current;
    if (editing && multiline && control?.tagName === "TEXTAREA")
      resizeTextarea(control as HTMLTextAreaElement);
  }, [editing, multiline, renameValue]);

  useEffect(() => {
    const control = inputRef.current;
    const ResizeObserverClass = control?.ownerDocument.defaultView?.ResizeObserver;
    if (
      !editing ||
      !multiline ||
      control?.tagName !== "TEXTAREA" ||
      !ResizeObserverClass
    )
      return;
    const textarea = control as HTMLTextAreaElement;
    let width = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserverClass(() => {
      const nextWidth = textarea.getBoundingClientRect().width;
      // Height changes caused by autosizing must not retrigger the resize loop.
      if (nextWidth !== width) {
        width = nextWidth;
        resizeTextarea(textarea);
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [editing, multiline]);

  useEffect(() => {
    if (!editing) return;
    editorMounted.current = true;
    finished.current = false;
    committing.current = false;
    composing.current = false;
    const input = inputRef.current;
    if (input) {
      selectRenameInput(input);
      // The menu may still be disposing its focus scope in this render.
      focusTimer.current = setTimeout(() => {
        if (!finished.current && inputRef.current === input)
          selectRenameInput(input);
        focusTimer.current = null;
      }, 0);
    }
    return () => {
      editorMounted.current = false;
      finished.current = true;
      if (focusTimer.current !== null) clearTimeout(focusTimer.current);
      focusTimer.current = null;
      // StrictMode reconnects the input during its effect replay. Only an
      // editor that is still absent after that replay cancels the session.
      queueMicrotask(() => {
        if (!editorMounted.current) cancelRename(entry.id);
      });
    };
  }, [editing, entry.id, multiline, cancelRename]);

  if (!editing) {
    return (
      <span
        data-explorer-entry-name={entry.id}
        className={mergeExplorerClasses(
          className,
          entry.kind === "file" &&
            features.preview &&
            previewTrigger === "click" &&
            "lxe:cursor-pointer",
        )}
        title={entry.name}
      >
        {entry.name}
      </span>
    );
  }

  function refocusAfterError() {
    const input = inputRef.current;
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      if (!finished.current && input && inputRef.current === input)
        input.focus();
      focusTimer.current = null;
    }, 0);
  }

  function commit(focusAfter = false) {
    if (finished.current || committing.current) return;
    const control = inputRef.current;
    committing.current = true;
    const result = commitRename(entry.id);
    const settle = (success: boolean) => {
      if (success && focusAfter && (ownerDocument?.activeElement === control || ownerDocument?.activeElement === ownerDocument?.body))
        focusRow();
      if (inputRef.current !== control || !editorMounted.current) return;
      committing.current = false;
      if (success) finished.current = true;
      else refocusAfterError();
    };
    if (typeof result === "boolean") settle(result);
    else void result.then(settle);
  }

  function focusRow() {
    ownerDocument?.getElementById(entryId(entry.id))?.focus();
  }

  const controlProps = {
    ref: setInputRef,
    "data-explorer-rename-input": entry.id,
    "data-rename-selection-end": renameValue.length,
    "aria-label": `${entry.name}の名前を変更`,
    "aria-invalid": Boolean(renameError),
    "aria-describedby": [renameExtension && extensionId, renameError && errorId].filter(Boolean).join(" ") || undefined,
    value: renameValue,
    readOnly: busy,
    onChange: (event: ChangeEvent<RenameControl>) =>
      setRenameValue(event.target.value),
    className: mergeExplorerClasses(
      inputClass,
      "lxe:h-7 lxe:min-h-7 lxe:min-w-0 lxe:flex-1 lxe:px-1.5 lxe:py-0 lxe:text-sm lxe:font-normal",
      multiline &&
        "lxe:box-border lxe:h-auto lxe:w-full lxe:flex-none lxe:resize-none lxe:overflow-hidden lxe:py-0.5 lxe:leading-5 lxe:whitespace-pre-wrap lxe:wrap-anywhere",
    ),
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
    },
    onKeyDown: (event: KeyboardEvent<RenameControl>) => {
      event.stopPropagation();
      if (event.defaultPrevented || composing.current || isComposingKeyEvent(event))
        return;
      if (event.key === "Enter") {
        event.preventDefault();
        commit(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finished.current = true;
        cancelRename(entry.id);
        focusRow();
      }
    },
    onBlur: () => commit(),
  };

  const editorContents = (
    <>
      <div className={mergeExplorerClasses("lxe:flex lxe:min-w-0 lxe:items-end lxe:gap-1", multiline && "lxe:flex-col lxe:items-stretch lxe:gap-0")}>
        {multiline ? (
          <textarea {...controlProps} rows={1} wrap="soft" />
        ) : (
          <input {...controlProps} />
        )}
        {renameExtension && (
          <span
            id={extensionId}
            data-explorer-rename-extension={entry.id}
            className={mergeExplorerClasses(
              "lxe:max-w-[40%] lxe:shrink-0 lxe:py-1 lxe:text-sm lxe:leading-5 lxe:text-[var(--explorer-muted)]",
              multiline ? "lxe:self-end lxe:wrap-anywhere" : "lxe:truncate",
            )}
            title={`拡張子 ${renameExtension}（変更できません）`}
          >
            <span className="lxe:sr-only">拡張子（変更不可）: </span>
            {renameExtension}
          </span>
        )}
      </div>
      {renameError && (
        <p
          id={errorId}
          role="alert"
          className="lxe:mt-1 lxe:text-xs lxe:leading-relaxed lxe:wrap-anywhere lxe:text-[var(--explorer-danger)]"
        >
          {renameError}
        </p>
      )}
    </>
  );

  return (
    <div
      data-explorer-rename-editor
      className={mergeExplorerClasses(
        "lxe:min-w-0 lxe:w-full lxe:text-left",
        multiline && "lxe:relative",
        editorClassName,
      )}
      onPointerDown={stopPropagation}
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
      onContextMenu={stopPropagation}
      onKeyUp={stopPropagation}
      onDragStart={stopDrag}
      onDragOver={stopDrag}
      onDrop={stopDrag}
    >
      {multiline ? (
        <>
          <span aria-hidden="true" className={mergeExplorerClasses(className, "lxe:invisible")}>
            {entry.name}
          </span>
          <div className="lxe:absolute lxe:inset-x-0 lxe:top-0 lxe:rounded-sm lxe:bg-[var(--explorer-background)]">
            {editorContents}
          </div>
        </>
      ) : (
        editorContents
      )}
    </div>
  );
});
