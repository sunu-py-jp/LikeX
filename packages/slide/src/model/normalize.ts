import type { Slide, SlideDeck, SlideElement, SlideElementInput } from "./types";
import { SLIDE_LIMITS } from "./limits";
import { validateSlideImageSource } from "./image-source";
import { boolean, choice, color, fontFamily, identifier, list, number, record, text } from "./validation";
import { DECK_KEYS, ELEMENT_KEYS, SLIDE_KEYS } from "./schema";
export { ELEMENT_KEYS } from "./schema";

const decks = new WeakSet<SlideDeck>();
const slides = new WeakSet<Slide>();
const elements = new WeakSet<SlideElement>();
const imageBytes = new WeakMap<SlideElement, number>();
// Repositioning an image should not repeatedly decode its immutable data URL.
const imageSources = new Map<string, number>();
let cachedImageBytes = 0;

function imageSource(value: unknown): { src: string; bytes: number } {
  if (typeof value === "string" && imageSources.has(value)) {
    const bytes = imageSources.get(value)!;
    imageSources.delete(value);
    imageSources.set(value, bytes);
    return { src: value, bytes };
  }
  const result = validateSlideImageSource(value);
  imageSources.set(result.src, result.bytes);
  cachedImageBytes += result.bytes;
  while (imageSources.size > 32 || cachedImageBytes > 20 * 1024 * 1024) {
    const oldest = imageSources.keys().next().value!;
    cachedImageBytes -= imageSources.get(oldest)!;
    imageSources.delete(oldest);
  }
  return result;
}

export function normalizeSlideElement(input: unknown): SlideElement {
  if (elements.has(input as SlideElement)) return input as SlideElement;
  const raw = record(input, "要素", [...ELEMENT_KEYS.text, ...ELEMENT_KEYS.shape, ...ELEMENT_KEYS.image]);
  const type = choice(raw.type, ["text", "shape", "image"], "要素の種類");
  record(raw, "要素", ELEMENT_KEYS[type]);
  const base = {
    id: identifier(raw.id), name: text(raw.name, "要素名", 1000),
    x: number(raw.x, "X座標", -100_000, 100_000), y: number(raw.y, "Y座標", -100_000, 100_000),
    width: number(raw.width, "幅", Number.MIN_VALUE, 100_000), height: number(raw.height, "高さ", Number.MIN_VALUE, 100_000),
    rotation: ((number(raw.rotation, "回転", -3_600_000, 3_600_000) % 360) + 360) % 360,
    opacity: number(raw.opacity, "不透明度", 0, 1), locked: boolean(raw.locked, "ロック"),
  };
  let result: SlideElement;
  if (type === "text") result = { ...base, type,
    text: text(raw.text, "テキスト", SLIDE_LIMITS.textLength), fontSize: number(raw.fontSize, "文字サイズ", 1, 1000),
    fontFamily: fontFamily(raw.fontFamily), color: color(raw.color, "文字色"), bold: boolean(raw.bold, "太字"),
    italic: boolean(raw.italic, "斜体"), align: choice(raw.align, ["left", "center", "right"], "横位置"),
    verticalAlign: choice(raw.verticalAlign, ["top", "middle", "bottom"], "縦位置"), fill: color(raw.fill, "塗りつぶし"),
  };
  else if (type === "shape") result = { ...base, type,
    shape: choice(raw.shape, ["rect", "roundRect", "ellipse", "triangle", "diamond", "arrow", "line"], "図形"),
    fill: color(raw.fill, "塗りつぶし"), stroke: color(raw.stroke, "線の色"), strokeWidth: number(raw.strokeWidth, "線の太さ", 0, 100),
    text: text(raw.text, "テキスト", SLIDE_LIMITS.textLength), fontSize: number(raw.fontSize, "文字サイズ", 1, 1000),
    textColor: color(raw.textColor, "文字色"),
  };
  else {
    const image = imageSource(raw.src);
    result = { ...base, type, src: image.src, alt: text(raw.alt, "画像の説明", 10_000) };
    imageBytes.set(result, image.bytes);
  }
  Object.freeze(result);
  elements.add(result);
  return result;
}

