import type { DocumentProps, DocumentHandle, DocumentRibbonDisplayMode } from "../src/index";

const modes: DocumentRibbonDisplayMode[] = ["expanded", "tabs", "autoHide", "hidden"];
const props: DocumentProps = {
  initialRibbonDisplayMode: "hidden",
  ribbonDisplayMode: modes[0],
  onRibbonDisplayModeChange(mode) { const same: DocumentRibbonDisplayMode = mode; void same; },
};
function configure(handle: DocumentHandle) {
  const mode: DocumentRibbonDisplayMode = handle.getRibbonDisplayMode();
  const accepted: boolean = handle.setRibbonDisplayMode(mode);
  // @ts-expect-error Only the four supported presentation modes are allowed.
  handle.setRibbonDisplayMode("collapsed");
  return accepted;
}
void props; void configure;
