import type { Slide, SlideDeck, SlideElement, SlideMaster, SlideLayout } from "./types";
import { SLIDE_LIMITS } from "./limits";
import { DECK_KEYS, ELEMENT_KEYS, SLIDE_KEYS, MASTER_KEYS, LAYOUT_KEYS } from "./schema";
import { list, number, record } from "./validation";

/** An element in a .slon file; stackOrder is back-to-front, zero-based within its page. */
export type SlideFileElement = SlideElement & { stackOrder: number };
export type SlideFilePage = Omit<Slide, "elements"> & { elements: SlideFileElement[] };
export type SlideFileMaster = Omit<SlideMaster, "elements"> & { elements: SlideFileElement[] };
export type SlideFileLayout = Omit<SlideLayout, "elements"> & { elements: SlideFileElement[] };
/** Native version 1 storage format; unlike the editing model, each element has explicit stacking. */
export type SlideFile = Omit<SlideDeck, "format" | "version" | "slides" | "masters" | "layouts"> & {
  format: "likex.slide";
  version: 1;
  slides: SlideFilePage[];
  masters?: SlideFileMaster[];
  layouts?: SlideFileLayout[];
};

const storeElements = (elements: readonly SlideElement[]): SlideFileElement[] => elements.map((element, stackOrder) => ({ ...element, stackOrder }))
  .sort((left, right) => left.y - right.y || left.x - right.x || left.stackOrder - right.stackOrder);

/** Converts a validated runtime deck without changing its page or stacking order. */
export function toSlideFile(deck: SlideDeck): SlideFile {
  const { masters, layouts, ...content } = deck;
  return { ...content, format: "likex.slide", version: 1, slides: deck.slides.map(slide => ({
    ...slide,
    elements: storeElements(slide.elements),
  })), ...(masters ? { masters: masters.map(master => ({ ...master, elements: storeElements(master.elements) })) } : {}),
    ...(layouts ? { layouts: layouts.map(layout => ({ ...layout, elements: storeElements(layout.elements) })) } : {}) };
}

/** Validate the file envelope and restore drawing order before runtime model validation. */
export function restoreSlideFile(input: unknown): Record<string, unknown> {
  const raw = record(input, "プレゼンテーション", DECK_KEYS);
  if (raw.format !== "likex.slide") throw new Error("LikeSlideのファイル形式ではありません");
  if (raw.version !== 1) throw new Error("対応していないプレゼンテーションのバージョンです");
  return { ...raw, slides: list(raw.slides, "スライド", SLIDE_LIMITS.slides, 1).map(restoreSlideFilePage),
    ...(raw.masters !== undefined ? { masters: list(raw.masters, "マスター", SLIDE_LIMITS.masters).map(value => {
      const master = record(value, "マスター", MASTER_KEYS); return { ...master, elements: restoreElements(master.elements) };
    }) } : {}),
    ...(raw.layouts !== undefined ? { layouts: list(raw.layouts, "レイアウト", SLIDE_LIMITS.layouts).map(value => {
      const layout = record(value, "レイアウト", LAYOUT_KEYS); return { ...layout, elements: restoreElements(layout.elements) };
    }) } : {}) };
}

/** Wire-only fields never enter editor state. */
function restoreSlideFilePage(input: unknown): Record<string, unknown> {
  const raw = record(input, "スライド", SLIDE_KEYS);
  return { ...raw, elements: restoreElements(raw.elements) };
}
function restoreElements(input: unknown): Record<string, unknown>[] {
  const entries = list(input, "スライドの要素", SLIDE_LIMITS.elementsPerSlide);
  const restored: Record<string, unknown>[] = new Array(entries.length);
  for (const entry of entries) {
    const element = record(entry, "保存形式の要素", [...ELEMENT_KEYS.text, ...ELEMENT_KEYS.shape, ...ELEMENT_KEYS.image, "stackOrder"]);
    const stackOrder = number(element.stackOrder, "要素の重なり順", 0, entries.length - 1, true);
    if (Object.hasOwn(restored, stackOrder)) throw new Error("要素の重なり順が重複しています");
    const { stackOrder: _stackOrder, ...modelElement } = element;
    restored[stackOrder] = modelElement;
  }
  // Range and uniqueness checks imply a complete 0..n-1 sequence, including an empty page.
  return restored;
}

const elementOrder = ["id", "type", "name", "stackOrder", "x", "y", "width", "height", "rotation", "opacity", "locked",
  "shape", "line", "startArrow", "endArrow", "text", "fontSize", "fontFamily", "color", "textColor", "bold", "italic", "align", "verticalAlign",
  "fill", "stroke", "strokeWidth", "src", "alt", "layoutPlaceholderId"];
const deckOrder = new Map(DECK_KEYS.map((key, index) => [key, index]));
const slideOrder = new Map(SLIDE_KEYS.map((key, index) => [key, index]));
const masterOrder = new Map(MASTER_KEYS.map((key, index) => [key, index]));
const layoutOrder = new Map(LAYOUT_KEYS.map((key, index) => [key, index]));
const elementsOrder = new Map(elementOrder.map((key, index) => [key, index]));
// Preserve existing animation bytes while placing the optional timeline beside its ID/name.
const animationOrder = new Map(["animation", "id", "name", "timelineId", "trigger"].map((key, index) => [key, index]));

/** Fields follow document structure, rather than arbitrary ID or alphabetical order. */
export function compareSlideFileKeys(left: string, right: string, path: readonly (string | number)[]): number {
  const order = path.length === 0 ? deckOrder
    : path.length === 2 && path[0] === "slides" ? slideOrder
    : path.length === 2 && path[0] === "masters" ? masterOrder
    : path.length === 2 && path[0] === "layouts" ? layoutOrder
    : path.length === 4 && ["slides", "masters", "layouts"].includes(String(path[0])) && path[2] === "elements" ? elementsOrder
    : path.length === 5 && path[0] === "layouts" && path[2] === "placeholders" && path[4] === "element" ? elementsOrder
    : path.length === 4 && path[0] === "slides" && path[2] === "animations" ? animationOrder : undefined;
  return order ? (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER) : 0;
}
