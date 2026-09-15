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

type Preview = { parent: string; entries: readonly ExplorerPendingImportEntry[] };

/** One originating pane owns the preview; workspace data remains atomic/shared. */
export function useExplorerImportPreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
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
      setPreview({ parent, entries: Array.from(items.values(), value => value.item) });
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
