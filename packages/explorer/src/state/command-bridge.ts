import type { ExplorerCommandHandle } from "../model/commands";

/** Keep retained refs connected only to the currently mounted main controller. */
export function createExplorerCommandBridge() {
  let current: ExplorerCommandHandle | null = null;
  const unavailable = () => Promise.resolve(false);
  const handle: ExplorerCommandHandle = {
    getEntries: () => current?.getEntries() ?? null,
    execute: action => current?.execute(action) ?? unavailable(),
    upload: (files, parentId) => current?.upload(files, parentId) ?? unavailable(),
    save: () => current?.save() ?? unavailable(),
    discard: () => current?.discard() ?? unavailable(),
    refresh: () => current?.refresh() ?? unavailable(),
    download: target => current?.download(target) ?? unavailable(),
  };
  return {
    handle,
    register(next: ExplorerCommandHandle) {
      current = next;
      return () => { if (current === next) current = null; };
    },
  };
}
