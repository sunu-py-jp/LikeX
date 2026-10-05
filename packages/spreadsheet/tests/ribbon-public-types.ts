import type { SpreadsheetHandle, SpreadsheetProps, SpreadsheetRibbonDisplayMode } from "../src";

const mode: SpreadsheetRibbonDisplayMode = "autoHide";
const initialProps: SpreadsheetProps = { initialRibbonDisplayMode: "hidden" };
const controlledProps: SpreadsheetProps = { ribbonDisplayMode: mode, onRibbonDisplayModeChange(next) {
  const requested: SpreadsheetRibbonDisplayMode = next;
  void requested;
} };
function ribbonApi(api: SpreadsheetHandle) {
  const current: SpreadsheetRibbonDisplayMode = api.getRibbonDisplayMode();
  const requested: boolean = api.setRibbonDisplayMode("tabs");
  // @ts-expect-error Ribbon display mode is a closed union.
  api.setRibbonDisplayMode("collapsed");
  return { current, requested };
}
// @ts-expect-error Ribbon display mode does not use a visibility boolean.
const invalidProps: SpreadsheetProps = { ribbonDisplayMode: false };
void [initialProps, controlledProps, ribbonApi, invalidProps];
