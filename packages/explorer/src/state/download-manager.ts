export type DownloadLease = Readonly<{
  requestId: string;
  entryId: string;
  windowId: string;
  signal: AbortSignal;
  /** Release this request once; an old lease never releases a newer attempt. */
  finish: () => boolean;
  isActive: () => boolean;
}>;

type DownloadRecord = {
  windowId: string;
  controller: AbortController;
};

/** One workspace coordinates downloads across its main and detached windows. */
export function createDownloadManager() {
  const active = new Map<string, DownloadRecord>();
  let cancelling = 0;

  function begin(entryId: string, windowId: string): DownloadLease | null {
    if (cancelling || active.has(entryId)) return null;
    const record: DownloadRecord = { windowId, controller: new AbortController() };
    const requestId = crypto.randomUUID();
    active.set(entryId, record);
    const isActive = () => active.get(entryId) === record;
    return {
      requestId,
      entryId,
      windowId,
      signal: record.controller.signal,
      isActive,
      finish() {
        if (!isActive()) return false;
        active.delete(entryId);
        return true;
      },
    };
  }

  function cancel(matches: (record: DownloadRecord) => boolean, reason: string) {
    cancelling++;
    try {
      const cancelled: DownloadRecord[] = [];
      // Remove every matching lease before firing synchronous abort listeners.
      // Host work may never settle; its late completion must not retain the lock.
      for (const [entryId, record] of active) {
        if (!matches(record)) continue;
        active.delete(entryId);
        cancelled.push(record);
      }
      // Cancellation observers cannot synchronously reopen a request that the
      // current close/disable operation is in the middle of removing.
      for (const record of cancelled) record.controller.abort(reason);
    } finally {
      cancelling--;
    }
  }

  return {
    begin,
    cancelWindow(windowId: string, reason = "window-closed") {
      cancel(record => record.windowId === windowId, reason);
    },
    cancelAll(reason = "cancelled") {
      cancel(() => true, reason);
    },
  };
}

export type DownloadManager = ReturnType<typeof createDownloadManager>;
