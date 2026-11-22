"use client";

import { Unlink, Upload } from "lucide-react";
import type { SlideEditor } from "../state/use-slide-editor";
import { SlideLayoutGallery } from "./slide-layout-gallery";

/** Master libraries are reusable; choosing a thumbnail edits only the selected pages. */
export function SlideMasterControls({ editor, onImport, visible = true }: { editor: SlideEditor; onImport(): void; visible?: boolean }) {
  const pageIds = editor.selection.slideIds ?? [editor.selection.slideId];
  const hasLayout = editor.deck.slides.some(item => pageIds.includes(item.id) && item.layoutId);
  return <>
    {editor.features.import && !editor.readOnly && <button type="button" className="lxp-ribbon-action is-big" aria-label="マスターを読み込む" title="PowerPoint / テンプレート (.pptx / .potx) からマスターを読み込む" disabled={!editor.editable} onClick={onImport}><Upload size={23} /><span>マスターを読み込む</span></button>}
    <div className="lxp-ribbon-stack">
      {editor.features.formatting && <SlideLayoutGallery editor={editor} mode="apply" visible={visible} />}
      {editor.features.addSlides && <SlideLayoutGallery editor={editor} mode="add" visible={visible} />}
      {editor.features.formatting && <button type="button" className="lxp-ribbon-action" aria-label="レイアウトの継承を解除" title="見た目を保って、選択したスライドの通常の要素に変換" disabled={!editor.editable || !hasLayout} onClick={() => void editor.applyLayout(null)}><Unlink size={15} /><span>継承を解除</span></button>}
    </div>
    {!editor.deck.layouts?.length && <span className="lxp-layout-empty">PPTX / POTX を読み込むと、レイアウトを選べます。</span>}
  </>;
}
