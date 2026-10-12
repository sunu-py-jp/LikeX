import { useState } from "react";
import { normalizeExternalSearchResults } from "../core";
import { getBlocks } from "../model/query";
import type { DocumentModel } from "../model/types";
import type { DocumentExternalSearchTarget, ExternalSearchOptions, ExternalSearchResult } from "../props";
import { resolveDocumentExternalTarget } from "./document-external-search";
import type { DocumentSearchLocation } from "./use-document-search";

type Result = ExternalSearchResult<DocumentExternalSearchTarget>;
type Baseline = { target: string; documentId: string; text: string; result: Result };
function resolveResults(document: DocumentModel, input: readonly Result[] | undefined, previous: ReadonlyMap<string, Baseline>) {
  const baseline = new Map(previous), source = normalizeExternalSearchResults(input);
  const blocks = source.length ? getBlocks(document) : [];
  const results = source.map(result => {
    let location: DocumentSearchLocation | undefined, error = "";
    try {
      location = resolveDocumentExternalTarget(document, result.target, blocks);
      const signature = JSON.stringify([result.target.blockId, result.target.canvasShapeId, result.target.textFrom, result.target.textTo, result.target.expectedText]), old = baseline.get(result.id);
      if (old?.target === signature && old.result === result && (old.documentId !== document.id || old.text !== location.text)) {
        throw new Error("検索後に対象の本文が変更されています。検索結果を更新してください。");
      }
      if (!old || old.target !== signature || old.result !== result) baseline.set(result.id, { target: signature, documentId: document.id, text: location.text, result });
    } catch (cause) { location = undefined; error = cause instanceof Error ? cause.message : "検索結果を表示できません。"; }
    return { result, location, error };
  });
  const present = new Set(results.map(row => row.result.id));
  for (const id of baseline.keys()) if (!present.has(id)) baseline.delete(id);
  return { document, input, results, baseline };
}

export function useDocumentExternalSearch(document: DocumentModel, options: ExternalSearchOptions<DocumentExternalSearchTarget> | undefined) {
  const [cache, setCache] = useState(() => resolveResults(document, options?.results, new Map()));
  let current = cache;
  if (cache.document !== document || cache.input !== options?.results) {
    current = resolveResults(document, options?.results, cache.baseline); setCache(current);
  }
  const [selectedId, setSelectedId] = useState<string | undefined>(() => options?.initialResultId ?? normalizeExternalSearchResults(options?.results)[0]?.id);
  const results = current.results, index = results.findIndex(row => row.result.id === selectedId);
  return { results, selectedId, setSelectedId, index, active: index < 0 ? undefined : results[index], available: !!options,
    title: typeof options?.title === "string" ? options.title : "外部検索結果" };
}
