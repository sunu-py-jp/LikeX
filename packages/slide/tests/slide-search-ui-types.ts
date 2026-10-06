import type { SlideHandle, SlideProps } from "../src";

declare const handle: SlideHandle;
const accepted: boolean = handle.openSearch("顧客");
handle.openSearch();
handle.closeSearch();
const props: SlideProps = { readOnly: true, initialRibbonDisplayMode: "hidden", features: { search: false } };
// @ts-expect-error The UI searches a literal string, not a model search condition.
handle.openSearch({ keywords: ["顧客"] });
void [accepted, props];
