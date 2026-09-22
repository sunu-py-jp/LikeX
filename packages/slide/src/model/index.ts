export type * from "./types";
export type { SlideFile, SlideFilePage, SlideFileElement } from "./file-format";
export { SLIDE_LIMITS } from "./limits";
export { createSlideDeck, createSlideElement, normalizeSlideDeck } from "./normalize";
export { parseSlideDeck, serializeSlideDeck } from "./serialization";
export { getDeck, getSlides, getSlide, getElements, getElement, getAnimations } from "./query";
export { evaluateSlideAnimations, resolveSlideAnimations } from "./animations";
export { applySlideCommands } from "./commands";
