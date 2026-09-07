"use client";

import { memo, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, HardDrive } from "lucide-react";
import { mergeExplorerClasses } from "./explorer-classnames";
import { useExplorerFields } from "../state/explorer-context";
import { buttonClass } from "./explorer-controls";
import { isComposingKeyEvent } from "../model/keyboard";

export const ExplorerAddressBar = memo(function ExplorerAddressBar() {
  const { activeTabId, location, addressPath, features } = useExplorerFields("activeTabId", "location", "addressPath", "features");
  return (
    <AddressBarSession
      key={JSON.stringify([
        activeTabId,
        typeof location,
        String(location),
        addressPath,
        features.pathInput,
      ])}
    />
  );
});

const AddressBarSession = memo(function AddressBarSession() {
  const {
    rootLabel,
    addressPath,
    addressInput,
    navigatePath,
    navigate,
    crumbs,
    special,
    title,
    allowDrop,
    drop,
    instanceId,
    workspaceRef,
    features,
  } = useExplorerFields(
    "rootLabel", "addressPath", "addressInput", "navigatePath", "navigate", "crumbs", "special",
    "title", "allowDrop", "drop", "instanceId", "workspaceRef", "features",
  );
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(addressPath);
  const [error, setError] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const errorId = `${instanceId}-address-error`;

  useLayoutEffect(() => {
    if (editing) {
      addressInput.current?.focus();
      addressInput.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing, addressInput]);

  function beginEditing() {
    if (!features.pathInput) return;
    setValue(addressPath);
    setError("");
    setEditing(true);
  }

  return (
    <div className="lxe:min-w-0 lxe:flex-1">
      {editing && features.pathInput ? (
        <input
          ref={addressInput}
          type="text"
          aria-label="フォルダのパス"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          className={`lxe:h-8 lxe:w-full lxe:min-w-0 lxe:rounded lxe:border lxe:bg-[var(--explorer-background)] lxe:px-2 lxe:text-[13px] lxe:text-[var(--explorer-foreground)] lxe:outline-none lxe:focus:border-[var(--explorer-accent)] ${error ? "lxe:border-[var(--explorer-danger)]" : "lxe:border-[var(--explorer-border)]"}`}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.defaultPrevented || isComposingKeyEvent(event)) return;
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              try {
                navigatePath(value);
                setError("");
                setEditing(false);
                workspaceRef.current?.focus();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "フォルダへ移動できませんでした",
                );
              }
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              restoreFocus.current = true;
              setError("");
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (!error) setEditing(false);
          }}
        />
      ) : (
        <nav
          className="lxe:flex lxe:h-8 lxe:min-w-0 lxe:items-center lxe:rounded lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:px-1.5 lxe:text-[13px] lxe:whitespace-nowrap"
          aria-label="現在のフォルダ"
          onClick={
            features.pathInput
              ? (event) => {
                  if (!(event.target as HTMLElement).closest("button"))
                    beginEditing();
                }
              : undefined
          }
        >
          <div className="lxe:flex lxe:min-w-0 lxe:items-center lxe:gap-1 lxe:overflow-x-auto lxe:[scrollbar-width:none]">
            <button
              type="button"
              className={mergeExplorerClasses(
                buttonClass,
                "lxe:h-6 lxe:min-h-6 lxe:shrink-0 lxe:border-0 lxe:bg-transparent lxe:px-1.5 lxe:py-0 lxe:text-[13px] lxe:font-normal",
              )}
              onClick={() => navigate("root")}
              onDragOver={(event) => allowDrop(event, "root")}
              onDrop={(event) => void drop(event, "root")}
            >
              <HardDrive size={15} />
              <span>{rootLabel}</span>
            </button>
            {crumbs.map((entry) => (
              <span className="lxe:flex lxe:shrink-0 lxe:items-center lxe:gap-1" key={entry.id}>
                <ChevronRight
                  size={13}
                  className="lxe:text-[var(--explorer-muted)]"
                />
                <button
                  type="button"
                  className={mergeExplorerClasses(
                    buttonClass,
                    "lxe:h-6 lxe:min-h-6 lxe:border-0 lxe:bg-transparent lxe:px-1.5 lxe:py-0 lxe:text-[13px] lxe:font-normal",
                  )}
                  onClick={() => navigate(entry.id)}
                  onDragOver={(event) => allowDrop(event, entry.id)}
                  onDrop={(event) => void drop(event, entry.id)}
                >
                  {entry.name}
                </button>
              </span>
            ))}
            {special && (
              <span className="lxe:flex lxe:shrink-0 lxe:items-center lxe:gap-1">
                <ChevronRight
                  size={13}
                  className="lxe:text-[var(--explorer-muted)]"
                />
                {title}
              </span>
            )}
          </div>
          {features.pathInput && (
            <button
              ref={editButton}
              type="button"
              aria-label="パスを入力"
              title="パスを入力"
              className="lxe:h-full lxe:min-w-8 lxe:flex-1 lxe:cursor-text lxe:rounded lxe:outline-offset-[-2px] lxe:focus-visible:outline-2 lxe:focus-visible:outline-[var(--explorer-accent)]"
              onClick={beginEditing}
            />
          )}
        </nav>
      )}
      {features.pathInput && error && (
        <p
          id={errorId}
          role="alert"
          className="lxe:mt-1 lxe:text-xs lxe:leading-relaxed lxe:break-words lxe:text-[var(--explorer-danger)]"
        >
          {error}
        </p>
      )}
    </div>
  );
});
