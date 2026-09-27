/** Stable categories for deciding how to present a PowerPoint conversion notice. */
export type SlidePptxDiagnosticCode =
  | "unsupported-animation" | "animation-approximated" | "animation-limit" | "animation-conflict"
  | "unsupported-content" | "content-approximated" | "appearance-adjusted";

/** Optional location. slideIndex is zero-based; IDs refer to the supplied or imported LikeSlide model. */
export type SlidePptxDiagnosticLocation = {
  readonly slideIndex?: number;
  readonly slideId?: string;
  readonly slideName?: string;
  readonly elementId?: string;
  readonly elementName?: string;
  readonly animationId?: string;
  readonly timelineId?: string;
  /** Original PresentationML cTn ID, when available on import. */
  readonly timingId?: string;
  readonly property?: string;
  readonly sourcePart?: string;
};
export type SlidePptxDiagnostic = SlidePptxDiagnosticLocation & {
  readonly phase: "import" | "export";
  readonly severity: "warning";
  readonly code: SlidePptxDiagnosticCode;
  readonly action: "approximation" | "omission" | "adjustment";
  readonly message: string;
};
/** Internal adapters can provide only the location and classification they know. */
export type SlidePptxDiagnosticDetails = SlidePptxDiagnosticLocation & Partial<Pick<SlidePptxDiagnostic, "code" | "action">>;
