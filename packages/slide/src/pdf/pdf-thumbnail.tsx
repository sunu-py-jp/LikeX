"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useSlideTheme } from "../state/use-slide-theme";
import { PdfPageCanvas, usePdfPage } from "./pdf-page-canvas";
import { notifyPdfObserver, usePdfDocument, type PdfSession } from "./use-pdf-document";
import type { SlidePdfLoader } from "./types";

export type SlidePdfThumbnailProps = {
  /** Keep the loader stable for the same PDF. This component owns and destroys its loaded document. */
  loadPdf: SlidePdfLoader;
  /** One-based page number, default 1. Invalid or out-of-range values show an error rather than being clamped. */
  pageNumber?: number;
  title?: string;
  colorMode?: "light" | "dark" | "system";
  primaryColor?: string;
  className?: string;
  /** Default height: 280px. The requested page fits inside the remaining area without enlarging above scale 1. */
  style?: CSSProperties;
  "aria-label"?: string;
  onError?: (error: Error) => void;
};

function PdfThumbnailPage({ session, pageNumber, onError }: { session: PdfSession; pageNumber: number; onError(error: Error): void }) {
  const [error, setError] = useState<Error | null>(null);
  const current = useRef({ active: false, onError });
  useLayoutEffect(() => { current.current = { active: true, onError }; });
  useLayoutEffect(() => () => { current.current.active = false; }, []);
  const reportError = useCallback((failure: Error) => {
    if (!current.current.active) return;
    setError(failure); current.current.onError(failure);
  }, []);
  const result = usePdfPage(session, pageNumber, reportError), page = result?.page;
  if (error) return <div className="lxp-pdf-placeholder" role="alert">{error.message}</div>;
  return <div className="lxp-pdf-thumbnail-viewport">
    {page ? <svg className="lxp-pdf-thumbnail-page" viewBox={`0 0 ${page.width} ${page.height}`} width={page.width} height={page.height}
      style={{ maxWidth: page.width, maxHeight: page.height }} preserveAspectRatio="xMidYMid meet" role="presentation">
      <foreignObject width={page.width} height={page.height}><div className="lxp-pdf-thumbnail-paper">
        <PdfPageCanvas page={page} width={page.width} height={page.height} label={`PDFページ ${pageNumber}`} thumbnail onError={reportError} />
      </div></foreignObject>
    </svg> : <div className="lxp-pdf-placeholder" role="status"><Loader2 size={22} className="lxp-spin" /><span>ページを読み込んでいます…</span></div>}
  </div>;
}

/** Compact, read-only preview of one PDF page; no viewer controls or editing state. */
export function LikeSlidePdfThumbnail(props: SlidePdfThumbnailProps) {
  const [ownerDocument, setOwnerDocument] = useState<Document | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { setOwnerDocument(node?.ownerDocument ?? null); }, []);
  const callbacks = useRef(props);
  useLayoutEffect(() => { callbacks.current = props; });
  const reportError = useCallback((error: Error) => {
    notifyPdfObserver(callbacks.current.onError, error);
  }, []);
  const loaded = usePdfDocument(props.loadPdf, undefined, reportError);
  const pageNumber = props.pageNumber === undefined ? 1 : props.pageNumber;
  const validNumber = Number.isSafeInteger(pageNumber) && pageNumber > 0;
  const validationMessage = !validNumber ? "PDFのページ番号は1以上の整数で指定してください。"
    : loaded?.session && pageNumber > loaded.session.pageCount ? `PDFのページ番号は1〜${loaded.session.pageCount}の範囲で指定してください。` : undefined;
  const validation = useMemo(() => ({ pageNumber, error: validationMessage ? new Error(validationMessage) : undefined }), [validationMessage, pageNumber]);
  useEffect(() => { if (validation.error) reportError(validation.error); }, [validation, reportError]);
  const error = loaded?.error ?? validation.error;
  const theme = useSlideTheme(props.colorMode, ownerDocument, props.primaryColor);
  return <div ref={attach} data-likex-slide="" data-likex-slide-pdf-thumbnail=""
    className={`lxp-root lxp-pdf-root lxp-pdf-thumbnail-root ${props.className ?? ""}`} style={{ ...theme, ...props.style }}
    role="region" aria-label={props["aria-label"] ?? `${props.title ?? "PDF"}のサムネイル`}>
    <header className="lxp-titlebar"><div className="lxp-document-mark" aria-hidden="true"><FileText size={24} /></div>
      <span className="lxp-document-title">{props.title ?? "PDF"}</span><span className="lxp-titlebar-end lxp-pdf-view-label">{validNumber ? `${pageNumber}ページ目` : "ページを表示できません"}</span>
    </header>
    {error ? <div className="lxp-pdf-placeholder" role="alert">{error.message}</div>
      : loaded?.session ? <PdfThumbnailPage key={pageNumber} session={loaded.session} pageNumber={pageNumber} onError={reportError} />
        : <div className="lxp-pdf-placeholder" role="status"><Loader2 size={22} className="lxp-spin" /><span>PDFを読み込んでいます…</span></div>}
  </div>;
}
