"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getSlide } from "../model/query";
import { normalizeSlideDeck } from "../model/normalize";
import type { SlideDeck } from "../model/types";
import { useSlideTheme } from "../state/use-slide-theme";
import { SlideArtwork } from "./slide-artwork";
import { resolveSlidePageTarget, type SlidePageTarget } from "../state/slide-page-target";

export type SlideThumbnailProps = SlidePageTarget & {
  /** Parsed slide model. Replace its identity to update this preview. */
  deck: SlideDeck;
  title?: string;
  colorMode?: "light" | "dark" | "system";
  primaryColor?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  onError?: (error: Error) => void;
};

/** One page's artwork without an editing session, history, selection or navigation. */
export function LikeSlideThumbnail(props: SlideThumbnailProps) {
  const [ownerDocument, setOwnerDocument] = useState<Document | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => setOwnerDocument(node?.ownerDocument ?? null), []);
  const theme = useSlideTheme(props.colorMode, ownerDocument, props.primaryColor);
  const preview = useMemo(() => {
    let deck: SlideDeck | undefined;
    try {
      deck = normalizeSlideDeck(props.deck);
      const target = resolveSlidePageTarget(deck, { pageNumber: props.pageNumber, slideId: props.slideId });
      return { deck, slide: getSlide(deck, target.slideId)!, pageNumber: target.pageNumber, error: undefined };
    } catch (cause) {
      return { deck, slide: undefined, error: cause instanceof Error ? cause : new Error(String(cause)) };
    }
  }, [props.deck, props.pageNumber, props.slideId]);
  const observer = useRef(props.onError);
  useLayoutEffect(() => { observer.current = props.onError; });
  useEffect(() => {
    if (!preview.error) return;
    try { void Promise.resolve(observer.current?.(preview.error)).catch(() => {}); } catch { /* Keep invalid previews contained. */ }
  }, [preview.error]);
  const title = props.title ?? preview.deck?.title ?? "スライド";
  return <div ref={attach} data-likex-slide="" data-likex-thumbnail="slide"
    className={`lxp-root lxp-thumbnail-root ${props.className ?? ""}`} style={{ ...theme, ...props.style }}
    role="region" aria-label={props["aria-label"] ?? "スライドのサムネイル"}>
    <header className="lxp-titlebar"><div className="lxp-document-mark" aria-hidden="true">P</div>
      <span className="lxp-document-title">{title}</span><span className="lxp-title-context">LikeX</span>
    </header>
    <div className="lxp-thumbnail-content">
      {preview.deck && preview.slide ? <svg width="100%" height="100%" viewBox={`0 0 ${preview.deck.width} ${preview.deck.height}`}
        preserveAspectRatio="xMidYMid meet" style={{ maxWidth: preview.deck.width, maxHeight: preview.deck.height }}
        role="img" aria-label={`${title}の${preview.pageNumber}ページ目`}>
        <foreignObject width={preview.deck.width} height={preview.deck.height}>
          <div inert aria-hidden="true" className="lxp-thumbnail-art" style={{ width: preview.deck.width, height: preview.deck.height }}>
            <SlideArtwork deck={preview.deck} slide={preview.slide} />
          </div>
        </foreignObject>
      </svg> : <p className="lxp-thumbnail-error" role="alert">スライドをプレビューできません。</p>}
    </div>
  </div>;
}