export function createSlideElement(input: SlideElementInput): SlideElement {
  const raw = record(input, "要素", [...ELEMENT_KEYS.text, ...ELEMENT_KEYS.shape, ...ELEMENT_KEYS.image]);
  const type = choice(raw.type, ["text", "shape", "image"], "要素の種類");
  record(raw, "要素", ELEMENT_KEYS[type]);
  const supplied = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
  const base = { id: crypto.randomUUID(), name: type === "text" ? "テキスト" : type === "shape" ? "図形" : "画像",
    x: 100, y: 100, width: type === "shape" ? 160 : 320, height: type === "text" ? 80 : type === "shape" ? 100 : 240,
    rotation: 0, opacity: 1, locked: false };
  const defaults = type === "text" ? { text: "テキスト", fontSize: 32, fontFamily: "Arial", color: "#1f2937",
    bold: false, italic: false, align: "left", verticalAlign: "top", fill: "transparent" }
    : type === "shape" ? { shape: "roundRect", fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2,
      text: "", fontSize: 24, textColor: "#1f2937" } : { alt: "" };
  return normalizeSlideElement({ ...base, ...defaults, ...supplied });
}

export function normalizeSlide(input: unknown): Slide {
  if (slides.has(input as Slide)) return input as Slide;
  const raw = record(input, "スライド", SLIDE_KEYS);
  const accepted = list(raw.elements, "スライドの要素", SLIDE_LIMITS.elementsPerSlide).map(normalizeSlideElement);
  const ids = new Set<string>();
  for (const element of accepted) {
    if (ids.has(element.id)) throw new Error("要素のIDが重複しています");
    ids.add(element.id);
  }
  const result: Slide = { id: identifier(raw.id), name: text(raw.name, "スライド名", 1000),
    background: color(raw.background, "スライドの背景"), notes: text(raw.notes, "ノート", SLIDE_LIMITS.textLength), elements: accepted };
  Object.freeze(result.elements);
  Object.freeze(result);
  slides.add(result);
  return result;
}

/** Internal factory used by deck creation, insertion and duplication. */
export function createSlide(input: Partial<Slide> = {}): Slide {
  const raw = record(input, "スライド", SLIDE_KEYS);
  const supplied = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
  return normalizeSlide({ id: crypto.randomUUID(), name: "スライド", background: "#ffffff", notes: "", elements: [], ...supplied });
}

export function normalizeSlideDeck(input: unknown): SlideDeck {
  if (decks.has(input as SlideDeck)) return input as SlideDeck;
  const raw = record(input, "プレゼンテーション", DECK_KEYS);
  if (raw.format !== undefined && raw.format !== "likex.slide")
    throw new Error("LikeSlideのファイル形式ではありません");
  if (raw.version !== 1) throw new Error("対応していないプレゼンテーションのバージョンです");
  const accepted = list(raw.slides, "スライド", SLIDE_LIMITS.slides, 1).map(normalizeSlide);
  const slideIds = new Set<string>(), elementIds = new Set<string>();
  let count = 0, bytes = 0, characters = 0;
  for (const slide of accepted) {
    if (slideIds.has(slide.id)) throw new Error("スライドのIDが重複しています");
    slideIds.add(slide.id);
    characters += slide.notes.length + slide.name.length;
    for (const element of slide.elements) {
      if (elementIds.has(element.id)) throw new Error("プレゼンテーション内の要素のIDが重複しています");
      elementIds.add(element.id);
      count++;
      characters += element.name.length + (element.type === "image" ? element.alt.length : element.text.length);
      bytes += imageBytes.get(element) ?? 0;
    }
  }
  if (count > SLIDE_LIMITS.totalElements) throw new Error("プレゼンテーション全体の要素数が上限を超えています");
  if (bytes > SLIDE_LIMITS.totalImageBytes) throw new Error("プレゼンテーション全体の画像サイズが上限を超えています");
  if (characters > SLIDE_LIMITS.totalTextLength) throw new Error("プレゼンテーション全体の文字数が上限を超えています");
  const result: SlideDeck = { format: "likex.slide", version: 1, id: identifier(raw.id), title: text(raw.title, "タイトル", 1000),
    width: number(raw.width, "スライドの幅", 1, 10_000), height: number(raw.height, "スライドの高さ", 1, 10_000), slides: accepted };
  Object.freeze(result.slides);
  Object.freeze(result);
  decks.add(result);
  return result;
}

export function createSlideDeck(input: Partial<SlideDeck> = {}): SlideDeck {
  const raw = record(input, "プレゼンテーション", DECK_KEYS);
  const supplied = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
  return normalizeSlideDeck({ version: 1, id: crypto.randomUUID(), title: "新しいプレゼンテーション", width: 1280, height: 720,
    slides: [createSlide({ name: "スライド 1" })], ...supplied });
}
