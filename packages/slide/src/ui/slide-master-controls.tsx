"use client";

import { useState } from "react";
import { CopyPlus, LayoutTemplate, Unlink, Upload } from "lucide-react";
import { getSlideLayouts, getSlideMasters } from "../model/index";
import type { SlideEditor } from "../state/use-slide-editor";

/** The catalog is reusable; applying a layout only edits the selected pages. */
export function SlideMasterControls({ editor, onImport }: { editor: SlideEditor; onImport(): void }) {
  const slide = editor.deck.slides.find(item => item.id === editor.selection.slideId);
  const masters = getSlideMasters(editor.deck), layouts = getSlideLayouts(editor.deck);
  const [choice, setChoice] = useState<{ slideId?: string; appliedLayoutId?: string; layoutId: string }>({ layoutId: "" });
  const chosen = choice.slideId === slide?.id && choice.appliedLayoutId === slide?.layoutId ? choice.layoutId : slide?.layoutId ?? "";
  const layoutId = layouts.some(item => item.id === chosen) ? chosen : slide?.layoutId ?? layouts[0]?.id ?? "";
  const pageIds = editor.selection.slideIds ?? [editor.selection.slideId];
  const hasLayout = editor.deck.slides.some(item => pageIds.includes(item.id) && item.layoutId);
  return <>
    {editor.features.import && !editor.readOnly && <button type="button" className="lxp-ribbon-action is-big" aria-label="マスターを読み込む" title="PowerPoint / テンプレート (.pptx / .potx) からマスターを読み込む" disabled={!editor.editable} onClick={onImport}><Upload size={23} /><span>マスターを読み込む</span></button>}
    <div className="lxp-ribbon-stack">
      <select className="lxp-layout-select" aria-label="スライドのレイアウト" value={layoutId} disabled={!editor.editable || !layouts.length || (!editor.features.formatting && !editor.features.addSlides)} onChange={event => setChoice({ slideId: slide?.id, appliedLayoutId: slide?.layoutId, layoutId: event.target.value })}>
        {!layouts.length && <option value="">レイアウトなし</option>}
        {masters.map(master => <optgroup key={master.id} label={master.name}>{layouts.filter(layout => layout.masterId === master.id).map(layout => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</optgroup>)}
      </select>
      {layouts.length ? <div className="lxp-ribbon-row">
        {editor.features.formatting && <button type="button" className="lxp-ribbon-action" aria-label="選択したスライドにレイアウトを適用" title={`${pageIds.length}枚のスライドに適用`} disabled={!editor.editable || !slide || !layoutId} onClick={() => void editor.applyLayout(layoutId)}><LayoutTemplate size={15} /><span>{pageIds.length > 1 ? `${pageIds.length}枚に適用` : "適用"}</span></button>}
        {editor.features.addSlides && <button type="button" className="lxp-ribbon-action" aria-label="このレイアウトで新しいスライド" disabled={!editor.editable || !layoutId} onClick={() => void editor.execute({ type: "slide.add", afterId: slide?.id, layoutId })}><CopyPlus size={15} /><span>新しいスライド</span></button>}
        {editor.features.formatting && <button type="button" className="lxp-ribbon-action" aria-label="レイアウトの継承を解除" title="見た目を保って、選択したスライドの通常の要素に変換" disabled={!editor.editable || !hasLayout} onClick={() => void editor.applyLayout(null)}><Unlink size={15} /><span>継承を解除</span></button>}
      </div> : <span className="lxp-layout-empty">PPTX / POTX を読み込むと、レイアウトを選べます。</span>}
    </div>
  </>;
}
