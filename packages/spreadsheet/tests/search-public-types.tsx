import { Spreadsheet, type SpreadsheetExternalSearchOptions, type SpreadsheetExternalSearchTarget, type SpreadsheetHandle, type SpreadsheetProps, type SpreadsheetSearchHandler, type SpreadsheetSearchRenderContext } from "../src/index";
import { findSpreadsheetCells, findSpreadsheetSheets, type SpreadsheetSearchQuery, type SpreadsheetSheetSearchQuery } from "../src/model-entry";
const query: SpreadsheetSearchQuery = { text: "^order-\\d+$", useRegex: true, matchCase: true };
const sheets: SpreadsheetSheetSearchQuery = { text: "^sales", useRegex: true };
const handler: SpreadsheetSearchHandler = async (request, { signal }) => {
  if (signal.aborted) return [];
  // @ts-expect-error Requests expose an immutable workbook snapshot.
  request.workbook.sheets[0].name = "changed";
  return findSpreadsheetCells(request.workbook, request.query, { sheetId: request.sheetId });
};
const props: SpreadsheetProps = { search: { trigger: "submit", debounceMs: 250, params: { columns: ["A", "B"] } }, onSearchRequest: handler,
  renderSearch: (context: SpreadsheetSearchRenderContext) => <>{context.defaultInput}{context.defaultOptions}{context.defaultReplacement}<button disabled={context.disabled} onClick={context.submit}>検索</button></> };
// @ts-expect-error Only input/submit trigger policies are supported.
const invalid: SpreadsheetProps = { search: { trigger: "blur" } };
void [<Spreadsheet key="search" {...props} />, query, sheets, findSpreadsheetSheets, invalid];

const initiallyOpen: SpreadsheetProps = { initialSearchOpen: true, initialSearchQuery: "受注", readOnly: true, initialRibbonDisplayMode: "hidden" };
function searchPanelApi(handle: SpreadsheetHandle) {
  const accepted: boolean = handle.openSearch("売上");
  const reopened: boolean = handle.openSearch();
  const closed: void = handle.closeSearch();
  // @ts-expect-error Search panel query injection accepts only text.
  handle.openSearch({ text: "売上" });
  return { accepted, reopened, closed };
}
// @ts-expect-error Initial visibility is a boolean, not a string.
const invalidVisibility: SpreadsheetProps = { initialSearchOpen: "open" };
// @ts-expect-error Initial query injection accepts only text.
const invalidQuery: SpreadsheetProps = { initialSearchQuery: ["売上"] };
void [initiallyOpen, searchPanelApi, invalidVisibility, invalidQuery];

const target: SpreadsheetExternalSearchTarget = { sheetId: "sales", range: "B2:F20" };
const externalSearch: SpreadsheetExternalSearchOptions = { results: [{ id: "sales-result", title: "売上", snippet: "対象セルの説明", target }],
  onResultSelect(result) { const range: string = result.target.range; void range; } };
const externalProps: SpreadsheetProps = { initialSearchOpen: true, initialSearchMode: "external", externalSearch };
function externalSearchApi(handle: SpreadsheetHandle) {
  const selected: boolean = handle.openExternalSearch("sales-result");
  const reopened: boolean = handle.openExternalSearch();
  // @ts-expect-error The result identity is a string, not a target object.
  handle.openExternalSearch(target);
  return { selected, reopened };
}
// @ts-expect-error Spreadsheet destinations require both a sheet identity and an A1 range.
const missingRange: SpreadsheetExternalSearchTarget = { sheetId: "sales" };
// @ts-expect-error The common mode is local/external, not a document-specific value.
const invalidMode: SpreadsheetProps = { initialSearchMode: "sheet" };
void [externalProps, externalSearchApi, missingRange, invalidMode];
