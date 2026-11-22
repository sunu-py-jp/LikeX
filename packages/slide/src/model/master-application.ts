import type { SlideDeck, SlideMasterApplication } from "./types";
import { normalizeSlideDeck, normalizeSlideMasterLibrary } from "./normalize";
import { applySlideLayout, importSlideMasterLibrary } from "./layouts";
import { sameSlideDeck } from "./query";
import { identifier, record } from "./validation";

export type SlideMasterApplicationResult = { deck: SlideDeck; masterIds?: string[]; layoutIds?: string[] };

/** IDs are document-local, deterministic for SSR, and never reuse stored IDs. */
function applicationIds(deck: SlideDeck): () => string {
  const reserved = new Set([deck.id]);
  for (const slide of deck.slides) {
    reserved.add(slide.id);
    for (const element of slide.elements) reserved.add(element.id);
    for (const animation of slide.animations ?? []) {
      reserved.add(animation.id);
      if (animation.timelineId) reserved.add(animation.timelineId);
    }
  }
  for (const master of deck.masters ?? []) {
    reserved.add(master.id);
    for (const element of master.elements) reserved.add(element.id);
  }
  for (const layout of deck.layouts ?? []) {
    reserved.add(layout.id);
    for (const element of layout.elements) reserved.add(element.id);
    for (const slot of layout.placeholders) { reserved.add(slot.id); reserved.add(slot.element.id); }
  }
  // This compact, stable seed is an identifier namespace, not a security hash.
  let seed = 2166136261;
  for (let index = 0; index < deck.id.length; index++) seed = Math.imul(seed ^ deck.id.charCodeAt(index), 16777619) >>> 0;
  const prefix = `applied-master-${seed.toString(16)}-`;
  let index = 0;
  return () => {
    let id;
    do { id = `${prefix}${++index}`; } while (reserved.has(id));
    reserved.add(id);
    return id;
  };
}

/** Builds the complete initial/updated deck privately. Invalid targets, locks or
 * capacity limits never leave an imported catalog or partially changed pages.
 * Repeating the same input produces the same generated IDs for SSR hydration. */
export function applySlideMaster(deck: SlideDeck, application: SlideMasterApplication): SlideMasterApplicationResult {
  const source = normalizeSlideDeck(deck);
  const raw = record(application, "マスターの適用設定", ["library", "layoutId", "layoutsBySlideId"]);
  const library = raw.library === undefined ? undefined : normalizeSlideMasterLibrary(raw.library);
  const available = new Set((library?.layouts ?? source.layouts ?? []).map(layout => layout.id));
  const requireLayout = (value: unknown) => {
    const id = identifier(value);
    if (!available.has(id)) throw new Error(`適用するレイアウトが見つかりません: ${id}`);
    return id;
  };
  const defaultLayout = requireLayout(raw.layoutId);
  const overrides = new Map<string, string | null>();
  if (raw.layoutsBySlideId !== undefined) {
    const values = record(raw.layoutsBySlideId, "ページ別のレイアウト", source.slides.map(slide => slide.id));
    for (const id of Object.getOwnPropertyNames(values)) {
      const value = values[id];
      overrides.set(id, value === null ? null : requireLayout(value));
    }
  }
  const createId = applicationIds(source);
  const imported = library ? importSlideMasterLibrary(source, library, createId) : undefined;
  const base = imported?.deck ?? source;
  const remap = library && imported ? new Map(library.layouts.map((layout, index) => [layout.id, imported.layoutIds[index]])) : undefined;
  const slides = base.slides.map(slide => {
    const layoutId = overrides.has(slide.id) ? overrides.get(slide.id)! : defaultLayout;
    return layoutId === null ? slide : applySlideLayout(base, slide, remap?.get(layoutId) ?? layoutId, createId);
  });
  const applied = normalizeSlideDeck({ ...base, slides });
  return Object.freeze({ deck: sameSlideDeck(source, applied) ? source : applied,
    ...(imported ? { masterIds: imported.masterIds, layoutIds: imported.layoutIds } : {}) });
}
