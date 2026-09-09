import type { SpreadsheetCell, SpreadsheetCommand, SpreadsheetDataValidation, SpreadsheetDataValidationCommand, SpreadsheetFeatures, SpreadsheetHandle } from "../src";
import { setCellDataValidation } from "../src";

const list = { type: "list", values: ["未着手", "進行中", "完了"], allowBlank: false, message: "一覧から選択してください" } as const satisfies SpreadsheetDataValidation;
const rules: readonly SpreadsheetDataValidation[] = [list, { type: "number", integer: true, min: 0, max: 100 },
  { type: "textLength", max: 50 }, { type: "date", min: "2026-01-01" }, { type: "checkbox" }];
const cell = { value: "未着手", validation: list } satisfies SpreadsheetCell;
const command = { type: "cells.validation", sheetId: "main", addresses: ["A1", "B1"], validation: list } satisfies SpreadsheetDataValidationCommand;
const commands: readonly SpreadsheetCommand[] = [command, { ...command, validation: null }];
const features = { dataValidation: false, checkboxes: false } satisfies SpreadsheetFeatures;
function apply(api: SpreadsheetHandle) { return api.batch(commands); }

// @ts-expect-error List rules require their permitted values.
const missingListValues: SpreadsheetDataValidation = { type: "list" };
// @ts-expect-error Numeric constraints are numbers, never numeric-looking strings.
const invalidNumber: SpreadsheetDataValidation = { type: "number", min: "0" };
// @ts-expect-error Checkbox rules do not accept arbitrary list choices.
const invalidCheckbox: SpreadsheetDataValidation = { type: "checkbox", values: ["yes", "no"] };
// @ts-expect-error Custom formula validation is outside the supported rule contract.
const invalidFormula: SpreadsheetDataValidation = { type: "formula", formula: "=A1>0" };
// @ts-expect-error Rule removal is explicit; omitting the payload is not an edit request.
const missingValidation: SpreadsheetDataValidationCommand = { type: "cells.validation", sheetId: "main", addresses: ["A1"] };
// @ts-expect-error Rules are immutable callback/snapshot data.
rules[0].allowBlank = true;
void [rules, cell, features, apply, setCellDataValidation, missingListValues, invalidNumber, invalidCheckbox, invalidFormula, missingValidation];
