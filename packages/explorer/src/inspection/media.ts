import type { ExplorerUploadContentMetadata, ExplorerUploadInspectFileRequest } from "../model/upload-content";

export function inspectMedia({ file, kind, signal }: ExplorerUploadInspectFileRequest): Promise<ExplorerUploadContentMetadata> {
  signal.throwIfAborted();
  if (kind !== "video" && kind !== "audio") throw new Error("動画または音声ファイルを指定してください");
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function")
    throw new Error("この環境では動画・音声の長さを確認できません。upload.inspectFileを指定してください");
  return new Promise((resolve, reject) => {
    const media = document.createElement(kind);
    let url: string | undefined, settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      const durationSeconds = media.duration;
      media.removeEventListener("loadedmetadata", loaded);
      media.removeEventListener("durationchange", loaded);
      media.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      // Clear the source to stop fetching metadata and release decoder resources.
      try { media.removeAttribute("src"); media.load(); } catch { /* cleanup must not mask the result */ }
      if (url !== undefined) URL.revokeObjectURL(url);
      if (error !== undefined) reject(error);
      else resolve({ kind, durationSeconds });
    };
    const loaded = () => {
      if (signal.aborted) { finish(signal.reason); return; }
      if (Number.isFinite(media.duration) && media.duration >= 0) finish();
      else finish(new Error("動画・音声の長さを確認できませんでした"));
    };
    const failed = () => finish(new Error("この動画・音声形式を読み込めません。必要に応じてupload.inspectFileを指定してください"));
    const aborted = () => finish(signal.reason);
    media.preload = "metadata";
    media.muted = true;
    media.addEventListener("loadedmetadata", loaded);
    media.addEventListener("durationchange", loaded);
    media.addEventListener("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    try {
      url = URL.createObjectURL(file);
      media.src = url;
      media.load();
    } catch (error) { finish(error); }
  });
}
