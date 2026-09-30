import type { Slide, SlideAnimationStep, SlideDeck, SlideElement, SlideQueryOptions, SlideMaster, SlideLayout } from "./types";
import { normalizeSlideDeck } from "./normalize";
import { resolveSlideAnimations } from "./animations";
import { sameAnimations } from "./animation-validation";
import { boolean, record } from "./validation";

const resolved = new WeakMap<SlideDeck, SlideDeck>();
const emptyElements = Object.freeze([]) as unknown as SlideElement[];
const emptyAnimations = Object.freeze([]) as unknown as SlideAnimationStep[];
function includeAnimations(options: SlideQueryOptions | undefined): boolean {
  if (options === undefined) return false;
  const raw = record(options, "取得オプション", ["includeAnimations"]);
  return raw.includeAnimations === undefined ? false : boolean(raw.includeAnimations, "アニメーション定義を含める");
}
export function getDeck(deck: SlideDeck, options?: SlideQueryOptions): SlideDeck {
  const source = normalizeSlideDeck(deck);
  if (includeAnimations(options)) return source;
  const cached = resolved.get(source);
  if (cached) return cached;
  const slides = source.slides.map(resolveSlideAnimations);
  const result = slides.every((slide, index) => slide === source.slides[index]) ? source : normalizeSlideDeck({ ...source, slides });
  resolved.set(source, result);
  return result;
}
export function getSlides(deck: SlideDeck, options?: SlideQueryOptions): Slide[] {
  return getDeck(deck, options).slides;
}
export function getSlide(deck: SlideDeck, slideId: string, options?: SlideQueryOptions): Slide | undefined {
  const source = normalizeSlideDeck(deck);
  const initial = includeAnimations(options);
  const slide = source.slides.find(slide => slide.id === slideId);
  return slide && (initial ? slide : resolveSlideAnimations(slide));
}
export function getElements(deck: SlideDeck, slideId: string, options?: SlideQueryOptions): SlideElement[] {
  return getSlide(deck, slideId, options)?.elements ?? emptyElements;
}
export function getElement(deck: SlideDeck, slideId: string, elementId: string, options?: SlideQueryOptions): SlideElement | undefined {
  return getSlide(deck, slideId, options)?.elements.find(element => element.id === elementId);
}
export function getAnimations(deck: SlideDeck, slideId: string): SlideAnimationStep[] {
  return getSlide(deck, slideId, { includeAnimations: true })?.animations ?? emptyAnimations;
}

export function sameSlideElement(left: SlideElement, right: SlideElement): boolean {
  if (left === right) return true;
  const keys = Object.keys(left);
  return left.type === right.type && keys.length === Object.keys(right).length && keys.every(key => key === "line" ? JSON.stringify(Reflect.get(left, key)) === JSON.stringify(Reflect.get(right, key)) : Reflect.get(left, key) === Reflect.get(right, key));
}

function sameCatalog<T extends SlideMaster | SlideLayout>(left: readonly T[] | undefined, right: readonly T[] | undefined): boolean {
  return left === right || !!left && !!right && left.length === right.length && left.every((definition, index) => {
    const other = right[index];
    if (definition === other) return true;
    if (definition.id !== other.id || definition.name !== other.name || definition.background !== other.background ||
      definition.elements.length !== other.elements.length || !definition.elements.every((element, index) => sameSlideElement(element, other.elements[index]))) return false;
    if (!("placeholders" in definition)) return true;
    return "placeholders" in other && definition.masterId === other.masterId && definition.showMasterShapes === other.showMasterShapes &&
      definition.placeholders.length === other.placeholders.length && definition.placeholders.every((slot, index) => {
        const otherSlot = other.placeholders[index];
        return slot.id === otherSlot.id && slot.kind === otherSlot.kind && sameSlideElement(slot.element, otherSlot.element);
      });
  });
}

export function sameSlideDeck(left: SlideDeck, right: SlideDeck): boolean {
  return left === right || (left.id === right.id && left.version === right.version && left.title === right.title &&
    sameCatalog(left.masters, right.masters) && sameCatalog(left.layouts, right.layouts) &&
    left.width === right.width && left.height === right.height && left.slides.length === right.slides.length &&
    left.slides.every((slide, index) => {
      const other = right.slides[index];
      return slide === other || (slide.id === other.id && slide.name === other.name && slide.background === other.background &&
        slide.layoutId === other.layoutId && slide.inheritBackground === other.inheritBackground && slide.showMasterShapes === other.showMasterShapes &&
        slide.notes === other.notes && sameAnimations(slide.animations, other.animations) && slide.elements.length === other.elements.length && slide.elements.every((element, elementIndex) =>
          sameSlideElement(element, other.elements[elementIndex])));
    }));
}
