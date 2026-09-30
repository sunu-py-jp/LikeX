import { useState } from "react";
import LikeSlide, { applySlideCommands, createSlideDeck, parseSlideDeck, serializeSlideDeck, type SlideDeck, type SlideHandle } from "@likex/slide";
import "../../../packages/slide/src/styles.css";
import { createDemoSlideDeck } from "./demo/slide-deck";
import { getDemoComponentTheme } from "./demo/component-theme";
import { createSlideAIAdapter } from "./ai/slide-ai-adapter";
import { AIWorkspace } from "./ai/ai-workspace";
import { DemoDocumentLibrary } from "./ai/demo-document-library";
import { DemoDocumentEditor } from "./ai/demo-document-editor";
import { useDemoDocumentRecord } from "./ai/use-demo-document-record";
import type { DemoDocumentRecord } from "./ai/demo-document-store";

type Theme = ReturnType<typeof getDemoComponentTheme>;
function createDemoHost() {
  let handle: SlideHandle | null = null, revision = 0;
  const current = () => {
    if (!handle) throw new Error("スライドが閉じられました。");
    return handle;
  };
  return {
    attach: (value: SlideHandle | null) => { handle = value; },
    changed: () => { revision++; },
    save: () => current().save(),
    adapter: createSlideAIAdapter(current, () => revision),
  };
}
async function createDocument(title: string, source: "blank" | "sample") {
  const deck = source === "sample" ? applySlideCommands(createDemoSlideDeck(), { type: "deck.rename", title }).deck : createSlideDeck({ title });
  return { document: serializeSlideDeck(deck), itemCount: deck.slides.length };
}
function SlideDocument({ initial, deck, theme, onBack }: { initial: DemoDocumentRecord; deck: SlideDeck; theme: Theme; onBack(): void }) {
  const [{ adapter, attach, changed, save }] = useState(createDemoHost);
  const [dirty, setDirty] = useState(false), [aiBusy, setAIBusy] = useState(false);
  const { record, persist, isSaving } = useDemoDocumentRecord(initial);
  return <DemoDocumentEditor title={record.title} kind="slide" {...theme} dirty={dirty} busy={aiBusy || isSaving} onSave={save} onBack={onBack}>
    <AIWorkspace adapter={adapter} {...theme} onBusyChange={setAIBusy}>
      <LikeSlide ref={attach} {...theme} initialDeck={deck} title={record.title}
        onSave={async current => {
          const document = serializeSlideDeck(current);
          await persist(document, current.title, current.slides.length);
          return parseSlideDeck(document);
        }} onChange={changed} onDirtyChange={setDirty}
        exportFileName={record.title} style={{ height: "100%", width: "100%" }} aria-label="AIで編集するスライド"/>
    </AIWorkspace>
  </DemoDocumentEditor>;
}

export default function SlideAIDemo() {
  const [theme] = useState(() => getDemoComponentTheme("system"));
  const [opened, setOpened] = useState<{ record: DemoDocumentRecord; deck: SlideDeck } | null>(null);
  if (opened) return <SlideDocument key={opened.record.id} initial={opened.record} deck={opened.deck} theme={theme} onBack={() => setOpened(null)}/>;
  return <DemoDocumentLibrary kind="slide" label="スライド" {...theme} createDocument={createDocument}
    onOpen={record => { const deck = parseSlideDeck(record.document); setOpened({ record, deck }); }}/>;
}
