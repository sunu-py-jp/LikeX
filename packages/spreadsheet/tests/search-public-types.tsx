import { Spreadsheet, type SpreadsheetHandle, type SpreadsheetProps, type SpreadsheetSearchHandler, type SpreadsheetSearchRenderContext } from "../src/index";
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
