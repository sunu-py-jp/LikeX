"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, Maximize, Minus, Plus, X } from "lucide-react";
import { useSlideTheme } from "../state/use-slide-theme";
import type { SlidePdfViewerProps } from "./viewer-types";
import { notifyPdfObserver, usePdfDocument } from "./use-pdf-document";
import { PdfFilmstrip } from "./pdf-filmstrip";
import { PdfViewport } from "./pdf-viewport";
import { usePdfSelection } from "./use-pdf-selection";

const initialPage = (value: number | undefined) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 1;
const initialZoom = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) ? Math.max(25, Math.min(400, Math.round(value))) : 100;

/** Read-only PDF pages in the LikeSlide shell. The PDF never becomes a SlideDeck. */
export function LikeSlidePdfViewer({ ref, ...props }: SlidePdfViewerProps) {
  const root = useRef<HTMLDivElement>(null);
  const [ownerDocument, setOwnerDocument] = useState<Document | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { root.current = node; setOwnerDocument(node?.ownerDocument ?? null); }, []);
  const [zoom, updateZoom] = useState(() => initialZoom(props.initialZoom));
  const [navigation, setNavigation] = useState(() => ({ loader: props.loadPdf, page: initialPage(props.pageNumber ?? props.initialPageNumber) }));
  const controlled = props.pageNumber !== undefined;
  const requested = controlled ? initialPage(props.pageNumber) : navigation.loader === props.loadPdf ? navigation.page : initialPage(props.initialPageNumber);
  if (navigation.loader !== props.loadPdf || controlled && navigation.page !== requested) setNavigation({ loader: props.loadPdf, page: requested });
  const [notice, setNotice] = useState<{ loader: SlidePdfViewerProps["loadPdf"]; error: Error } | null>(null);
  const callbacks = useRef(props);
  useLayoutEffect(() => { callbacks.current = props; });
  const reportError = useCallback((error: Error) => {
    setNotice({ loader: callbacks.current.loadPdf, error });
    notifyPdfObserver(callbacks.current.onError, error);
  }, []);
  const loaded = usePdfDocument(props.loadPdf, undefined, reportError), session = loaded?.session;
  const pageCount = session?.pageCount ?? 0, pageNumber = session ? Math.min(pageCount, requested) : 0;
  const current = useRef({ active: false, props, session, pageNumber, zoom, controlled });
  useLayoutEffect(() => { current.current = { active: true, props, session, pageNumber, zoom, controlled }; });
  useLayoutEffect(() => () => { current.current.active = false; }, []);
  const getPageNumber = useCallback(() => current.current.pageNumber, []);
  const selection = usePdfSelection(session, pageNumber, props, getPageNumber);
  const navigate = useCallback((number: number) => {
    const state = current.current;
    if (!state.active || !state.session || !Number.isSafeInteger(number) || number < 1 || number > state.session.pageCount || number === state.pageNumber ||
      state.controlled && !state.props.onPageChange) return false;
    if (!state.controlled) { state.pageNumber = number; setNavigation({ loader: state.props.loadPdf, page: number }); }
    notifyPdfObserver(state.props.onPageChange, { pageNumber: number, pageCount: state.session.pageCount });
    return true;
  }, []);
  const { selectPage, selectPages, getSelectedPageNumbers } = selection;
  const goToPage = useCallback((number: number) => {
    const changed = navigate(number);
    if (changed) selectPage(number);
    return changed;
  }, [navigate, selectPage]);
  const selectAndNavigate = useCallback((number: number, options?: { extend?: boolean; toggle?: boolean }) => {
    const changed = navigate(number);
    return selectPage(number, options) || changed;
  }, [navigate, selectPage]);
  const setZoom = useCallback((value: number) => {
    const state = current.current;
    if (!state.active || !state.session || !Number.isFinite(value) || value < 25 || value > 400) return false;
    const next = Math.round(value);
    if (state.zoom === next) return false;
    state.zoom = next; updateZoom(next); notifyPdfObserver(state.props.onZoomChange, next); return true;
  }, []);
  useImperativeHandle(ref, () => ({ getPageNumber, goToPage, getSelectedPageNumbers, selectPages,
    getZoom: () => current.current.zoom, setZoom, fitToPage: () => setZoom(100) }), [getPageNumber, goToPage, getSelectedPageNumbers, selectPages, setZoom]);
  const notified = useRef(session);
  useEffect(() => { if (session && session !== notified.current) { notified.current = session; notifyPdfObserver(callbacks.current.onLoad, { pageCount: session.pageCount }); } }, [session]);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0 || !(event.target as Element)?.closest?.(".lxp-pdf-viewport") || !current.current.session) return;
      event.preventDefault(); setZoom(Math.max(25, Math.min(400, current.current.zoom + (event.deltaY > 0 ? -10 : 10))));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [ownerDocument, setZoom]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey ||
      (event.target as HTMLElement).closest?.("input,textarea,select,[contenteditable=true]")) return;
    const list = (event.target as HTMLElement).closest?.<HTMLElement>(".lxp-pdf-page-list");
    if (event.ctrlKey || event.metaKey) {
      if (session && list && event.key.toLowerCase() === "a") { event.preventDefault(); selectPages(Array.from({ length: pageCount }, (_, index) => index + 1)); }
      return;
    }
    const keys: Record<string, number> = { PageUp: pageNumber - 1, PageDown: pageNumber + 1, ArrowLeft: pageNumber - 1, ArrowRight: pageNumber + 1, Home: 1, End: pageCount };
    if (session && Object.hasOwn(keys, event.key)) {
      event.preventDefault();
      if (event.shiftKey) selectAndNavigate(keys[event.key], { extend: true }); else goToPage(keys[event.key]);
      (list ?? root.current)?.focus({ preventScroll: true });
    }
  };
  const [draft, setDraft] = useState({ page: 0, value: "" });
  const draftValue = draft.page === pageNumber ? draft.value : String(pageNumber || "");
  const submitPage = () => { goToPage(Number(draftValue)); setDraft({ page: current.current.pageNumber, value: String(current.current.pageNumber || "") }); };
  const pageLocked = !session || controlled && !props.onPageChange;
  const theme = useSlideTheme(props.colorMode, ownerDocument, props.primaryColor);
  const error = loaded?.error ?? (notice?.loader === props.loadPdf ? notice.error : undefined);
  return <div ref={attach} data-likex-slide="" data-likex-slide-pdf="" className={`lxp-root lxp-pdf-root ${props.className ?? ""}`}
    style={{ ...theme, ...props.style }} role="region" aria-label={props["aria-label"] ?? "PDF ビューアー"} tabIndex={-1} onKeyDown={keyDown}>
    <header className="lxp-titlebar"><div className="lxp-document-mark" aria-hidden="true"><FileText size={24} /></div>
      <span className="lxp-document-title">{props.title ?? "PDF"}</span><span className="lxp-titlebar-end lxp-pdf-view-label">PDF 閲覧</span><span className="lxp-title-context">LikeX</span>
    </header>
    {props.toolbarVisible !== false && <div className="lxp-pdf-toolbar" role="group" aria-label="PDFページ操作">
      <button type="button" aria-label="前のページ" disabled={pageLocked || pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}><ChevronLeft size={17} /></button>
      <label className="lxp-pdf-page-input"><span>ページ</span><input type="number" aria-label="ページ番号" min={1} max={pageCount || 1} step={1} disabled={pageLocked}
        value={draftValue} onChange={event => setDraft({ page: pageNumber, value: event.target.value })} onBlur={submitPage}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); submitPage(); } }} /><span>/ {pageCount}</span></label>
      <button type="button" aria-label="次のページ" disabled={pageLocked || pageNumber >= pageCount} onClick={() => goToPage(pageNumber + 1)}><ChevronRight size={17} /></button>
      <span className="lxp-pdf-toolbar-hint">閲覧専用</span>
    </div>}
    <div className="lxp-workspace">
      {session ? <><PdfFilmstrip session={session} pageNumber={pageNumber} selectedPageNumbers={selection.pages}
        disabled={pageLocked && props.selectedPageNumbers !== undefined && !props.onSelectionChange} selectPage={selectAndNavigate} onError={reportError} />
        <PdfViewport session={session} pageNumber={pageNumber} zoom={zoom} onError={reportError} /></>
        : <div className="lxp-pdf-placeholder" role={loaded?.error ? "alert" : "status"}>{loaded?.error ? loaded.error.message : <><Loader2 size={26} className="lxp-spin" /><span>PDFを読み込んでいます…</span></>}</div>}
    </div>
    <footer className="lxp-statusbar"><span>ページ {pageNumber} / {pageCount}</span><span>選択 {selection.pages.length} ページ</span>
      <div className="lxp-status-message" role="status" aria-live="polite">{error && <><span className="lxp-status-text lxp-error" title={error.message}>{error.message}</span>
        {!loaded?.error && <button type="button" aria-label="メッセージを閉じる" onClick={() => setNotice(null)}><X size={12} /></button>}</>}</div>
      <div className="lxp-zoom"><button type="button" aria-label="縮小" disabled={!session || zoom <= 25} onClick={() => setZoom(Math.max(25, zoom - 10))}><Minus size={14} /></button>
        <input type="range" min={25} max={400} step={5} aria-label="ズーム" disabled={!session} value={zoom} onChange={event => setZoom(Number(event.target.value))} />
        <button type="button" aria-label="拡大" disabled={!session || zoom >= 400} onClick={() => setZoom(Math.min(400, zoom + 10))}><Plus size={14} /></button><span>{zoom}%</span>
        <button type="button" aria-label="画面に合わせる" disabled={!session} onClick={() => setZoom(100)}><Maximize size={14} /></button>
      </div>
    </footer>
  </div>;
}
