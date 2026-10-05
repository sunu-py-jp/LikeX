"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { PdfPageCanvas, usePdfPage } from "./pdf-page-canvas";
import type { PdfSession } from "./use-pdf-document";

const ROW_HEIGHT = 154, OVERSCAN = 2;
function Thumbnail({ session, pageNumber, onError }: { session: PdfSession; pageNumber: number; onError(error: Error): void }) {
  const result = usePdfPage(session, pageNumber, onError), page = result?.page;
  const scale = page ? Math.min(156 / page.width, 116 / page.height) : 1;
  return <span className="lxp-pdf-thumbnail-art" aria-hidden="true">{page
    ? <PdfPageCanvas page={page} width={page.width * scale} height={page.height * scale} label={`PDFページ ${pageNumber} のサムネイル`} thumbnail onError={onError} />
    : <span>{result?.error ? "表示できません" : pageNumber}</span>}</span>;
}

export function PdfFilmstrip({ session, pageNumber, selectedPageNumbers, disabled, selectPage, onError }: {
  session: PdfSession; pageNumber: number; selectedPageNumbers: readonly number[]; disabled: boolean;
  selectPage(page: number, options?: { extend?: boolean; toggle?: boolean }): boolean; onError(error: Error): void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [range, setRange] = useState({ top: 0, height: 600 });
  const update = useCallback(() => { const node = list.current; if (node) setRange(previous => {
    const next = { top: node.scrollTop, height: node.clientHeight || 600 };
    return next.top === previous.top && next.height === previous.height ? previous : next;
  }); }, []);
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    update();
    const Observer = node.ownerDocument.defaultView?.ResizeObserver;
    const observer = Observer ? new Observer(update) : undefined; observer?.observe(node);
    return () => observer?.disconnect();
  }, [update]);
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const top = (pageNumber - 1) * ROW_HEIGHT, bottom = top + ROW_HEIGHT, height = node.clientHeight || 600;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bottom > node.scrollTop + height) node.scrollTop = bottom - height;
    update();
  }, [pageNumber, session, update]);
  const start = Math.max(0, Math.floor(range.top / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(session.pageCount, Math.ceil((range.top + range.height) / ROW_HEIGHT) + OVERSCAN);
  const items = Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index + 1);
  return <aside className="lxp-filmstrip lxp-pdf-filmstrip" aria-label="PDFページ一覧">
    <div className="lxp-filmstrip-heading"><span>ページ</span><span>{session.pageCount}</span></div>
    <ol ref={list} className="lxp-pdf-page-list" onScroll={update} aria-label="PDFページの選択" tabIndex={0}>
      <li aria-hidden="true" className="lxp-pdf-list-spacer" style={{ height: session.pageCount * ROW_HEIGHT }} />
      {items.map(number => <li key={number} className={`lxp-pdf-page-item${selectedPageNumbers.includes(number) ? " is-selected" : ""}${number === pageNumber ? " is-active" : ""}`}
        style={{ top: (number - 1) * ROW_HEIGHT, height: ROW_HEIGHT }} aria-posinset={number} aria-setsize={session.pageCount}>
        <button type="button" className="lxp-pdf-thumbnail" aria-label={`PDFページ ${number} を表示`} aria-current={number === pageNumber ? "page" : undefined}
          aria-pressed={selectedPageNumbers.includes(number)} tabIndex={number === pageNumber ? 0 : -1}
          disabled={disabled} onClick={event => selectPage(number, { extend: event.shiftKey, toggle: event.ctrlKey || event.metaKey })}>
          <Thumbnail session={session} pageNumber={number} onError={onError} /><span className="lxp-pdf-page-caption">{number}</span>
        </button>
      </li>)}
    </ol>
  </aside>;
}
