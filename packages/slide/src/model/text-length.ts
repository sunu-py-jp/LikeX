import type { Slide, SlideElement } from "./types";

/** The model's aggregate character budget includes names, notes and image alt.
 * IDs, font families and the separately bounded deck title are not included.
 */
export function slideElementTextLength(element: SlideElement): number {
  return element.name.length + (element.type === "image" ? element.alt.length : element.text.length);
}
export function slideTextLength(slide: Slide): number {
  return slide.name.length + slide.notes.length + slide.elements.reduce((total, element) => total + slideElementTextLength(element), 0);
}
