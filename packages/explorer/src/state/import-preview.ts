"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ExplorerEntry } from "../model/draft";
import { entryExtension, nameKey, normalizeEntryName } from "../model/entries";

/** Display-only metadata: these IDs and entries never enter the draft. */
export type ExplorerPendingImportEntry = Readonly<{
  entry: ExplorerEntry;
  relativePath: string;
}>;

export type ExplorerImportPreviewWriter = {
  append: (file: File) => void;
  include: (files: readonly File[], completed: number) => void;
  omit: (files: readonly File[]) => void;
  flush: () => void;
  clear: () => void;
};

export const EMPTY_IMPORT_ENTRIES: readonly ExplorerPendingImportEntry[] = Object.freeze([]);

export type ExplorerImportPreview = Readonly<{
  /** Stable for the whole import, including intermediate publications. */
  id: string;
  parent: string;
  entries: readonly ExplorerPendingImportEntry[];
}>;

export type ExplorerImportPreviewProjection = Readonly<{
  /** Navigation can see provisional folders; draft operations cannot. */
  navigationEntries: readonly ExplorerEntry[];
  pendingEntriesByParent: ReadonlyMap<string, readonly ExplorerPendingImportEntry[]>;
  importingEntryIds: ReadonlySet<string>;
  /** Absolute paths let a provisional location follow its committed replacement. */
  folderPaths: ReadonlyMap<string, string>;
  fileCount: number;
}>;

/** Project discovered files into their hierarchy without modifying committed data. */
export function projectExplorerImportPreview(
  preview: ExplorerImportPreview | null,
  committedEntries: readonly ExplorerEntry[],
): ExplorerImportPreviewProjection {
  const pendingEntriesByParent = new Map<string, ExplorerPendingImportEntry[]>();
  const importingEntryIds = new Set<string>();
  const folderPaths = new Map<string, string>();
  const result = { navigationEntries: committedEntries, pendingEntriesByParent, importingEntryIds, folderPaths, fileCount: preview?.entries.length ?? 0 };
  if (!preview?.entries.length) return result;

  const byId = new Map(committedEntries.map(entry => [entry.id, entry]));
  if (preview.parent !== "root" && byId.get(preview.parent)?.kind !== "folder") return result;
  const byParentName = new Map<string, Map<string, ExplorerEntry>>();
  for (const entry of committedEntries) {
    const siblings = byParentName.get(entry.parent) ?? new Map<string, ExplorerEntry>();
    siblings.set(nameKey(entry.name), entry);
    byParentName.set(entry.parent, siblings);
  }
  const provisionalFolders: ExplorerEntry[] = [];
  const pathCache = new Map<string, string>([["root", "/"]]);
  const pathFor = (id: string): string => {
    const cached = pathCache.get(id);
    if (cached !== undefined) return cached;
    const ancestors: ExplorerEntry[] = [];
    const seen = new Set<string>();
    let current = id;
    while (!pathCache.has(current) && !seen.has(current)) {
      seen.add(current);
      const entry = byId.get(current);
      if (!entry) break;
      ancestors.push(entry);
      current = entry.parent;
    }
    let path = pathCache.get(current) ?? "/";
    for (const entry of ancestors.reverse()) {
      path = `${path === "/" ? "" : path}/${entry.name}`;
      pathCache.set(entry.id, path);
    }
    return path;
  };
  const markImporting = (id: string) => {
    let current = id;
    while (!importingEntryIds.has(current)) {
      importingEntryIds.add(current);
      if (current === "root") break;
      current = byId.get(current)?.parent ?? "root";
    }
  };
  const appendPending = (entry: ExplorerEntry, relativePath: string) => {
    const children = pendingEntriesByParent.get(entry.parent) ?? [];
    children.push({ entry, relativePath });
    pendingEntriesByParent.set(entry.parent, children);
    byId.set(entry.id, entry);
    const siblings = byParentName.get(entry.parent) ?? new Map<string, ExplorerEntry>();
    siblings.set(nameKey(entry.name), entry);
    byParentName.set(entry.parent, siblings);
  };
  for (const item of preview.entries) {
    const parts = item.relativePath.split("/");
    let parent = preview.parent;
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index];
      const last = index === parts.length - 1;
      const existing = byParentName.get(parent)?.get(nameKey(name));
      if (existing) {
        markImporting(existing.id);
        // A file where a directory is required is reported by upload validation.
        // Do not create a second row or fictitious children beneath that file.
        if (last || existing.kind !== "folder") break;
        parent = existing.id;
        continue;
      }
      const relativePath = parts.slice(0, index + 1).join("/");
      const entry: ExplorerEntry = last ? { ...item.entry, parent } : {
        id: `import-preview:${preview.id}:folder:${JSON.stringify(parts.slice(0, index + 1).map(nameKey))}`,
        parent, name, kind: "folder", extension: "", size: 0, mime: "",
        createdAt: "", updatedAt: "", favorite: 0, source: null,
      };
      appendPending(entry, relativePath);
      markImporting(entry.id);
      if (!last) {
        provisionalFolders.push(entry);
        folderPaths.set(entry.id, pathFor(entry.id));
        parent = entry.id;
      }
    }
  }
  return { ...result, navigationEntries: provisionalFolders.length ? [...committedEntries, ...provisionalFolders] : committedEntries };
}

