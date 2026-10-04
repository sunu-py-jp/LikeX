import { Spreadsheet, type SpreadsheetProps, type SpreadsheetSearchHandler, type SpreadsheetSearchRenderContext } from "../src/index";
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
