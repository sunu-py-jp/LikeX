"use client";

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useSlideTheme } from "../state/use-slide-theme";
import { PdfPageCanvas, usePdfPage } from "./pdf-page-canvas";
import { notifyPdfObserver, usePdfDocument, type PdfSession } from "./use-pdf-document";
import type { SlidePdfLoader } from "./types";

export type SlidePdfThumbnailProps = {
  /** Keep the loader stable for the same PDF. This component owns and destroys its loaded document. */
  loadPdf: SlidePdfLoader;
  title?: string;
  colorMode?: "light" | "dark" | "system";
  primaryColor?: string;
  className?: string;
  /** Default height: 280px. The first page fits inside the remaining area without enlarging above scale 1. */
  style?: CSSProperties;
  "aria-label"?: string;
  onError?: (error: Error) => void;
};

function PdfThumbnailPage({ session, onError }: { session: PdfSession; onError(error: Error): void }) {
  const result = usePdfPage(session, 1, onError), page = result?.page;
  return <div className="lxp-pdf-thumbnail-viewport">
    {page ? <svg className="lxp-pdf-thumbnail-page" viewBox={`0 0 ${page.width} ${page.height}`} width={page.width} height={page.height}
      style={{ maxWidth: page.width, maxHeight: page.height }} preserveAspectRatio="xMidYMid meet" role="presentation">
      <foreignObject width={page.width} height={page.height}><div className="lxp-pdf-thumbnail-paper">
        <PdfPageCanvas page={page} width={page.width} height={page.height} label="PDFページ 1" thumbnail onError={onError} />
      </div></foreignObject>
    </svg> : <div className="lxp-pdf-placeholder" role="status"><Loader2 size={22} className="lxp-spin" /><span>ページを読み込んでいます…</span></div>}
  </div>;
}

/** Compact, read-only preview of the first PDF page; no viewer controls or editing state. */
export function LikeSlidePdfThumbnail(props: SlidePdfThumbnailProps) {
  const [ownerDocument, setOwnerDocument] = useState<Document | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { setOwnerDocument(node?.ownerDocument ?? null); }, []);
  const [notice, setNotice] = useState<{ loader: SlidePdfLoader; error: Error } | null>(null);
  const callbacks = useRef(props);
  useLayoutEffect(() => { callbacks.current = props; });
  const reportError = useCallback((error: Error) => {
    setNotice({ loader: callbacks.current.loadPdf, error });
    notifyPdfObserver(callbacks.current.onError, error);
  }, []);
  const loaded = usePdfDocument(props.loadPdf, undefined, reportError);
  const error = loaded?.error ?? (notice?.loader === props.loadPdf ? notice.error : undefined);
  const theme = useSlideTheme(props.colorMode, ownerDocument, props.primaryColor);
  return <div ref={attach} data-likex-slide="" data-likex-slide-pdf-thumbnail=""
    className={`lxp-root lxp-pdf-root lxp-pdf-thumbnail-root ${props.className ?? ""}`} style={{ ...theme, ...props.style }}
    role="region" aria-label={props["aria-label"] ?? `${props.title ?? "PDF"}のサムネイル`}>
    <header className="lxp-titlebar"><div className="lxp-document-mark" aria-hidden="true"><FileText size={24} /></div>
      <span className="lxp-document-title">{props.title ?? "PDF"}</span><span className="lxp-titlebar-end lxp-pdf-view-label">1ページ目</span>
    </header>
    {error ? <div className="lxp-pdf-placeholder" role="alert">{error.message}</div>
      : loaded?.session ? <PdfThumbnailPage session={loaded.session} onError={reportError} />
        : <div className="lxp-pdf-placeholder" role="status"><Loader2 size={22} className="lxp-spin" /><span>PDFを読み込んでいます…</span></div>}
  </div>;
}
