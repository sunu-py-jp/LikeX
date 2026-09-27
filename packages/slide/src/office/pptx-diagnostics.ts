import type { SlidePptxDiagnostic, SlidePptxDiagnosticDetails } from "./types";

/** Shared by all Office conversion paths; no UI, logging, or persistence. */
export function createPptxDiagnosticCollector(phase: SlidePptxDiagnostic["phase"], handlers: {
  onWarning?: (warning: string) => void;
  onDiagnostic?: (diagnostic: SlidePptxDiagnostic) => void;
} = {}) {
  const warnings = new Set<string>(), diagnostics: SlidePptxDiagnostic[] = [], keys = new Set<string>();
  const warn = (message: string, details: SlidePptxDiagnosticDetails = {}) => {
    const diagnostic: SlidePptxDiagnostic = Object.freeze({
      phase, severity: "warning", code: details.code ?? "unsupported-content", action: details.action ?? "omission", message,
      ...(details.slideIndex === undefined ? {} : { slideIndex: details.slideIndex }),
      ...(details.slideId === undefined ? {} : { slideId: details.slideId }),
      ...(details.slideName === undefined ? {} : { slideName: details.slideName }),
      ...(details.elementId === undefined ? {} : { elementId: details.elementId }),
      ...(details.elementName === undefined ? {} : { elementName: details.elementName }),
      ...(details.animationId === undefined ? {} : { animationId: details.animationId }),
      ...(details.timelineId === undefined ? {} : { timelineId: details.timelineId }),
      ...(details.timingId === undefined ? {} : { timingId: details.timingId }),
      ...(details.property === undefined ? {} : { property: details.property }),
      ...(details.sourcePart === undefined ? {} : { sourcePart: details.sourcePart }),
    });
    if (!warnings.has(message)) { warnings.add(message); handlers.onWarning?.(message); }
    const key = JSON.stringify(diagnostic);
    if (!keys.has(key)) { keys.add(key); diagnostics.push(diagnostic); handlers.onDiagnostic?.(diagnostic); }
  };
  return { warnings, diagnostics, warn };
}
