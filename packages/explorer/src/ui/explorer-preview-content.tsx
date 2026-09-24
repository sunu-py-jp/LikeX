"use client";

import { useMemo } from "react";
import type { ExplorerProps } from "../props";
import type { ExplorerEntry } from "../model/draft";
import { createPreviewRequest } from "../model/preview";
import FilePreview from "./file-preview";

type PreviewContentProps = Pick<ExplorerProps,
  "readFile" | "renderPreview" | "resolvePreviewSource" | "getProcessingLabel"> & {
  entries: readonly ExplorerEntry[];
  entry: ExplorerEntry;
  processing: boolean;
  allowDownload: boolean;
  previewOptions?: ExplorerProps["preview"];
};

/** Create the built-in element lazily: an override never mounts its loader. */
export function ExplorerPreviewContent({ entries, entry, processing, allowDownload,
  readFile, renderPreview, resolvePreviewSource, getProcessingLabel, previewOptions,
}: PreviewContentProps) {
  // Both callback payloads and inspectable React element props are isolated
  // descriptions. Host presentation code never receives the live draft entry.
  const request = createPreviewRequest(entries, entry.id);
  const defaultRequest = useMemo(() => {
    const copy = createPreviewRequest(entries, entry.id);
    if (copy?.source) Object.freeze(copy.source);
    return copy ? Object.freeze(copy) : null;
  }, [entries, entry.id]);
  if (!request || !defaultRequest) return null;
  let processingLabel: string | undefined;
  if (processing && getProcessingLabel) {
    try {
      const labelRequest = createPreviewRequest(entries, entry.id);
      if (labelRequest) processingLabel = getProcessingLabel(labelRequest);
    } catch {
      processingLabel = "処理状況を確認できません";
    }
  }
  const defaultPreview = <FilePreview entry={defaultRequest} request={defaultRequest}
    readFile={readFile} allowDownload={allowDownload} resolvePreviewSource={resolvePreviewSource}
    processing={processing} processingLabel={processingLabel} previewOptions={previewOptions} />;
  try {
    return renderPreview?.({ entry: request, processing, processingLabel, allowDownload, defaultPreview }) ?? defaultPreview;
  } catch {
    return <p role="alert">プレビューを表示できませんでした</p>;
  }
}
