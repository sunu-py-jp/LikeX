/** Bounds apply before publishing any imported data or command result. */
export const SLIDE_LIMITS = Object.freeze({
  slides: 500,
  masters: 100,
  layouts: 500,
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
  /** Maximum materialized animation nodes per deck; compact tween repeats do not expand. */
  animationExpandedNodes: 100_000,
  /** Maximum cumulative comparison/sample work while converting PPTX timing. */
  animationImportWork: 10_000_000,
  /** @deprecated Legacy per-slide key; use the per-deck animationExpandedNodes budget. */
  animationNodesPerSlide: Infinity,
  /** @deprecated Animation nesting no longer has an application limit. */
  animationDepth: Infinity,
  /** @deprecated Finite, representable animation times have no application limit. */
  animationDurationMs: Infinity,
  /** @deprecated Positive safe-integer repeats have no application limit. */
  animationRepeat: Infinity,
  /** @deprecated Click history length no longer has an application limit. */
  animationClicks: Infinity,
});
