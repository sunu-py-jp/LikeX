"use client";

/* Blob URLs stay in the browser; a server image optimizer cannot read them. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, FileText, Loader2 } from "lucide-react";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerFileReader } from "../model/file-content";
import { parseDelimited, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, MAX_TABLE_CELLS, MAX_TABLE_CELL_CHARACTERS } from "../model/preview-table";
import { useMediaCache, useMediaRevision } from "../state/media-context";

const MAX_TEXT_BYTES = 1024 * 1024;
const MEDIA_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
};
type PreviewMode = "image" | "pdf" | "video" | "text" | "unsupported";
type PreviewState = {
  key: object;
  text?: string;
  url?: string;
  error?: string;
  mediaError?: boolean;
  tooLarge?: boolean;
};

function previewMode(entry: ExplorerEntry): PreviewMode {
  if (entry.kind !== "file") return "unsupported";
  const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
  // SVG is displayed as text, never loaded into a browser document context.
  if (
    extension === "svg" ||
    entry.mime.toLowerCase().split(";")[0] === "image/svg+xml"
  )
    return "text";
  if (/^(png|jpg|jpeg|gif|webp|avif|bmp)$/.test(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (/^(mp4|webm)$/.test(extension)) return "video";
  if (
    /^(txt|md|csv|tsv|json|js|jsx|ts|tsx|xml|yaml|yml|html|css|vb|cs|py|log|sql|sh|ini|cfg)$/.test(
      extension,
    )
  )
    return "text";
  return "unsupported";
}

const unavailableClass =
  "lxe:flex lxe:h-[290px] lxe:flex-col lxe:items-center lxe:justify-center lxe:gap-[15px] lxe:rounded-lg lxe:bg-[var(--explorer-panel,#f7f9fc)] lxe:text-[var(--explorer-muted,#8798ae)]";

function Unavailable({
  children,
  allowDownload,
}: {
  children?: React.ReactNode;
  allowDownload: boolean;
}) {
  return (
    <div className={unavailableClass}>
      <FileText aria-hidden="true" size={40} />
      <h3 className="lxe:mt-[3px] lxe:text-[15px] lxe:font-medium lxe:text-[var(--explorer-foreground,#344c6e)]">
        {allowDownload ? "ダウンロードして開く" : "プレビューできません"}
      </h3>
      <p className="lxe:mx-2.5 lxe:text-center lxe:text-xs">
        {children ??
          (allowDownload
            ? "この形式はお使いのアプリで確認できます。"
            : "この形式のプレビューには対応していません。")}
      </p>
    </div>
  );
}

export default function FilePreview({
  entry,
  readFile,
  allowDownload = true,
}: {
  entry: ExplorerEntry;
  readFile?: ExplorerFileReader;
  allowDownload?: boolean;
}) {
  const mode = previewMode(entry);
  const cache = useMediaCache();
  const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
  const mediaMime = MEDIA_MIME_TYPES[extension];
  const sourceId = entry.source?.kind === "existing" ? entry.source.id : null;
  const revision = useMediaRevision(cache, sourceId !== null);
  const file = entry.source?.kind === "local" ? entry.source.file : null;
  const source = useMemo<ExplorerEntry["source"]>(() => file ? { kind: "local", file } :
    sourceId !== null ? { kind: "existing", id: sourceId } : null, [sourceId, file]);
  const reader = file ? undefined : readFile;
  const canRead = mode !== "unsupported" && !(mode === "text" && entry.size > MAX_TEXT_BYTES);
  const key = useMemo(() => ({ source, reader, mode, mediaMime, canRead, revision }), [source, reader, mode, mediaMime, canRead, revision]);
  const [state, setState] = useState<PreviewState | null>(null);
  const current = state?.key === key ? state : null;
  const text = current?.text;
  const rows = useMemo(() => text !== undefined && (extension === "csv" || extension === "tsv")
    ? parseDelimited(text, extension === "tsv" ? "\t" : ",") : null, [text, extension]);

  useEffect(() => {
    if (!key.canRead) return;
    let cancelled = false;
    const lease = key.source ? cache.acquire(key.source, key.reader) : null;
    void (async () => {
      try {
        if (!lease) throw new Error("この項目にはファイルの内容がありません");
        const blob = await lease.promise;
        if (cancelled) return;
        // Verify actual content size as metadata may have been supplied by a host.
        const isSvg = blob.type.toLowerCase().split(";")[0] === "image/svg+xml";
        if (key.mode === "text" || isSvg) {
          if (blob.size > MAX_TEXT_BYTES) {
            setState({ key, tooLarge: true });
            lease.release();
            return;
          }
          const text = await blob.text();
          if (!cancelled) setState({ key, text });
        } else {
          // Readers may return untyped bytes. Give the browser the supported
          // preview format without changing the original download content.
          setState({ key, url: lease.objectUrl(key.mediaMime) });
        }
      } catch (error) {
        lease?.release();
        if (!cancelled)
          setState({
            key,
            error:
              error instanceof Error
                ? error.message
                : "ファイルを読み込めませんでした",
          });
      }
    })();
    return () => {
      cancelled = true;
      lease?.release();
    };
  }, [cache, key]);

  if (mode === "unsupported") return <Unavailable allowDownload={allowDownload} />;
  if ((mode === "text" && entry.size > MAX_TEXT_BYTES) || current?.tooLarge) {
    return (
      <Unavailable allowDownload={allowDownload}>
        {allowDownload
          ? "1 MBを超えるテキストはダウンロードして確認できます。"
          : "1 MBを超えるテキストはプレビューできません。"}
      </Unavailable>
    );
  }
  if (current?.error)
    return (
      <div className={unavailableClass} role="alert">
        <AlertCircle aria-hidden="true" />
        <p className="lxe:mx-2.5 lxe:text-center lxe:text-xs">
          {current.error}
          {current.mediaError && allowDownload && "ダウンロードして確認できます。"}
        </p>
      </div>
    );
  if (!current || (current.text === undefined && !current.url)) {
    return (
      <div
        className="lxe:flex lxe:h-[260px] lxe:items-center lxe:justify-center lxe:gap-3 lxe:rounded-lg lxe:bg-[var(--explorer-panel,#f7f9fc)] lxe:text-sm lxe:text-[var(--explorer-muted,#8798ae)]"
        role="status"
      >
        <Loader2 className="lxe:animate-spin" aria-hidden="true" />
        読み込み中…
      </div>
    );
  }

  const mediaError = () =>
    setState((previous) =>
      previous?.key === key
        ? {
            key,
            error: "このファイルを表示できませんでした。",
            mediaError: true,
          }
        : previous,
    );
  if (current.url) {
    if (mode === "image")
      return (
        <div className="lxe:relative lxe:flex lxe:h-[52dvh] lxe:shrink lxe:items-center lxe:justify-center lxe:rounded-lg lxe:bg-[repeating-conic-gradient(var(--explorer-border,#edf1f7)_0%_25%,var(--explorer-panel,#f8fafc)_0%_50%)] lxe:bg-size-[20px_20px] lxe:p-5">
          <img
            src={current.url}
            alt={entry.name}
            onError={mediaError}
            className="lxe:max-h-full lxe:max-w-full lxe:object-contain"
          />
        </div>
      );
    if (mode === "pdf")
      return (
        <iframe
          src={allowDownload ? current.url : `${current.url}#toolbar=0`}
          title={entry.name}
          className="lxe:h-[60dvh] lxe:w-full lxe:rounded-lg lxe:border lxe:border-[var(--explorer-border,#e7ecf4)]"
          sandbox=""
          onError={mediaError}
        />
      );
    if (mode === "video")
      return (
        <video
          controls
          controlsList={allowDownload ? undefined : "nodownload"}
          src={current.url}
          className="lxe:h-[54dvh] lxe:w-full lxe:rounded-lg lxe:bg-[#172438]"
          aria-label={entry.name}
          onError={mediaError}
        />
      );
  }

  if (rows) {
    return (
      <div className="lxe:min-h-[220px] lxe:max-h-[55dvh] lxe:overflow-auto lxe:rounded-lg lxe:border lxe:border-[var(--explorer-border,#e5ecf4)]">
        <table
          className="lxe:w-full lxe:border-collapse lxe:text-left lxe:text-xs"
          aria-label={`${entry.name}のプレビュー`}
        >
          <thead>
            <tr>
              {rows[0]?.map((cell, index) => (
                <th
                  scope="col"
                  className="lxe:whitespace-nowrap lxe:bg-[var(--explorer-panel,#eff5f9)] lxe:px-4 lxe:py-3 lxe:font-medium lxe:text-[var(--explorer-muted,#718799)]"
                  key={index}
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <td
                    className="lxe:whitespace-nowrap lxe:border-b lxe:border-[var(--explorer-border,#edf2f7)] lxe:px-4 lxe:py-[13px] lxe:text-[var(--explorer-foreground,#5b708c)]"
                    key={columnIndex}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="lxe:m-3.5 lxe:text-xs lxe:text-[var(--explorer-muted,#98a6b9)]">
          最大{MAX_TABLE_ROWS}行・{MAX_TABLE_COLUMNS}列・{MAX_TABLE_CELLS.toLocaleString()}セルを表示（1セル{MAX_TABLE_CELL_CHARACTERS.toLocaleString()}文字まで）
        </p>
      </div>
    );
  }
  return (
    <pre
      className={`lxe:m-0 lxe:min-h-[280px] lxe:max-h-[58dvh] lxe:overflow-auto lxe:rounded-lg lxe:border lxe:border-[var(--explorer-border,#e5ebf4)] lxe:bg-[var(--explorer-panel,#f7f9fc)] lxe:px-[27px] lxe:py-6 lxe:text-sm lxe:text-[var(--explorer-foreground,#506480)] lxe:[tab-size:2] ${extension === "md" ? "lxe:[font-family:inherit] lxe:leading-[2.05] lxe:whitespace-pre-wrap" : "lxe:[font-family:ui-monospace,SFMono-Regular,Consolas,monospace] lxe:leading-[1.95]"}`}
    >
      {current.text}
    </pre>
  );
}
