import type { Slide, SlideDeck, SlideElement } from "./types";
import { SLIDE_LIMITS } from "./limits";
import { DECK_KEYS, ELEMENT_KEYS, SLIDE_KEYS } from "./schema";
import { list, number, record } from "./validation";

/** An element in a .slon file; stackOrder is back-to-front, zero-based within its page. */
export type SlideFileElement = SlideElement & { stackOrder: number };
export type SlideFilePage = Omit<Slide, "elements"> & { elements: SlideFileElement[] };
/** Native version 1 storage format; unlike the editing model, each element has explicit stacking. */
export type SlideFile = Omit<SlideDeck, "format" | "version" | "slides"> & {
  format: "likex.slide";
  version: 1;
  slides: SlideFilePage[];
};

/** Converts a validated runtime deck without changing its page or stacking order. */
export function toSlideFile(deck: SlideDeck): SlideFile {
  return { ...deck, format: "likex.slide", version: 1, slides: deck.slides.map(slide => ({
    ...slide,
    elements: slide.elements.map((element, stackOrder) => ({ ...element, stackOrder }))
      .sort((left, right) => left.y - right.y || left.x - right.x || left.stackOrder - right.stackOrder),
  })) };
}

/** Validate the file envelope and restore drawing order before runtime model validation. */
export function restoreSlideFile(input: unknown): Record<string, unknown> {
  const raw = record(input, "プレゼンテーション", DECK_KEYS);
  if (raw.format !== "likex.slide") throw new Error("LikeSlideのファイル形式ではありません");
  if (raw.version !== 1) throw new Error("対応していないプレゼンテーションのバージョンです");
  return { ...raw, slides: list(raw.slides, "スライド", SLIDE_LIMITS.slides, 1).map(restoreSlideFilePage) };
}

/** Wire-only fields never enter editor state. */
function restoreSlideFilePage(input: unknown): Record<string, unknown> {
  const raw = record(input, "スライド", SLIDE_KEYS);
  const entries = list(raw.elements, "スライドの要素", SLIDE_LIMITS.elementsPerSlide);
  const restored: Record<string, unknown>[] = new Array(entries.length);
  for (const entry of entries) {
    const element = record(entry, "保存形式の要素", [...ELEMENT_KEYS.text, ...ELEMENT_KEYS.shape, ...ELEMENT_KEYS.image, "stackOrder"]);
    const stackOrder = number(element.stackOrder, "要素の重なり順", 0, entries.length - 1, true);
    if (Object.hasOwn(restored, stackOrder)) throw new Error("要素の重なり順が重複しています");
    const { stackOrder: _stackOrder, ...modelElement } = element;
    restored[stackOrder] = modelElement;
  }
  // Range and uniqueness checks imply a complete 0..n-1 sequence, including an empty page.
  return { ...raw, elements: restored };
}

const elementOrder = ["id", "type", "name", "stackOrder", "x", "y", "width", "height", "rotation", "opacity", "locked",
  "shape", "text", "fontSize", "fontFamily", "color", "textColor", "bold", "italic", "align", "verticalAlign",
  "fill", "stroke", "strokeWidth", "src", "alt"];
const deckOrder = new Map(DECK_KEYS.map((key, index) => [key, index]));
const slideOrder = new Map(SLIDE_KEYS.map((key, index) => [key, index]));
const elementsOrder = new Map(elementOrder.map((key, index) => [key, index]));

/** Fields follow document structure, rather than arbitrary ID or alphabetical order. */
export function compareSlideFileKeys(left: string, right: string, path: readonly (string | number)[]): number {
  const order = path.length === 0 ? deckOrder
    : path.length === 2 && path[0] === "slides" ? slideOrder
    : path.length === 4 && path[0] === "slides" && path[2] === "elements" ? elementsOrder : undefined;
  return order ? (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER) : 0;
}
