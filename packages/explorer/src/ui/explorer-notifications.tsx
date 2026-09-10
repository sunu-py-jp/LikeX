"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, CircleHelp, Info, LoaderCircle, X } from "lucide-react";
import { Tooltip } from "radix-ui";
import type { ExplorerNotification, ExplorerNotificationRecord } from "../model/notifications";
import { iconButtonClass } from "./explorer-controls";
import { useExplorerDom } from "./explorer-dom-context";
import { useExplorerTheme } from "./explorer-theme";

const kindLabels = { progress: "処理中", success: "完了", error: "エラー", info: "お知らせ" } as const;

/** One scrollable surface for pane notices and host-reported results. */
export function ExplorerNotifications({
  notification,
  onDismissNotification,
  messages,
  onDismissMessage,
  onClearMessages,
}: {
  notification: ExplorerNotification | null;
  onDismissNotification: () => void;
  messages: readonly ExplorerNotificationRecord[];
  onDismissMessage: (id: string) => void;
  onClearMessages: () => void;
}) {
  const count = messages.length + (notification ? 1 : 0);
  const latest = messages.at(-1);
  // Detailed file lists remain available to assistive technology without being
  // announced again in their entirety every time a result is added.
  const announcement = [
    notification && `${kindLabels[notification.kind]}: ${notification.message}`,
    latest && `${messages.length > 1 ? `${messages.length}件の通知。最新: ` : ""}${kindLabels[latest.kind]}: ${latest.message}`,
  ].filter(Boolean).join("。 ");

  return <>
    <p role="status" aria-live="polite" aria-atomic="true" className="lxe:sr-only">{announcement}</p>
    {count > 0 && <section
      aria-label="通知"
      className="lxe:absolute lxe:right-3 lxe:bottom-12 lxe:z-30 lxe:flex lxe:max-h-[min(20rem,calc(100%-4.5rem),50dvh)] lxe:w-90 lxe:max-w-[calc(100%-1.5rem)] lxe:flex-col lxe:overflow-hidden lxe:rounded-lg lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:text-[var(--explorer-foreground)] lxe:shadow-lg"
    >
      {count > 1 && <div className="lxe:flex lxe:shrink-0 lxe:items-center lxe:justify-between lxe:gap-2 lxe:border-b lxe:border-[var(--explorer-border)] lxe:px-3 lxe:py-1.5">
        <p className="lxe:text-xs lxe:text-[var(--explorer-muted)]">通知 {count}件</p>
        <button
          type="button"
          className="lxe:cursor-pointer lxe:rounded lxe:px-1.5 lxe:py-1 lxe:text-xs lxe:text-[var(--explorer-muted)] lxe:hover:bg-[var(--explorer-hover)] lxe:hover:text-[var(--explorer-foreground)] lxe:focus-visible:outline-2 lxe:focus-visible:outline-[var(--explorer-accent)]"
          onClick={() => { onDismissNotification(); onClearMessages(); }}
        >すべて閉じる</button>
      </div>}
      <div
        tabIndex={0}
        aria-label="通知の内容"
        className="lxe:min-h-0 lxe:overflow-x-hidden lxe:overflow-y-auto lxe:overscroll-contain lxe:outline-none lxe:focus-visible:outline-2 lxe:focus-visible:-outline-offset-2 lxe:focus-visible:outline-[var(--explorer-accent)]"
      >
        {notification && <NotificationMessage notification={notification} onDismiss={onDismissNotification} />}
        {messages.map(message => <NotificationMessage key={message.id} notification={message} onDismiss={() => onDismissMessage(message.id)} />)}
      </div>
    </section>}
  </>;
}

