import type { SlideElement, SlideLayout, SlideMaster } from "./types";
import { normalizeSlideElement } from "./normalize";
import { resolveSlideLines, isSlideLine } from "./lines";
import { boolean, color, identifier, list, record, text } from "./validation";
import { SLIDE_LIMITS } from "./limits";
import { LAYOUT_KEYS, MASTER_KEYS } from "./schema";

function decorations(value: unknown): SlideElement[] {
  const elements = list(value, "マスターの要素", SLIDE_LIMITS.elementsPerSlide).map(element => normalizeSlideElement(element));
  if (elements.some(element => element.layoutPlaceholderId !== undefined)) throw new Error("マスター装飾にページ用のプレースホルダー参照は指定できません");
  if (new Set(elements.map(element => element.id)).size !== elements.length) throw new Error("マスター要素のIDが重複しています");
  return Object.freeze(resolveSlideLines(elements).map(element => normalizeSlideElement(element, elements))) as unknown as SlideElement[];
}

/** Catalogs own separate immutable decorations; page-local elements never become their targets. */
export function normalizeMasterCatalog(input: { masters?: unknown; layouts?: unknown }): { masters?: SlideMaster[]; layouts?: SlideLayout[] } {
  const masters = input.masters === undefined ? undefined : list(input.masters, "マスター", SLIDE_LIMITS.masters).map(value => {
    const raw = record(value, "マスター", MASTER_KEYS);
    return Object.freeze({ id: identifier(raw.id), name: text(raw.name, "マスター名", 1000), background: color(raw.background, "マスター背景"), elements: decorations(raw.elements) });
  });
  const masterIds = new Set(masters?.map(master => master.id));
  if (masterIds.size !== masters?.length && masters !== undefined) throw new Error("マスターIDが重複しています");
  const layouts = input.layouts === undefined ? undefined : list(input.layouts, "レイアウト", SLIDE_LIMITS.layouts).map(value => {
    const raw = record(value, "レイアウト", LAYOUT_KEYS), masterId = identifier(raw.masterId);
    if (!masterIds.has(masterId)) throw new Error("レイアウトのマスターが見つかりません");
    const placeholders = list(raw.placeholders, "プレースホルダー", SLIDE_LIMITS.elementsPerSlide).map(value => {
      const slot = record(value, "プレースホルダー", ["id", "kind", "element"]), element = normalizeSlideElement(slot.element);
      if (element.layoutPlaceholderId !== undefined || isSlideLine(element)) throw new Error("プレースホルダーの雛形に線やページ用の参照は指定できません");
      return Object.freeze({ id: identifier(slot.id), kind: text(slot.kind, "プレースホルダーの種類", 100, false), element });
    });
    if (new Set(placeholders.map(slot => slot.id)).size !== placeholders.length) throw new Error("プレースホルダーIDが重複しています");
    return Object.freeze({ id: identifier(raw.id), masterId, name: text(raw.name, "レイアウト名", 1000), elements: decorations(raw.elements),
      placeholders: Object.freeze(placeholders) as unknown as typeof placeholders,
      ...(raw.background !== undefined ? { background: color(raw.background, "レイアウト背景") } : {}),
      ...(raw.showMasterShapes !== undefined ? { showMasterShapes: boolean(raw.showMasterShapes, "マスター図形の表示") } : {}) });
  });
  if (layouts && new Set(layouts.map(layout => layout.id)).size !== layouts.length) throw new Error("レイアウトIDが重複しています");
  for (const layout of layouts ?? []) {
    const inherited = layout.showMasterShapes === false ? 0 : masters!.find(master => master.id === layout.masterId)!.elements.length;
    if (inherited + layout.elements.length + layout.placeholders.length > SLIDE_LIMITS.elementsPerSlide) throw new Error("継承した要素を含むレイアウトの要素数が上限を超えています");
  }
  return { ...(masters ? { masters: Object.freeze(masters) as unknown as SlideMaster[] } : {}),
    ...(layouts ? { layouts: Object.freeze(layouts) as unknown as SlideLayout[] } : {}) };
}
