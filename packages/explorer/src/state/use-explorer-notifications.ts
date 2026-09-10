"use client";

import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createExplorerNotificationStore } from "../model/notifications";

/** Share host notifications across panes without coupling them to file edits. */
export function useExplorerNotifications() {
  const [store] = useState(createExplorerNotificationStore);
  const messages = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useLayoutEffect(() => {
    store.activate();
    return store.dispose;
  }, [store]);
  return useMemo(() => ({ messages, notify: store.notify, dismiss: store.dismiss, clear: store.clear, getRevision: store.getRevision }), [messages, store]);
}
