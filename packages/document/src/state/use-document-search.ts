import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { searchDocument, type DocumentSearchMatch, type DocumentSearchTextMatch } from "../model/search";
import type { DocumentModel } from "../model/types";

export type DocumentSearchLocation = DocumentSearchMatch & { match: DocumentSearchTextMatch };

/** Search is view state; navigation never executes an editing command. */
export function useDocumentSearch(document: DocumentModel, enabled: boolean, reveal: (location: DocumentSearchLocation) => void) {
  const [request, setRequest] = useState({ open: false, query: "", focus: 0 });
  const [caseSensitive, setCaseSensitive] = useState(false);
  const latest = useRef({ enabled, reveal, mounted: true });
  useLayoutEffect(() => { latest.current = { enabled, reveal, mounted: true }; });
  useEffect(() => { latest.current.mounted = true; return () => { latest.current.mounted = false; }; }, []);
  if (!enabled && request.open) setRequest({ ...request, open: false });
  const open = enabled && request.open;
  const result = useMemo(() => {
    if (!open || !request.query.trim()) return { locations: [] as DocumentSearchLocation[], truncated: false, error: "" };
    try {
      const found = searchDocument(document, { keywords: [request.query], matchCase: caseSensitive }, { limit: 1000 });
      const locations = found.matches.flatMap(location => location.matches.map(match => ({ ...location, match })));
      return { locations: locations.slice(0, 1000), truncated: found.truncated || locations.length > 1000, error: "" };
    } catch (cause) {
      return { locations: [] as DocumentSearchLocation[], truncated: false, error: cause instanceof Error ? cause.message : "検索できませんでした。" };
    }
  }, [document, open, request.query, caseSensitive]);
  const [cursor, setCursor] = useState<{ result: typeof result; index: number } | null>(null);
  const index = result.locations.length ? cursor?.result === result ? cursor.index : 0 : -1;
  const active = result.locations[index];
  const revealedIntent = useRef<string | null>(null);
  const intent = JSON.stringify([request.query, caseSensitive, request.focus]);
  useEffect(() => {
    if (!open) { revealedIntent.current = null; return; }
    if (revealedIntent.current === intent) return;
    revealedIntent.current = intent;
    if (active) latest.current.reveal(active);
  }, [open, intent, active]);
  function openSearch(query?: string): boolean {
    if (!latest.current.mounted || !latest.current.enabled || (query !== undefined && (typeof query !== "string" || query.length > 4096))) return false;
    setRequest(value => ({ open: true, query: query ?? value.query, focus: value.focus + 1 })); return true;
  }
  function closeSearch() { if (latest.current.mounted) setRequest(value => ({ ...value, open: false })); }
  function goTo(index: number) {
    if (!open || !result.locations.length) return;
    const target = (index + result.locations.length) % result.locations.length;
    latest.current.reveal(result.locations[target]);
    setCursor({ result, index: target });
  }
  return { open, query: request.query, focus: request.focus, caseSensitive, setCaseSensitive, ...result, index, active,
    setQuery: (query: string) => setRequest(value => ({ ...value, query })), openSearch, closeSearch, goTo };
}
