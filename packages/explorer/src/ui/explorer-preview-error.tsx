"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Tooltip } from "radix-ui";
import { mergeExplorerClasses } from "./explorer-classnames";
import { iconButtonClass } from "./explorer-controls";
import { useExplorerDom } from "./explorer-dom-context";
import { useExplorerTheme } from "./explorer-theme";

export type ExplorerPreviewErrorProps = {
  /** The caught exception. Only Error.message or a string is displayed. */
  error: unknown;
  /** A short explanation displayed before the details button. */
  message?: string;
  className?: string;
};

function errorDetail(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : error;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // Even a thrown object with an inaccessible message must have a safe fallback.
  }
  return "エラーの詳細を取得できませんでした。";
}

/** A host preview can pass its caught exception without depending on Explorer state. */
export function ExplorerPreviewError({ error, message = "プレビューを表示できませんでした。", className = "" }: ExplorerPreviewErrorProps) {
  const theme = useExplorerTheme();
  const environment = useExplorerDom();
  const detail = errorDetail(error);
  return <div
    role="alert"
    data-likex-explorer=""
    style={theme}
    className={`lxe:flex lxe:items-start lxe:justify-center lxe:gap-1.5 lxe:p-4 lxe:text-sm lxe:text-[var(--explorer-muted)] ${className}`}
  >
    <p className="lxe:min-w-0 lxe:pt-0.5 lxe:whitespace-pre-wrap lxe:wrap-anywhere">{message}</p>
    <Tooltip.Provider delayDuration={300}>
      <PreviewErrorDetails key={detail} detail={detail} environment={environment} />
    </Tooltip.Provider>
  </div>;
}

/** Match notification hints: hover/focus opens, and clicking pins the details. */
function PreviewErrorDetails({ detail, environment }: {
  detail: string;
  environment: ReturnType<typeof useExplorerDom>;
}) {
  const theme = useExplorerTheme();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  // Also support a standalone component rendered into another document.
  const ownerDocument = trigger?.ownerDocument ?? environment.document;
  const portalContainer = environment.portalContainer?.ownerDocument === ownerDocument
    ? environment.portalContainer : ownerDocument?.body;
  const foreign = !!ownerDocument && typeof document !== "undefined" && ownerDocument !== document;
  const close = () => { pinned.current = false; setOpen(false); };
  useEffect(() => {
    if (!open || !ownerDocument) return;
    const close = () => { pinned.current = false; setOpen(false); };
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || trigger?.contains(target) || content.current?.contains(target)) return;
      close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    // Window capture runs before both Radix and detached-dialog document handlers,
    // so the first Escape dismisses only the details, leaving the preview open.
    const escapeTarget = ownerDocument.defaultView ?? ownerDocument;
    escapeTarget.addEventListener("keydown", escape as EventListener, { capture: true });
    ownerDocument.addEventListener("pointerdown", outside, { capture: true });
    ownerDocument.defaultView?.addEventListener("blur", close);
    return () => {
      escapeTarget.removeEventListener("keydown", escape as EventListener, { capture: true });
      ownerDocument.removeEventListener("pointerdown", outside, { capture: true });
      ownerDocument.defaultView?.removeEventListener("blur", close);
    };
  }, [open, ownerDocument, trigger]);
  return <Tooltip.Root open={open} onOpenChange={next => { if (!pinned.current) setOpen(next); }} disableHoverableContent={foreign}>
    <Tooltip.Trigger asChild onFocus={foreign ? () => setOpen(true) : undefined}>
      <button
        ref={setTrigger}
        type="button"
        aria-label="エラーの詳細"
        aria-expanded={open}
        className={mergeExplorerClasses(iconButtonClass, "lxe:size-6 lxe:shrink-0 lxe:text-[var(--explorer-danger)]")}
        onClick={() => { pinned.current = !pinned.current; setOpen(pinned.current); }}
      ><CircleAlert size={16} aria-hidden="true" /></button>
    </Tooltip.Trigger>
    <Tooltip.Portal container={portalContainer}>
      <Tooltip.Content
        ref={content}
        tabIndex={0}
        data-likex-explorer=""
        side="top"
        sideOffset={6}
        collisionPadding={12}
        onEscapeKeyDown={event => {
          event.preventDefault();
          if (event.isComposing || event.keyCode === 229) return;
          event.stopPropagation();
          close();
        }}
        style={theme}
        className="lxe:z-50 lxe:max-h-[min(16rem,var(--radix-popper-available-height))] lxe:max-w-[min(32rem,calc(100vw-1.5rem))] lxe:overflow-y-auto lxe:overscroll-contain lxe:rounded lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:px-3 lxe:py-2 lxe:text-xs lxe:whitespace-pre-wrap lxe:text-[var(--explorer-foreground)] lxe:shadow-lg lxe:select-text lxe:wrap-anywhere"
      >{detail}</Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>;
}
