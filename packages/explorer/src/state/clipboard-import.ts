import { normalizeEntryName } from "../model/entries";

type ClipboardItem = DataTransferItem & {
  getAsEntry?: () => FileSystemEntry | null;
};

type CapturedItem =
  | { kind: "file"; file: File }
  | { kind: "directory"; entry: FileSystemDirectoryEntry; name: string };

export type ClipboardImport = {
  hasDirectories: boolean;
  hasRootFiles: boolean;
  /** Immediately available when no directories were captured. */
  files: File[];
  read(signal?: AbortSignal): Promise<File[]>;
};

function unavailable(): Error {
  return new Error("クリップボードのファイル情報を取得できませんでした。ファイルやフォルダを選択して追加してください");
}

function assertFile(file: File | null): asserts file is File {
  // Files created in another window have a different JavaScript constructor.
  if (!file || typeof file.name !== "string" || !Number.isSafeInteger(file.size) || file.size < 0 ||
    typeof file.arrayBuffer !== "function") throw unavailable();
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("読み込みを中止しました", "AbortError");
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

/** Stop waiting promptly on abort; late native callbacks cannot resume the import. */
function readOperation<T>(start: (success: (result: T) => void, failure: (error: unknown) => void) => void,
  signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortReason(signal!)));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      start(result => finish(() => resolve(result)), error => finish(() => reject(error)));
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function readCapturedItems(items: readonly CapturedItem[], signal?: AbortSignal): Promise<File[]> {
  const files: File[] = [];
  const ancestors = new Set<FileSystemEntry>();

  async function visit(entry: FileSystemEntry, parent: readonly string[], rootName?: string): Promise<void> {
    checkAbort(signal);
    const parts = [...parent, rootName ?? normalizeEntryName(entry.name)];
    const relativePath = parts.join("/");
    try {
      if (entry.isDirectory && !entry.isFile) {
        const directory = entry as FileSystemDirectoryEntry;
        if (typeof directory.createReader !== "function" || ancestors.has(directory)) throw unavailable();
        const reader = directory.createReader();
        if (typeof reader?.readEntries !== "function") throw unavailable();
        ancestors.add(directory);
        try {
          // Chromium can return a directory in batches. Keep the same reader
          // and request the next batch until it returns an empty array.
          for (;;) {
            checkAbort(signal);
            const batch = await readOperation<FileSystemEntry[]>((success, failure) =>
              reader.readEntries(success, failure), signal);
            checkAbort(signal);
            if (!Array.isArray(batch)) throw unavailable();
            if (!batch.length) break;
            for (const child of batch) await visit(child, parts);
          }
        } finally {
          ancestors.delete(directory);
        }
      } else if (entry.isFile && !entry.isDirectory) {
        const fileEntry = entry as FileSystemFileEntry;
        if (typeof fileEntry.file !== "function") throw unavailable();
        const file = await readOperation<File>((success, failure) => fileEntry.file(success, failure), signal);
        checkAbort(signal);
        assertFile(file);
        // Constructing a File from a File reuses its Blob data; no content read
        // or mutation of the native File is needed to retain the relative path.
        const copy = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
        Object.defineProperty(copy, "webkitRelativePath", { value: relativePath, enumerable: true });
        files.push(copy);
      } else throw unavailable();
    } catch (error) {
      checkAbort(signal);
      const message = error && typeof error === "object" && "message" in error ? String(error.message) : "ファイル情報を取得できませんでした";
      throw new Error(`「${relativePath}」を読み込めませんでした: ${message}`);
    }
  }

  for (const item of items) {
    checkAbort(signal);
    if (item.kind === "file") files.push(item.file);
    else await visit(item.entry, [], item.name);
  }
  checkAbort(signal);
  return files;
}

/** Read the transfer only during its native paste event. The returned operation
 * retains Files/Entry handles, never a DataTransfer or DataTransferItem. */
export function captureClipboardImport(data: DataTransfer): ClipboardImport | null {
  const fileItems = Array.from(data.items ?? []).filter(item => item.kind === "file");
  const listedFiles = Array.from(data.files ?? []);
  const hasFilePayload = fileItems.length > 0 || listedFiles.length > 0 || Array.from(data.types ?? []).includes("Files");
  if (!hasFilePayload) return null;
  const captured: CapturedItem[] = [];
  if (fileItems.length) {
    for (const [index, item] of fileItems.entries()) {
      const entry = (item as ClipboardItem).getAsEntry?.() ?? item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        if (entry.isFile || typeof (entry as FileSystemDirectoryEntry).createReader !== "function") throw unavailable();
        captured.push({ kind: "directory", entry: entry as FileSystemDirectoryEntry, name: normalizeEntryName(entry.name) });
      } else {
        const file = item.getAsFile?.() ?? (listedFiles.length === fileItems.length ? listedFiles[index] : null);
        assertFile(file);
        captured.push({ kind: "file", file });
      }
    }
  } else {
    for (const file of listedFiles) {
      assertFile(file);
      captured.push({ kind: "file", file });
    }
  }
  if (!captured.length) throw unavailable();
  const files = captured.flatMap(item => item.kind === "file" ? [item.file] : []);
  return {
    hasDirectories: captured.some(item => item.kind === "directory"),
    hasRootFiles: files.length > 0,
    files,
    read: signal => readCapturedItems(captured, signal),
  };
}
