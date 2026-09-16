import { useCallback, useRef, useState } from "react";
import LikeSlide, { parseSlideDeck, serializeSlideDeck, type SlideDeck } from "@likex/slide";
import "../../../packages/slide/src/styles.css";
import { createDemoSlideDeck } from "./demo/slide-deck";

export default function SlideDemo() {
  const [initialDeck] = useState(createDemoSlideDeck);
  const saved = useRef(serializeSlideDeck(initialDeck));
  const save = useCallback((deck: SlideDeck) => {
    saved.current = serializeSlideDeck(deck);
    return parseSlideDeck(saved.current);
  }, []);
  return <LikeSlide initialDeck={initialDeck} onSave={save} colorMode="system"
    exportFileName="LikeSlide_プロジェクト計画.pptx" style={{ height: "100dvh", width: "100%" }} />;
}
