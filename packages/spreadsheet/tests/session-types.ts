import { createSpreadsheetSession, type SpreadsheetSession, type SpreadsheetSessionOptions } from "../src/session/create-spreadsheet-session";
import type { SpreadsheetHistoryState } from "../src/history/workbook-history";
import { createWorkbook } from "../src/model";

const options = { features: { undoRedo: true }, historyLimit: 10 } satisfies SpreadsheetSessionOptions;
const session: SpreadsheetSession = createSpreadsheetSession(createWorkbook(), options);
const history: SpreadsheetHistoryState = session.getHistoryState();
const changed: boolean = session.undo();
session.redo();
void session.getCell("sheet-1", "A1")?.value;
void session.getRange("sheet-1", "A1:C2")[0][0]?.value;
void session.getShape("sheet-1", "shape")?.text;
session.batch([{ type: "cells.set", sheetId: "sheet-1", values: { A1: "value" } }]);
session.replaceWorkbook(session.getWorkbook());
session.clearHistory();
// @ts-expect-error History state is a readonly snapshot.
history.undoCount = 0;
// @ts-expect-error Session workbook snapshots cannot be mutated.
session.getWorkbook().sheets[0].name = "Changed";
// @ts-expect-error Command payloads use the shared discriminated union.
session.execute({ type: "cells.set", sheetId: "sheet-1", values: { A1: 5 } });
// @ts-expect-error A headless session does not inject storage or edit-permission callbacks.
createSpreadsheetSession(createWorkbook(), { onSave() {} });
void changed;
