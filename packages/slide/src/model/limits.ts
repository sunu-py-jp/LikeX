/** Bounds apply before publishing any imported data or command result. */
export const SLIDE_LIMITS = Object.freeze({
  slides: 500,
  elementsPerSlide: 1_000,
  totalElements: 10_000,
  textLength: 100_000,
  totalTextLength: 2_000_000,
  imageBytes: 10 * 1024 * 1024,
  totalImageBytes: 50 * 1024 * 1024,
  imageDimension: 16_384,
  imagePixels: 40_000_000,
  jsonLength: 80 * 1024 * 1024,
  commands: 1_000,
  history: 100,
});
