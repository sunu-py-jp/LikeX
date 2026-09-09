export type UnsavedChangesGuardOptions = Readonly<{
  /** Used by explicit confirmClose calls; native beforeunload text is browser-owned. */
  closeMessage?: string;
}>;

/** No browser globals are read until a host window is explicitly registered. */
export function createUnsavedChangesGuard(options: UnsavedChangesGuardOptions = {}) {
  let active = false;
  const targets = new Map<Window, { count: number; listening: boolean }>();
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!active) return;
    event.preventDefault();
    event.returnValue = "";
  };
  function sync(view: Window, registration: { count: number; listening: boolean }) {
    const listen = active && registration.count > 0;
    if (listen === registration.listening) return;
    try {
      if (listen) view.addEventListener?.("beforeunload", beforeUnload);
      else view.removeEventListener?.("beforeunload", beforeUnload);
      registration.listening = listen;
    } catch {
      // Closed or navigated windows may no longer expose document APIs.
    }
  }
  return {
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      for (const [view, registration] of targets) sync(view, registration);
    },
    register(view: Window | null | undefined): () => void {
      if (!view) return () => {};
      const registration = targets.get(view) ?? { count: 0, listening: false };
      registration.count++;
      targets.set(view, registration);
      sync(view, registration);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        registration.count--;
        sync(view, registration);
        if (!registration.count) targets.delete(view);
      };
    },
    confirmClose(view: Window): boolean {
      if (!active) return true;
      try {
        return view.confirm(options.closeMessage ?? "未保存の変更があります。このウィンドウを閉じますか？");
      } catch {
        return false;
      }
    },
  };
}

export type UnsavedChangesGuard = ReturnType<typeof createUnsavedChangesGuard>;
