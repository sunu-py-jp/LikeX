export type ExplorerNotificationKind = "success" | "error" | "info" | "progress";

/** One file or result in a notification. All fields are plain text. */
export type ExplorerNotificationDetail = Readonly<{
  message: string;
  kind?: ExplorerNotificationKind;
  description?: string;
}>;

/** A host-owned message displayed in the Explorer's notification area. */
export type ExplorerNotification = Readonly<{
  /** Reuse an ID to update an existing message without adding another card. */
  id?: string;
  message: string;
  description?: string;
  details?: readonly ExplorerNotificationDetail[];
  /** Shared help text, shown by the notification's help icon. */
  hint?: string;
  /** Keep the message until dismissed or replaced. Progress always remains visible. Otherwise defaults to five seconds. */
  persistent?: boolean;
} & ({
  kind: "progress";
  /** Percentage, clamped to 0–100. Omitted or non-finite values show indeterminate progress. */
  progress?: number;
} | {
  kind: Exclude<ExplorerNotificationKind, "progress">;
  progress?: never;
})>;

export type ExplorerHandle = Readonly<{
  /** Add or replace a message and return its ID. This is a full replacement, not a patch. Text is never interpreted as HTML. */
  notify: (notification: ExplorerNotification) => string;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
}>;

export type ExplorerNotificationRecord = ExplorerNotification & Readonly<{ id: string }>;

const maximumNotifications = 50;
const notificationDuration = 5000;
const emptyMessages: readonly ExplorerNotificationRecord[] = Object.freeze([]);

/** One instance belongs to a workspace, including all of its detached panes. */
export function createExplorerNotificationStore() {
  let active = false;
  let revision = 0;
  let messages = emptyMessages;
  const listeners = new Set<() => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function cancelTimer(id: string) {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  }

  function publish(next: readonly ExplorerNotificationRecord[]) {
    messages = Object.freeze(next);
    for (const listener of listeners) listener();
  }

  function dismiss(id: string) {
    if (!active || !messages.some(message => message.id === id)) return;
    cancelTimer(id);
    publish(messages.filter(message => message.id !== id));
  }

  function notify(notification: ExplorerNotification) {
    const id = notification.id ?? crypto.randomUUID();
    // A host may retain the handle across an asynchronous operation and unmount.
    // Late completion must not retain data, restart timers, or update React.
    if (!active) return id;
    revision++;
    const record: ExplorerNotificationRecord = Object.freeze({
      id,
      message: notification.message,
      description: notification.description,
      hint: notification.hint,
      persistent: notification.persistent,
      details: notification.details && Object.freeze(notification.details.map(detail => Object.freeze({
        message: detail.message,
        kind: detail.kind,
        description: detail.description,
      }))),
      ...(notification.kind === "progress" ? {
        kind: "progress",
        progress: typeof notification.progress === "number" && Number.isFinite(notification.progress)
          ? Math.max(0, Math.min(100, notification.progress)) : undefined,
      } : { kind: notification.kind }),
    });
    cancelTimer(id);
    const index = messages.findIndex(message => message.id === id);
    const next = [...messages];
    if (index >= 0) next[index] = record;
    else next.push(record);
    while (next.length > maximumNotifications) cancelTimer(next.shift()!.id);
    if (record.kind !== "progress" && !record.persistent) {
      timers.set(id, setTimeout(() => {
        if (messages.find(message => message.id === id) === record) dismiss(id);
      }, notificationDuration));
    }
    publish(next);
    return id;
  }

  function clear() {
    if (!active || !messages.length) return;
    for (const id of timers.keys()) cancelTimer(id);
    publish(emptyMessages);
  }

  return {
    notify,
    dismiss,
    clear,
    getSnapshot: () => messages,
    getRevision: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    activate() { active = true; },
    dispose() {
      active = false;
      for (const id of timers.keys()) cancelTimer(id);
      messages = emptyMessages;
    },
  };
}
