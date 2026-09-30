export type * from "./types";
export type { SlideFile, SlideFilePage, SlideFileElement, SlideFileMaster, SlideFileLayout } from "./file-format";
export { SLIDE_LIMITS } from "./limits";
export { createSlideDeck, createSlideElement, normalizeSlideDeck, normalizeSlideMasterLibrary } from "./normalize";
export { parseSlideDeck, serializeSlideDeck } from "./serialization";
export { getDeck, getSlides, getSlide, getElements, getElement, getAnimations } from "./query";
export { evaluateSlideAnimations, resolveSlideAnimations } from "./animations";
export { applySlideCommands } from "./commands";
export { measureSlideText, fitSlideText, getSlideElementBounds, getSlideLayoutDiagnostics } from "./authoring";
export type { SlideTextMeasureStyle, SlideTextMeasure, SlideTextLayout, SlideLayoutDiagnostic, SlideLayoutOptions, SlideElementBounds, SlideElementGeometry } from "./authoring";

export { isSlideLine, getSlideLineEndpoints, getSlideConnectorOutline } from "./lines";
export { getSlideMasters, getSlideLayouts, getSlideLayout, resolveSlideAppearance } from "./layouts";
