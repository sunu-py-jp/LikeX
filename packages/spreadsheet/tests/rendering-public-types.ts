import type { SpreadsheetProps, SpreadsheetRenderingMode } from "../src";

const progressive: SpreadsheetRenderingMode = "progressive";
const viewport: SpreadsheetRenderingMode = "viewport";
const defaultProps: SpreadsheetProps = {};
const progressiveProps: SpreadsheetProps = { renderingMode: progressive };
const viewportProps: SpreadsheetProps = { renderingMode: viewport };
// @ts-expect-error Rendering modes use a closed union, not an arbitrary policy name.
const invalidMode: SpreadsheetRenderingMode = "all";
// @ts-expect-error A rendering mode is not a visibility boolean.
const invalidProps: SpreadsheetProps = { renderingMode: false };
void [defaultProps, progressiveProps, viewportProps, invalidMode, invalidProps];
