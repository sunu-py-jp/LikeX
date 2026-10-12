import type { SlideHandle, SlideProps, SlideExternalSearchTarget, SlidePdfViewerHandle, SlidePdfViewerProps, PdfExternalSearchTarget } from "../src";

declare const handle: SlideHandle;
const accepted: boolean = handle.openSearch("顧客");
handle.openSearch();
handle.closeSearch();
const props: SlideProps = { readOnly: true, initialRibbonDisplayMode: "hidden", features: { search: false } };
// @ts-expect-error The UI searches a literal string, not a model search condition.
handle.openSearch({ keywords: ["顧客"] });
void [accepted, props];

const target: SlideExternalSearchTarget = { slideId: "overview", elementIds: ["heading"] };
const external: SlideProps = { initialSearchOpen: true, initialSearchMode: "external", externalSearch: { results: [{ id: "rank-1", target }] } };
const opened: boolean = handle.openExternalSearch("rank-1");
declare const pdfHandle: SlidePdfViewerHandle;
const pdfTarget: PdfExternalSearchTarget = { pageNumber: 2 };
const pdfProps: Pick<SlidePdfViewerProps, "externalSearch" | "initialSearchMode"> = { initialSearchMode: "external", externalSearch: { results: [{ id: "page-2", target: pdfTarget }] } };
pdfHandle.openExternalSearch();
// @ts-expect-error PDF targets use page numbers, not slide IDs.
const invalidPdfTarget: PdfExternalSearchTarget = { slideId: "overview" };
// @ts-expect-error External search selection uses a result ID.
handle.openExternalSearch(2);
void [external, opened, pdfProps, invalidPdfTarget];