/** One originating pane owns the preview; workspace data remains atomic/shared. */
export function useExplorerImportPreview() {
  const [preview, setPreview] = useState<ExplorerImportPreview | null>(null);
  const active = useRef<ExplorerImportPreviewWriter | null>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.clear(); };
  }, []);

  const begin = useCallback((parent: string): ExplorerImportPreviewWriter => {
    active.current?.clear();
    const token = crypto.randomUUID();
    const items = new Map<string, { file: File; item: ExplorerPendingImportEntry }>();
    const candidates = new Map<string, { id: string; files: File[] }>();
    const seen = new WeakSet<File>();
    let omitted = new Set<File>();
    let cursor = 0;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPublished = -Infinity;
    let changed = false;
    const alive = () => mounted.current && active.current === writer;
    const flush = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (!alive() || !changed) return;
      changed = false;
      lastPublished = performance.now();
      setPreview({ id: token, parent, entries: Array.from(items.values(), value => value.item) });
    };
    const schedule = () => {
      const remaining = 80 - (performance.now() - lastPublished);
      if (remaining <= 0) flush();
      else if (timer === undefined) timer = setTimeout(flush, remaining);
    };
    const keyFor = (file: File) => (file.webkitRelativePath || file.name).split("/").map(normalizeEntryName);
    const project = (key: string, id: string, file: File, parts: string[]) => {
      if (items.get(key)?.file === file) return;
      const name = parts[parts.length - 1];
      const entry: ExplorerEntry = {
        id, parent, name, kind: "file", extension: entryExtension({ name, kind: "file" }),
        size: file.size, mime: file.type || "application/octet-stream",
        createdAt: "", updatedAt: "", favorite: 0, source: null,
      };
      items.set(key, { file, item: { entry, relativePath: parts.join("/") } });
      changed = true;
    };
    const append = (file: File) => {
      if (!alive() || !file || typeof file !== "object" || typeof file.name !== "string" ||
        !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.arrayBuffer !== "function" || seen.has(file)) return;
      seen.add(file);
      let parts: string[];
      try { parts = keyFor(file); } catch { return; } // The import validator reports invalid paths.
      const key = JSON.stringify(parts.map(nameKey));
      const record = candidates.get(key) ?? { id: `import-preview:${token}:${sequence++}`, files: [] };
      record.files.push(file);
      candidates.set(key, record);
      if (omitted.has(file)) return;
      project(key, record.id, file, parts);
      schedule();
    };
    const writer: ExplorerImportPreviewWriter = {
      append,
      include(files, completed) {
        // A retry can restart its counter. Metadata already discovered stays
        // stable, and each incoming File is projected at most once.
        const end = Math.min(completed, files.length);
        while (cursor < end) append(files[cursor++]);
      },
      omit(files) {
        if (!alive()) return;
        omitted = new Set(files);
        // A later duplicate can be skipped while the first file is accepted.
        // Keep the last remaining candidate, including after refreshed decisions.
        for (const [key, record] of candidates) {
          let file: File | undefined;
          for (let index = record.files.length - 1; index >= 0; index--) {
            if (!omitted.has(record.files[index])) { file = record.files[index]; break; }
          }
          if (file) project(key, record.id, file, keyFor(file));
          else if (items.delete(key)) changed = true;
        }
        flush();
      },
      flush,
      clear() {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        items.clear();
        candidates.clear();
        omitted.clear();
        if (active.current !== writer) return;
        active.current = null;
        if (mounted.current) setPreview(null);
      },
    };
    active.current = writer;
    return writer;
  }, []);

  return { preview, begin };
}
