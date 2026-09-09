import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = await build({
  stdin: { contents: `export * from './apps/playground/src/demo/selection-sum.ts'; export * from './packages/spreadsheet/src/model/index.ts';`, resolveDir: root },
  alias: { "@likex/spreadsheet": `${root}/packages/spreadsheet/src/model/index.ts` },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { createSelectionSum, calculateWorkbook, setCellValue, normalizeWorkbook } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`,
);

const range = (top, left, bottom, right) => ({ anchor: { row: top, column: left }, focus: { row: bottom, column: right } });
function context({ values = { A1: "1", A2: "2", B1: "3", B2: "4" }, ranges = [range(0, 0, 1, 1)], target = { row: 3, column: 0, address: "A4" }, merges } = {}) {
  return {
    target: { kind: "cell", sheetId: "data", ...target },
    selection: { sheetId: "data", ...ranges[0], ranges },
    workbook: normalizeWorkbook({ sheets: [{ id: "data", name: "Data", rowCount: 1000, columnCount: 100, cells: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])), merges }] }),
  };
}
function result(c) {
  const formula = createSelectionSum(c);
  const workbook = setCellValue(c.workbook, "data", c.target.address, formula);
  return { formula, value: calculateWorkbook(workbook).data[c.target.address] };
}

test("SUM uses captured selection and the independently right-clicked destination", () => {
  assert.deepEqual(result(context()), { formula: "=SUM(A1:B2)", value: 10 });
});

test("SUM requires a cell target when opened from a worksheet tab", () => {
  const c = context();
  c.target = { kind: "sheet", sheetId: "data", name: "Data", index: 0 };
  assert.throws(() => createSelectionSum(c), /セルを右クリック/);
});

test("a destination inside the range is excluded without creating a circular reference", () => {
  assert.deepEqual(result(context({ target: { row: 0, column: 0, address: "A1" } })), { formula: "=SUM(A2:B2,B1)", value: 9 });
});

test("disjoint and overlapping ranges count each source cell once", () => {
  const value = result(context({ ranges: [range(0, 0, 1, 0), range(1, 0, 1, 1), range(0, 0, 0, 0)] }));
  assert.equal(value.value, 7);
  assert.equal(value.formula, "=SUM(A1:A2,B2)");
});

test("a merged destination excludes the whole merged region and keeps other values", () => {
  const c = context({ values: { A1: "50", A2: "2", B2: "4" }, target: { row: 0, column: 0, address: "A1" },
    merges: [{ top: 0, left: 0, bottom: 0, right: 1 }] });
  assert.deepEqual(result(c), { formula: "=SUM(A2:B2)", value: 6 });
});

test("single destination and excessive selections are rejected with actionable messages", () => {
  assert.throws(() => createSelectionSum(context({ ranges: [range(0, 0, 0, 0)], target: { row: 0, column: 0, address: "A1" } })), /集計範囲も選択/);
  assert.throws(() => createSelectionSum(context({ ranges: [range(0, 0, 999, 99)] })), /10,000セル以内/);
});

test("reversed selections preserve geometry and keep the formula compact", () => {
  assert.deepEqual(result(context({ ranges: [range(1, 1, 0, 0)] })), { formula: "=SUM(A1:B2)", value: 10 });
  const formula = createSelectionSum(context({ ranges: [range(0, 0, 999, 0)], target: { row: 3, column: 1, address: "B4" } }));
  assert.equal(formula, "=SUM(A1:A1000)");
});
