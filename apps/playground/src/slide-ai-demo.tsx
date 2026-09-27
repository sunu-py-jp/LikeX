import { useState } from "react";
import LikeSlide, { parseSlideDeck, serializeSlideDeck, type SlideHandle } from "@likex/slide";
import "../../../packages/slide/src/styles.css";
import { createDemoSlideDeck } from "./demo/slide-deck";
import { getDemoComponentTheme } from "./demo/component-theme";
import { createSlideAIAdapter } from "./ai/slide-ai-adapter";
import { AIWorkspace } from "./ai/ai-workspace";

function createDemoHost() {
    let handle: SlideHandle | null = null, revision = 0;
    return {
      attach: (value: SlideHandle | null) => { handle = value; },
      changed: () => { revision++; },
      adapter: createSlideAIAdapter(() => {
        if (!handle) throw new Error("スライドが閉じられました。");
        return handle;
      }, () => revision),
    };
}

export default function SlideAIDemo() {
  const [initialDeck] = useState(createDemoSlideDeck), [theme] = useState(() => getDemoComponentTheme("system"));
  const [{ adapter, attach, changed }] = useState(createDemoHost);
  return <AIWorkspace adapter={adapter} {...theme}><LikeSlide ref={attach} {...theme} initialDeck={initialDeck} title="LikeSlide AIデモ" onSave={deck => parseSlideDeck(serializeSlideDeck(deck))} onChange={changed} exportFileName="LikeSlide_AIスライド.pptx" style={{ height: "100%", width: "100%" }} aria-label="AIで編集するスライド"/></AIWorkspace>;
}
