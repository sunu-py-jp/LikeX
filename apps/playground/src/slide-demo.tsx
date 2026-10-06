import { useCallback, useRef, useState } from "react";
import LikeSlide, { parseSlideDeck, serializeSlideDeck, type SlideDeck } from "@likex/slide";
import "../../../packages/slide/src/styles.css";
import { createDemoSlideDeck } from "./demo/slide-deck";
import { getDemoComponentTheme } from "./demo/component-theme";

export default function SlideDemo() {
  const [initialDeck] = useState(createDemoSlideDeck);
  const [target] = useState(() => { const query = new URLSearchParams(window.location.search); return {
    initialPageNumber: query.has("page") ? Number(query.get("page")) : undefined,
    initialSlideId: query.get("slideId") ?? undefined,
  }; });
  const [theme] = useState(() => getDemoComponentTheme("system"));
  const saved = useRef(serializeSlideDeck(initialDeck));
  const save = useCallback((deck: SlideDeck) => {
    saved.current = serializeSlideDeck(deck);
    return parseSlideDeck(saved.current);
  }, []);
  return <LikeSlide initialDeck={initialDeck} onSave={save} {...theme} {...target}
    exportFileName="LikeSlide_プロジェクト計画.pptx" style={{ height: "100dvh", width: "100%" }} />;
}
