"use client";

/* Blob URLs stay in the browser; a server image optimizer cannot read them. */
/* eslint-disable @next/next/no-img-element */

import { useMemo } from "react";
import { AlertCircle, FileText, Loader2 } from "lucide-react";
import { parseDelimited, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, MAX_TABLE_CELLS, MAX_TABLE_CELL_CHARACTERS } from "../model/preview-table";
import { usePreviewSource, type PreviewSourceProps } from "../state/use-preview-source";
import { fileExtension } from "../model/text";

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
  allowDownload = true,
  processing = false,
  processingLabel = "処理中…",
  ...sourceProps
}: PreviewSourceProps & {
  allowDownload?: boolean;
  processingLabel?: string;
}) {
  const current = usePreviewSource({ entry, processing, ...sourceProps });
  const extension = fileExtension(entry.name);
  const mode = current.mode;
  const text = current.text;
  const rows = useMemo(() => text !== undefined && (extension === "csv" || extension === "tsv")
    ? parseDelimited(text, extension === "tsv" ? "\t" : ",") : null, [text, extension]);
  const body = () => {
    if (current.status === "unsupported") return <Unavailable allowDownload={allowDownload} />;
    if (current.status === "tooLarge") {
      return (
        <Unavailable allowDownload={allowDownload}>
          {allowDownload
            ? "1 MBを超えるテキストはダウンロードして確認できます。"
            : "1 MBを超えるテキストはプレビューできません。"}
        </Unavailable>
      );
    }
    if (current.status === "error")
      return (
        <div className={unavailableClass} role="alert">
          <AlertCircle aria-hidden="true" />
          <p className="lxe:mx-2.5 lxe:text-center lxe:text-xs">
            {current.error}
            {current.isMediaError && allowDownload && "ダウンロードして確認できます。"}
          </p>
        </div>
      );
    if (current.status === "loading" || current.status === "pending") {
      return (
        <div
          className="lxe:flex lxe:h-[260px] lxe:items-center lxe:justify-center lxe:gap-3 lxe:rounded-lg lxe:bg-[var(--explorer-panel,#f7f9fc)] lxe:text-sm lxe:text-[var(--explorer-muted,#8798ae)]"
          role="status"
        >
          <Loader2 className="lxe:animate-spin" aria-hidden="true" />
          {current.status === "pending" ? current.pendingMessage ?? processingLabel : "読み込み中…"}
        </div>
      );
    }

    const mediaError = current.mediaError;
    if (current.url) {
      if (mode === "image")
        return (
          <div className="lxe:relative lxe:flex lxe:h-[52dvh] lxe:shrink lxe:items-center lxe:justify-center lxe:rounded-lg lxe:bg-[repeating-conic-gradient(var(--explorer-border,#edf1f7)_0%_25%,var(--explorer-panel,#f8fafc)_0%_50%)] lxe:bg-size-[20px_20px] lxe:p-5">
          <img
            key={current.mediaKey}
              src={current.url}
              crossOrigin={current.crossOrigin}
              alt={entry.name}
              onError={mediaError}
              className="lxe:max-h-full lxe:max-w-full lxe:object-contain"
            />
          </div>
        );
      if (mode === "pdf")
        return (
        <iframe
          key={current.mediaKey}
            src={allowDownload ? current.url : `${current.url}${current.url.includes("#") ? "&" : "#"}toolbar=0`}
            title={entry.name}
            className="lxe:h-[60dvh] lxe:w-full lxe:rounded-lg lxe:border lxe:border-[var(--explorer-border,#e7ecf4)]"
            sandbox={sourceProps.previewOptions?.pdfSandbox === false ? undefined : sourceProps.previewOptions?.pdfSandbox ?? ""}
            onError={mediaError}
          />
        );
      if (mode === "video")
        return (
        <video
          key={current.mediaKey}
            controls
            controlsList={allowDownload ? undefined : "nodownload"}
            src={current.url}
            crossOrigin={current.crossOrigin}
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
  };
  return (
    <div className="lxe:relative">
      {body()}
      {processing && current.status !== "pending" && (
        <div
          role="status"
          className="lxe:pointer-events-none lxe:absolute lxe:right-3 lxe:top-3 lxe:flex lxe:items-center lxe:gap-2 lxe:rounded-lg lxe:bg-[var(--explorer-panel,#f7f9fc)] lxe:px-3 lxe:py-2 lxe:text-xs lxe:text-[var(--explorer-muted,#8798ae)]"
        >
          <Loader2 className="lxe:animate-spin" size={14} aria-hidden="true" />
          {processingLabel}
        </div>
      )}
    </div>
  );
}
