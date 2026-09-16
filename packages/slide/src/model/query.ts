import type { Slide, SlideDeck, SlideElement } from "./types";

export function getSlide(deck: SlideDeck, slideId: string): Slide | undefined {
  return deck.slides.find(slide => slide.id === slideId);
}

export function getElement(deck: SlideDeck, slideId: string, elementId: string): SlideElement | undefined {
  return getSlide(deck, slideId)?.elements.find(element => element.id === elementId);
}

export function sameSlideElement(left: SlideElement, right: SlideElement): boolean {
  if (left === right) return true;
  const keys = Object.keys(left) as (keyof SlideElement)[];
  return left.type === right.type && keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}

export function sameSlideDeck(left: SlideDeck, right: SlideDeck): boolean {
  return left === right || (left.id === right.id && left.version === right.version && left.title === right.title &&
    left.width === right.width && left.height === right.height && left.slides.length === right.slides.length &&
    left.slides.every((slide, index) => {
      const other = right.slides[index];
      return slide === other || (slide.id === other.id && slide.name === other.name && slide.background === other.background &&
        slide.notes === other.notes && slide.elements.length === other.elements.length && slide.elements.every((element, elementIndex) =>
          sameSlideElement(element, other.elements[elementIndex])));
    }));
}
