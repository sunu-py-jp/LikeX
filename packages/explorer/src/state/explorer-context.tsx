"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { useExplorerController } from "./use-explorer-controller";

type Controller = ReturnType<typeof useExplorerController>;
export const ExplorerContext = createContext<Controller | null>(null);

export function shallowExplorerEqual<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right) ||
    (Object.getPrototypeOf(left) !== Object.prototype && !Array.isArray(left))) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(right, key) && Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/** Stable operations forward to the latest committed controller, while readers
 * subscribe only to the data they display. Host readers/renderers retain identity. */
export function createExplorerStore(initial: Controller) {
  let current = initial;
  const actions = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Set<() => void>();
  function normalize(value: Controller): Controller {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (typeof item !== "function" || key === "readFile" || key === "renderIcon") return [key, item];
      if (!actions.has(key)) actions.set(key, (...args) => Reflect.apply(
        current[key as keyof Controller] as (...args: unknown[]) => unknown, undefined, args));
      return [key, actions.get(key)];
    })) as Controller;
  }
  let snapshot = normalize(initial);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish(value: Controller) {
      current = value;
      const next = normalize(value);
      if (shallowExplorerEqual(snapshot, next)) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

const ExplorerStoreContext = createContext<ReturnType<typeof createExplorerStore> | null>(null);
export function ExplorerProvider({ value, children }: { value: Controller; children: ReactNode }) {
  const [store] = useState(() => createExplorerStore(value));
  useLayoutEffect(() => { store.publish(value); }, [store, value]);
  return <ExplorerStoreContext.Provider value={store}>{children}</ExplorerStoreContext.Provider>;
}

const noSubscription = () => () => {};
const identity = (value: Controller | null) => value;

function createSelectionReader<T>(getSnapshot: () => Controller | null, selector: (value: Controller | null) => T,
  equal: (left: T, right: T) => boolean, getCommitted: () => { value: T } | null) {
  let initialized = false;
  let snapshot: Controller | null;
  let selection: T;
  return () => {
    const next = getSnapshot();
    if (initialized && Object.is(snapshot, next)) return selection;
    const selected = selector(next);
    const previous = initialized ? { value: selection } : getCommitted();
    selection = previous && equal(previous.value, selected) ? previous.value : selected;
    snapshot = next;
    initialized = true;
    return selection;
  };
}

export function useOptionalExplorerSelector<T>(selector: (value: Controller | null) => T, equal: (left: T, right: T) => boolean = shallowExplorerEqual): T {
  const store = useContext(ExplorerStoreContext);
  const legacy = useContext(ExplorerContext);
  const committed = useRef<{ value: T } | null>(null);
  const getSelection = useMemo(() => createSelectionReader(
    // Reuse only the last committed selection, as an external-store snapshot cache.
    // eslint-disable-next-line react-hooks/refs
    store ? store.getSnapshot : () => legacy, selector, equal, () => committed.current,
  ), [store, legacy, selector, equal]);
  const selected = useSyncExternalStore(store?.subscribe ?? noSubscription, getSelection, getSelection);
  useEffect(() => { committed.current = { value: selected }; }, [selected]);
  return selected;
}

export function useExplorerSelector<T>(selector: (value: Controller) => T, equal?: (left: T, right: T) => boolean): T {
  return useOptionalExplorerSelector(value => {
    if (!value) throw new Error("Explorer components must be inside Explorer.");
    return selector(value);
  }, equal);
}
export function useExplorerFields<K extends keyof Controller>(...keys: K[]): Pick<Controller, K> {
  return useExplorerSelector(value => Object.fromEntries(keys.map(key => [key, value[key]])) as Pick<Controller, K>);
}
export function useExplorer() {
  const context = useOptionalExplorerSelector(identity, Object.is);
  if (!context) throw new Error("Explorer components must be inside Explorer.");
  return context;
}