function NotificationMessage({ notification, onDismiss }: {
  notification: ExplorerNotification;
  onDismiss: () => void;
}) {
  const progress = notification.kind === "progress" && Number.isFinite(notification.progress)
    ? Math.max(0, Math.min(100, notification.progress!)) : undefined;
  const hasDetails = !!notification.details?.length;
  const hasBody = notification.description || hasDetails || progress !== undefined;
  return <article className="lxe:border-b lxe:border-[var(--explorer-border)] lxe:last:border-b-0">
    <header className="lxe:sticky lxe:top-0 lxe:z-10 lxe:flex lxe:items-start lxe:gap-2 lxe:bg-[var(--explorer-background)] lxe:px-3 lxe:py-2.5">
      <NotificationIcon kind={notification.kind} />
      <div className="lxe:min-w-0 lxe:flex-1 lxe:pt-0.5 lxe:text-sm lxe:wrap-anywhere">
        <p>{notification.message}</p>
      </div>
      {notification.hint && <NotificationHint hint={notification.hint} />}
      <button type="button" className={`${iconButtonClass} lxe:size-6`} aria-label="通知を閉じる" onClick={onDismiss}>
        <X size={14} aria-hidden="true" />
      </button>
    </header>
    {hasBody && <div className="lxe:px-3 lxe:pb-2.5 lxe:pl-9 lxe:wrap-anywhere">
      {notification.description && <p className="lxe:text-xs lxe:whitespace-pre-line lxe:text-[var(--explorer-muted)]">{notification.description}</p>}
      {notification.kind === "progress" && progress !== undefined && <div className="lxe:flex lxe:items-center lxe:gap-2 lxe:not-first:mt-1.5">
        <div
          role="progressbar"
          aria-label={notification.message}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="lxe:h-1 lxe:min-w-0 lxe:flex-1 lxe:overflow-hidden lxe:rounded-full lxe:bg-[var(--explorer-hover)]"
        ><div style={{ width: `${progress}%` }} className="lxe:h-full lxe:rounded-full lxe:bg-[var(--explorer-accent)]" /></div>
        <span className="lxe:shrink-0 lxe:text-xs lxe:text-[var(--explorer-muted)] lxe:tabular-nums">{Math.round(progress)}%</span>
      </div>}
      {hasDetails && <ul className="lxe:space-y-2 lxe:not-first:mt-2">
        {notification.details!.map((detail, index) => <li key={index} className="lxe:flex lxe:min-w-0 lxe:items-start lxe:gap-1.5">
          {detail.kind && <NotificationIcon kind={detail.kind} small />}
          <div className="lxe:min-w-0 lxe:flex-1 lxe:text-xs lxe:wrap-anywhere">
            <p>{detail.message}</p>
            {detail.description && <p className="lxe:mt-0.5 lxe:whitespace-pre-line lxe:text-[var(--explorer-muted)]">{detail.description}</p>}
          </div>
        </li>)}
      </ul>}
    </div>}
  </article>;
}

function NotificationIcon({ kind, small = false }: { kind: ExplorerNotification["kind"]; small?: boolean }) {
  const Icon = kind === "error" ? CircleAlert : kind === "success" ? Check : kind === "progress" ? LoaderCircle : Info;
  const color = kind === "error" ? "lxe:text-[var(--explorer-danger)]"
    : kind === "success" ? "lxe:text-emerald-600" : "lxe:text-[var(--explorer-accent)]";
  return <Icon size={small ? 14 : 16} role="img" aria-label={kindLabels[kind]} className={`lxe:mt-1 lxe:shrink-0 ${color} ${kind === "progress" ? "lxe:animate-spin lxe:motion-reduce:animate-none" : ""}`} />;
}

/** Hover and focus work like other Explorer hints; clicking keeps it open. */
function NotificationHint({ hint }: { hint: string }) {
  const theme = useExplorerTheme();
  const { document: ownerDocument, portalContainer } = useExplorerDom();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const foreign = !!ownerDocument && typeof document !== "undefined" && ownerDocument !== document;
  useEffect(() => {
    if (!open || !ownerDocument) return;
    const close = () => { pinned.current = false; setOpen(false); };
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || trigger.current?.contains(target) || content.current?.contains(target)) return;
      close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    ownerDocument.addEventListener("pointerdown", outside, true);
    ownerDocument.addEventListener("keydown", escape);
    ownerDocument.defaultView?.addEventListener("blur", close);
    return () => {
      ownerDocument.removeEventListener("pointerdown", outside, true);
      ownerDocument.removeEventListener("keydown", escape);
      ownerDocument.defaultView?.removeEventListener("blur", close);
    };
  }, [open, ownerDocument]);
  return <Tooltip.Root open={open} onOpenChange={next => { if (!pinned.current) setOpen(next); }} disableHoverableContent={foreign}>
    <Tooltip.Trigger asChild onFocus={foreign ? () => setOpen(true) : undefined}>
      <button
        ref={trigger}
        type="button"
        aria-label="通知の補足情報"
        className={`${iconButtonClass} lxe:size-6 lxe:text-[var(--explorer-muted)]`}
        onClick={() => { pinned.current = !pinned.current; setOpen(pinned.current); }}
      ><CircleHelp size={15} aria-hidden="true" /></button>
    </Tooltip.Trigger>
    <Tooltip.Portal container={portalContainer}>
      <Tooltip.Content
        ref={content}
        data-likex-explorer=""
        side="top"
        sideOffset={6}
        collisionPadding={12}
        style={theme}
        className="lxe:z-50 lxe:max-h-[min(12rem,var(--radix-popper-available-height))] lxe:max-w-[min(20rem,calc(100vw-1.5rem))] lxe:overflow-y-auto lxe:rounded lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:px-2.5 lxe:py-2 lxe:text-xs lxe:whitespace-pre-line lxe:text-[var(--explorer-foreground)] lxe:shadow-lg lxe:wrap-anywhere"
      >{hint}</Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>;
}
