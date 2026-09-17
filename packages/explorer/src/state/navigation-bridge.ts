import type { ExplorerNavigationHandle, ExplorerNavigationResult } from "../model/navigation";

/** A workspace may outlive its popup. Never queue commands for an unopened view. */
export function createExplorerNavigationBridge() {
  let current: ExplorerNavigationHandle | null = null;
  const unavailable = (): ExplorerNavigationResult => ({
    ok: false, code: "not-ready", message: "エクスプローラーの画面が開いていません",
  });
  const handle: ExplorerNavigationHandle = {
    navigate: path => current?.navigate(path) ?? unavailable(),
    selectFiles: targets => current?.selectFiles(targets) ?? unavailable(),
    showFile: (target, options) => current?.showFile(target, options) ?? unavailable(),
  };
  return {
    handle,
    register(next: ExplorerNavigationHandle) {
      current = next;
      return () => { if (current === next) current = null; };
    },
  };
}

export type ExplorerNavigationBridge = ReturnType<typeof createExplorerNavigationBridge>;
