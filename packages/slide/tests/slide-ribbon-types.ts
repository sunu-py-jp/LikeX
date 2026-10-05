import type { SlideProps, SlideHandle, SlideRibbonDisplayMode } from "../src";

const modes: SlideRibbonDisplayMode[] = ["expanded", "tabs", "autoHide", "hidden"];
const props: SlideProps = {
  initialRibbonDisplayMode: "hidden", ribbonDisplayMode: "tabs",
  onRibbonDisplayModeChange(mode: SlideRibbonDisplayMode) { void mode; },
};
declare const handle: SlideHandle;
const accepted: boolean = handle.setRibbonDisplayMode("expanded");
const current: SlideRibbonDisplayMode = handle.getRibbonDisplayMode();
// @ts-expect-error Only supported presentation modes are accepted.
handle.setRibbonDisplayMode("collapsed");
// @ts-expect-error Ribbon is a view option, not a persisted deck option.
const invalid: SlideProps = { initialRibbonDisplayMode: false };
void [modes, props, accepted, current, invalid];
