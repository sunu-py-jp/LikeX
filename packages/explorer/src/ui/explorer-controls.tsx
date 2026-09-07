"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Tooltip } from "radix-ui";
import { mergeExplorerClasses } from "./explorer-classnames";
import { useExplorerTheme } from "./explorer-theme";
import { useExplorerDom } from "./explorer-dom-context";
import type { ExplorerViewMode } from "../model/config";
import { shortcutAriaKeys, shortcutLabel, type ExplorerShortcut } from "../model/keyboard";

export const viewModes: readonly { id: ExplorerViewMode; label: string }[] = [
  { id: "extra-large", label: "特大アイコン" },
  { id: "large", label: "大アイコン" },
  { id: "medium", label: "中アイコン" },
  { id: "small", label: "小アイコン" },
  { id: "list", label: "一覧" },
  { id: "details", label: "詳細" },
  { id: "tiles", label: "並べて表示" },
  { id: "content", label: "コンテンツ" },
];

const focusClass =
  "lxe:focus-visible:outline-2 lxe:focus-visible:outline-offset-2 lxe:focus-visible:outline-[var(--explorer-accent)]";
export const buttonClass = `lxe:inline-flex lxe:min-h-8 lxe:shrink-0 lxe:cursor-pointer lxe:items-center lxe:justify-center lxe:gap-2 lxe:rounded lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:px-3 lxe:py-1.5 lxe:text-sm lxe:text-[var(--explorer-foreground)] lxe:hover:bg-[var(--explorer-hover)] lxe:disabled:cursor-not-allowed lxe:disabled:opacity-40 ${focusClass}`;
export const iconButtonClass = `lxe:inline-flex lxe:size-8 lxe:shrink-0 lxe:cursor-pointer lxe:items-center lxe:justify-center lxe:rounded lxe:text-[var(--explorer-foreground)] lxe:hover:bg-[var(--explorer-hover)] lxe:disabled:cursor-not-allowed lxe:disabled:opacity-40 lxe:[&>svg]:shrink-0 ${focusClass}`;
export const inputClass = `lxe:min-h-9 lxe:w-full lxe:rounded lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:px-3 lxe:py-2 lxe:text-sm lxe:text-[var(--explorer-foreground)] lxe:placeholder:text-[var(--explorer-muted)] lxe:disabled:opacity-40 ${focusClass}`;
export const menuContentClass =
  "lxe:z-50 lxe:max-h-[var(--radix-popper-available-height,70dvh)] lxe:min-w-48 lxe:overflow-y-auto lxe:rounded-lg lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:p-1 lxe:text-sm lxe:leading-normal lxe:text-[var(--explorer-foreground)] lxe:shadow-xl lxe:outline-none";
export const menuItemClass =
  "lxe:relative lxe:flex lxe:cursor-default lxe:select-none lxe:items-center lxe:gap-2 lxe:rounded lxe:px-2.5 lxe:py-2 lxe:outline-none lxe:data-[highlighted]:bg-[var(--explorer-hover)] lxe:data-[disabled]:pointer-events-none lxe:data-[disabled]:opacity-40 lxe:[&>svg]:size-4 lxe:[&>svg]:shrink-0";
export const menuSeparatorClass = "lxe:my-1 lxe:h-px lxe:bg-[var(--explorer-border)]";

export function ExplorerIconButton({
  label,
  children,
  onClick,
  disabled,
  shortcut,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  shortcut?: ExplorerShortcut;
  className?: string;
}) {
  const theme = useExplorerTheme();
  const { document: ownerDocument, portalContainer } = useExplorerDom();
  const foreign = !!ownerDocument && typeof document !== "undefined" && ownerDocument !== document;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!foreign || !open) return;
    const close = () => setOpen(false);
    ownerDocument.addEventListener("pointerdown", close, true);
    ownerDocument.defaultView?.addEventListener("blur", close);
    ownerDocument.defaultView?.addEventListener("scroll", close, true);
    return () => {
      ownerDocument.removeEventListener("pointerdown", close, true);
      ownerDocument.defaultView?.removeEventListener("blur", close);
      ownerDocument.defaultView?.removeEventListener("scroll", close, true);
    };
  }, [foreign, open, ownerDocument]);
  return (
    <Tooltip.Root open={foreign ? open : undefined} onOpenChange={foreign ? setOpen : undefined} disableHoverableContent={foreign}>
      <Tooltip.Trigger asChild onFocus={foreign ? () => setOpen(true) : undefined}>
        <button
          type="button"
          className={mergeExplorerClasses(iconButtonClass, className)}
          aria-label={label}
          aria-keyshortcuts={shortcut ? shortcutAriaKeys(shortcut) : undefined}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal container={portalContainer}>
        <Tooltip.Content
          data-likex-explorer=""
          sideOffset={6}
          style={theme}
          className="lxe:z-50 lxe:max-w-72 lxe:rounded lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:px-2.5 lxe:py-1.5 lxe:text-xs lxe:text-[var(--explorer-foreground)] lxe:shadow-lg"
        >
          {label}{shortcut && ` · ${shortcutLabel(shortcut)}`}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
