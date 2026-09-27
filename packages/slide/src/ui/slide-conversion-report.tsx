"use client";

import { ArrowUpRight, X } from "lucide-react";
import type { SlideEditor } from "../state/use-slide-editor";
import type { SlidePptxDiagnostic } from "../office/types";

const actionLabel = { approximation: "近似", omission: "省略", adjustment: "調整" };

/** Conversion details are view state. Selecting a target never edits its data. */
export function SlideConversionReport({ editor, onClose }: { editor: SlideEditor; onClose(): void }) {
  const report = editor.conversionReport;
  if (!report) return null;
  const groups = new Map<string, { title: string; items: SlidePptxDiagnostic[] }>();
  for (const diagnostic of report.diagnostics) {
    const key = diagnostic.slideId ?? String(diagnostic.slideIndex ?? "document");
    const group = groups.get(key) ?? { title: diagnostic.slideIndex === undefined ? "資料全体" : `${diagnostic.slideIndex + 1}ページ${diagnostic.slideName ? ` · ${diagnostic.slideName}` : ""}`, items: [] };
    group.items.push(diagnostic); groups.set(key, group);
  }
  return <aside className="lxp-conversion-report" aria-label="PowerPointの変換結果" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    // Reading, scrolling and copying this report must not move or edit the
    // selected canvas object. Keep the editor's save/history shortcuts available.
    if (!((event.ctrlKey || event.metaKey) && ["s", "z", "y"].includes(event.key.toLowerCase()))) event.stopPropagation();
  }}>
    <header><h2>変換結果</h2><button type="button" aria-label="変換結果を閉じる" onClick={onClose}><X size={16} /></button></header>
    <p className="lxp-conversion-summary">最後のPowerPoint{report.phase === "import" ? "読み込み" : "書き出し"} · {report.diagnostics.length}件</p>
    <div className="lxp-conversion-list" tabIndex={0} aria-label="変換の注意点一覧">
      {!report.diagnostics.length && <p>近似・省略の通知はありません。</p>}
      {[...groups].map(([key, group]) => <section key={key}><h3>{group.title}</h3><ul>{group.items.map((diagnostic, index) => {
        const slide = diagnostic.slideId ? editor.deck.slides.find(slide => slide.id === diagnostic.slideId) : undefined;
        const element = slide?.elements.find(element => element.id === diagnostic.elementId);
        return <li key={index}>
          <div className="lxp-conversion-item-heading"><span className={`lxp-conversion-action lxp-conversion-${diagnostic.action}`}>{actionLabel[diagnostic.action]}</span>
            <span>{diagnostic.elementName ?? (diagnostic.elementId ? "オブジェクト" : "ページ")}{diagnostic.property ? ` · ${diagnostic.property}` : ""}</span>
            {slide && <button type="button" title="対象を選択" aria-label={`${group.title}${diagnostic.elementName ? ` ${diagnostic.elementName}` : ""}を選択`} onClick={() => editor.select({ slideId: slide.id, elementIds: element ? [element.id] : [] })}><ArrowUpRight size={15} /></button>}
          </div>
          <p>{diagnostic.message}</p>
          {(diagnostic.animationId || diagnostic.timelineId || diagnostic.timingId) && <small>{[diagnostic.timelineId && `系列: ${diagnostic.timelineId}`, diagnostic.animationId && `動き: ${diagnostic.animationId}`, diagnostic.timingId && `PPTX ID: ${diagnostic.timingId}`].filter(Boolean).join(" · ")}</small>}
        </li>;
      })}</ul></section>)}
    </div>
  </aside>;
}
