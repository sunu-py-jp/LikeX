import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundle = await build({ stdin: { resolveDir: root, contents: `
  export { SkillWorkspace } from './apps/playground/build/ai/tools.ts';
  export { spreadsheetReadResult } from './apps/playground/build/ai/spreadsheet-read.ts';
  export { toolDefinitions } from './apps/playground/build/ai/tool-definitions.ts';
  export { defaultAIInstructions } from './apps/playground/build/ai/prompts.ts';
  export { createDesignTemplateWorkbook } from './apps/playground/src/demo/spreadsheet-design-template.ts';
  export { normalizeWorkbook, serializeWorkbook, getRange } from './packages/spreadsheet/src/model-entry.ts';
` }, alias: { "@likex/spreadsheet/model": `${root}/packages/spreadsheet/src/model-entry.ts` },
  bundle: true, platform: "node", format: "esm", write: false });
const { SkillWorkspace, spreadsheetReadResult, toolDefinitions, defaultAIInstructions,
  createDesignTemplateWorkbook, normalizeWorkbook, serializeWorkbook, getRange } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const signal = () => new AbortController().signal;
const inspect = (workspace, query) => workspace.invoke("inspect_document", { query }, signal());
const source = serializeWorkbook(normalizeWorkbook({ sheets: [{ id: "sheet", name: "入力", rowCount: 10, columnCount: 5, cells: {
  A1: { value: "=SUM(B1:B2)", format: { bold: true, color: "#18324b" }, validation: { type: "number", min: 0 } },
  B1: { value: "10", format: { numberFormat: "number", decimalPlaces: 0 } },
  B2: { value: "", format: { background: "#eaf6f7" }, validation: { type: "list", values: ["10", "20"] } },
} }] }));

test("compact spreadsheet reads retain raw formulas, validation, blank cells and row positions without mutating the baseline", async t => {
  const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
  t.after(() => workspace.dispose());
  const selected = (await inspect(workspace, { kind: "range", sheetId: "sheet", range: "A1:C2" })).selection;
  assert.equal(selected.formatsOmitted, true);
  assert.deepEqual(selected.rows, [
    [{ value: "=SUM(B1:B2)", validation: { type: "number", min: 0 } }, { value: "10" }, null],
    [null, { value: "", validation: { type: "list", values: ["10", "20"] } }, null],
  ]);
  const legacy = await workspace.invoke("run_script", { operation: "inspect", sheetId: "sheet", range: "A1:C2" }, signal());
  assert.deepEqual(legacy.selection, selected);
  const full = (await inspect(workspace, { kind: "range", sheetId: "sheet", range: "A1:C2", includeFormat: true })).selection;
  assert.equal(full.formatsOmitted, false);
  assert.deepEqual(full.rows[0][0].format, { bold: true, color: "#18324b" });
  const fullLegacy = await workspace.invoke("run_script", { operation: "inspect", sheetId: "sheet", range: "A1:C2", includeFormat: true }, signal());
  assert.deepEqual(fullLegacy.selection, full);
  assert.equal(await readFile(workspace.file, "utf8"), source);
});

test("paginated sheet cell reads omit only format and retain pagination and addresses", async t => {
  const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
  t.after(() => workspace.dispose());
  const query = { kind: "sheet", sheetId: "sheet", includeData: true, includeFormat: false, offset: 1, limit: 1 };
  const compact = (await inspect(workspace, query)).selection;
  assert.equal(compact.formatsOmitted, true);
  assert.equal(compact.offset, 1); assert.equal(compact.limit, 1); assert.equal(compact.total, 3); assert.equal(compact.hasMore, true);
  assert.deepEqual(compact.cells, [{ address: "B1", value: "10" }]);
  const full = (await inspect(workspace, { ...query, includeFormat: true })).selection;
  assert.equal(full.formatsOmitted, false);
  assert.deepEqual(full.cells[0].format, { numberFormat: "number", decimalPlaces: 0 });
  const metadata = (await inspect(workspace, { ...query, includeData: false, offset: null, limit: null })).selection;
  assert.equal(metadata.formatsOmitted, undefined);
});

test("48-field template requirements fit one compact read before the tool output budget is enforced", async t => {
  const workbook = createDesignTemplateWorkbook(), original = serializeWorkbook(workbook);
  const workspace = await SkillWorkspace.create(root, "spreadsheet", original);
  t.after(() => workspace.dispose());
  const sheetId = "screen-design-requirements", range = "A14:J62";
  const nativeRows = getRange(workbook, sheetId, range);
  assert.ok(JSON.stringify(nativeRows).length > 48_000, "the regression fixture must exceed the old tool limit");
  assert.ok(nativeRows[0][0].format, "the native API still returns full formatting");
  const compact = await inspect(workspace, { kind: "range", sheetId, range, includeFormat: false });
  assert.ok(JSON.stringify(compact).length < 24_000);
  assert.equal(compact.selection.rows.length, 49);
  assert.deepEqual(compact.selection.rows.map(row => row.map(cell => cell?.value ?? null)), nativeRows.map(row => row.map(cell => cell?.value ?? null)));
  await assert.rejects(inspect(workspace, { kind: "range", sheetId, range, includeFormat: true }), /取得結果が大きすぎます/);
  const representative = await inspect(workspace, { kind: "range", sheetId, range: "A14:J15", includeFormat: true });
  assert.deepEqual(representative.selection.rows[0][0].format, nativeRows[0][0].format);
  assert.equal(await readFile(workspace.file, "utf8"), original);
});

test("cell formatting projection is explicit, narrowly scoped and documented in the advertised schema", async t => {
  const result = { selection: { rows: [[{ value: "x", format: { bold: true } }, null]], format: { untouched: true } } };
  const projected = spreadsheetReadResult(result, false);
  assert.deepEqual(projected.selection.rows, [[{ value: "x" }, null]]);
  assert.deepEqual(projected.selection.format, { untouched: true });
  assert.deepEqual(result.selection.rows[0][0].format, { bold: true });
  const drawing = { selection: { drawing: { id: "shape", format: { bold: true } } } };
  assert.equal(spreadsheetReadResult(drawing, false), drawing);
  const queries = toolDefinitions("spreadsheet", root).find(tool => tool.name === "inspect_document").parameters.properties.query.anyOf;
  for (const kind of ["sheet", "range"]) {
    const schema = queries.find(query => query.properties.kind.enum[0] === kind);
    assert.deepEqual(schema.properties.includeFormat, { type: "boolean" });
    assert.ok(schema.required.includes("includeFormat"));
  }
  assert.match(defaultAIInstructions("spreadsheet"), /includeFormat:false/);
  assert.match(defaultAIInstructions("spreadsheet"), /includeFormat:true/);
  const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
  t.after(() => workspace.dispose());
  for (const args of [
    { operation: "inspect", sheetId: "sheet", range: "A1", includeFormat: "false" },
    { operation: "inspect", overview: true, includeFormat: false },
    { operation: "inspect", sheetId: "sheet", drawingId: "shape", includeFormat: false },
    { operation: "inspect", sheetId: "sheet", search: "cells", text: "10", includeFormat: false },
    { operation: "validate", includeFormat: false },
  ]) await assert.rejects(workspace.invoke("run_script", args, signal()));
});
