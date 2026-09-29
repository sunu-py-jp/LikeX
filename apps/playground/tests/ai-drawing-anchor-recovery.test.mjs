import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeWorkbook, parseWorkbook, serializeWorkbook } from "@likex/spreadsheet/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundled = await build({ stdin: { resolveDir: root, contents: "export * from './apps/playground/build/ai/tools.ts';" }, bundle: true, platform: "node", format: "esm", write: false });
const { SkillWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const source = serializeWorkbook(normalizeWorkbook({ sheets: ["flow", "other"].map(id => ({ id, name: id, rowCount: 100, columnCount: 30, cells: {} })) }));
const imageUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const resource = { name: "pixel.png", mimeType: "image/png", dataUrl: imageUrl, width: 1, height: 1 };
const signal = () => new AbortController().signal;
const anchor = (offsetY = 0, row = 4, column = 2) => ({ row, column, offsetX: 0, offsetY });
const textbox = (text, placement = anchor()) => ({ type: "textBoxes.insert", sheetId: "flow", anchor: placement, text, width: 160, height: 60, fontSize: 16 });
const batch = () => [
  { type: "cells.set", sheetId: "flow", values: { A1: "Flow design" } },
  ...Array.from({ length: 11 }, (_, index) => ({ type: "shapes.insert", sheetId: "flow", anchor: anchor(0, index + 2, 1), shape: "rectangle", text: `Process ${index + 1}`, width: 160, height: 50 })),
  textbox("Validation branch", anchor(-22, 20, 3)),
  textbox("End", anchor(0, 24, 3)),
];
const apply = (workspace, commands, ids = []) => workspace.invoke("apply_commands", { commands, dryRun: false, resolvesFailureIds: ids }, signal());
const unchanged = async workspace => assert.equal(await readFile(workspace.file, "utf8"), workspace.original, "failed batches must never stage partial edits");
const failBatch = async (workspace, commands, expectedIndex) => {
  let failureId;
  await assert.rejects(apply(workspace, commands), error => {
    failureId = error.details?.failureId;
    assert.ok(failureId);
    if (expectedIndex !== undefined) assert.equal(error.details.path, `commands[${expectedIndex}]`);
    return true;
  });
  await unchanged(workspace);
  return failureId;
};

test("a 14-command flow batch recovers only the invalid label anchor and retains every earlier operation", async () => {
  for (const repairedAnchor of [anchor(30, 20, 3), anchor(30, 21, 4)]) {
    const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
    try {
      const commands = batch(), failureId = await failBatch(workspace, commands, 12);
      commands[12].anchor = repairedAnchor;
      await apply(workspace, commands, [failureId]);
      assert.deepEqual(workspace.unresolvedWrites, []);
      const result = await workspace.result(signal()), workbook = parseWorkbook(result.document);
      assert.equal(result.changed, true);
      const sheet = workbook.sheets.find(item => item.id === "flow");
      assert.equal(sheet.cells.A1.value, "Flow design");
      assert.equal(sheet.drawings.length, 13);
      assert.deepEqual(sheet.drawings.find(item => item.text === "Validation branch").anchor, repairedAnchor);
      assert.equal(sheet.drawings.filter(item => item.type === "shape").length, 11);
      assert.equal(workbook.sheets.find(item => item.id === "other").drawings, undefined);
    } finally { await workspace.dispose(); }
  }
});

test("invalid-anchor recovery is available for image, shape and text insertion through the native CLI", async () => {
  for (const command of [
    { type: "images.insert", sheetId: "flow", resource, anchor: anchor(-22), width: 100, height: 80 },
    { type: "shapes.insert", sheetId: "flow", shape: "rectangle", text: "Process", anchor: anchor(-22), width: 100, height: 80 },
    textbox("Label", anchor(-22)),
  ]) {
    const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
    try {
      const commands = [{ type: "cells.set", sheetId: "flow", values: { A1: "Preserved" } }, command];
      const failureId = await failBatch(workspace, commands, 1);
      const corrected = structuredClone(commands); corrected[1].anchor = anchor(30, 7, 5);
      await apply(workspace, corrected, [failureId]);
      const workbook = parseWorkbook((await workspace.result(signal())).document), sheet = workbook.sheets.find(item => item.id === "flow");
      assert.equal(sheet.cells.A1.value, "Preserved");
      assert.equal(sheet.drawings.length, 1);
      assert.deepEqual(sheet.drawings[0].anchor, anchor(30, 7, 5));
      assert.deepEqual(workspace.unresolvedWrites, []);
    } finally { await workspace.dispose(); }
  }
});

test("sheet-local row and column bounds are checked again after an anchor repair", async () => {
  for (const invalidAnchor of [anchor(0, 100, 2), anchor(0, 4, 30)]) {
    const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
    try {
      const commands = [{ type: "cells.set", sheetId: "flow", values: { A1: "Bounds check" } }, textbox("Within sheet", invalidAnchor)];
      const failureId = await failBatch(workspace, commands, 1);
      const corrected = structuredClone(commands); corrected[1].anchor = anchor(10, 110, 35);
      await assert.rejects(apply(workspace, corrected, [failureId]), error => {
        assert.equal(error.details.code, "write_failed");
        assert.equal(error.details.path, "commands[1]");
        assert.equal(error.details.failureId, failureId);
        return true;
      });
      await unchanged(workspace);
      corrected[1].anchor = anchor(10, 90, 25);
      await apply(workspace, corrected, [failureId]);
      assert.deepEqual(workspace.unresolvedWrites, []);
      const sheet = parseWorkbook((await workspace.result(signal())).document).sheets.find(item => item.id === "flow");
      assert.deepEqual(sheet.drawings[0].anchor, anchor(10, 90, 25));
      assert.equal(sheet.cells.A1.value, "Bounds check");
    } finally { await workspace.dispose(); }
  }
});

test("anchor repair does not authorize partial batches, different sheets, changed labels or another drawing's anchor", async () => {
  for (const mutate of [
    commands => commands.slice(1),
    commands => { commands[11].anchor = anchor(99); return commands; },
    commands => { commands[12].sheetId = "other"; return commands; },
    commands => { commands[12].text = "Unrequested replacement"; return commands; },
    commands => { commands[12].fontSize = 18; return commands; },
    commands => { commands[12].width = 200; return commands; },
    commands => { commands[12].anchor.offsetX = -1; return commands; },
  ]) {
    const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
    try {
      const commands = batch(), failureId = await failBatch(workspace, commands, 12);
      const corrected = structuredClone(commands); corrected[12].anchor = anchor(30, 20, 3);
      await assert.rejects(apply(workspace, mutate(corrected), [failureId]), error => error.details?.code === "incomplete_write_recovery");
      await unchanged(workspace);
      assert.equal(workspace.unresolvedWrites.length, 1);
      await assert.rejects(workspace.result(signal()), /失敗した編集/);
    } finally { await workspace.dispose(); }
  }
});

test("valid anchors cannot be moved while repairing invalid dimensions or typography", async () => {
  for (const invalidFields of [{ width: -20 }, { fontSize: 0 }]) {
    const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
    try {
      const commands = [{ ...textbox("Fixed target", anchor(20)), ...invalidFields }];
      const failureId = await failBatch(workspace, commands);
      const corrected = [{ ...commands[0], ...("width" in invalidFields ? { width: 160 } : { fontSize: 16 }), anchor: anchor(30, 7, 5) }];
      await assert.rejects(apply(workspace, corrected, [failureId]), error => error.details?.code === "incomplete_write_recovery");
      await unchanged(workspace);
      corrected[0].anchor = commands[0].anchor;
      await apply(workspace, corrected, [failureId]);
      const sheet = parseWorkbook((await workspace.result(signal())).document).sheets.find(item => item.id === "flow");
      assert.deepEqual(sheet.drawings[0].anchor, anchor(20));
    } finally { await workspace.dispose(); }
  }
});

test("repairing existing drawing updates retains the original drawing ID", async () => {
  const drawing = id => ({ id, type: "text", anchor: anchor(), text: id, width: 160, height: 60, fontSize: 16, color: "#111111", background: "transparent" });
  const existing = serializeWorkbook(normalizeWorkbook({ sheets: [{ id: "flow", name: "flow", rowCount: 100, columnCount: 30, cells: {}, drawings: [drawing("original"), drawing("other-drawing")] }] }));
  const workspace = await SkillWorkspace.create(root, "spreadsheet", existing);
  try {
    const commands = [{ type: "textBoxes.update", sheetId: "flow", drawingId: "original", patch: { width: -20 } }];
    const failureId = await failBatch(workspace, commands, 0);
    await assert.rejects(apply(workspace, [{ ...commands[0], drawingId: "other-drawing", patch: { width: 200 } }], [failureId]), error => error.details?.code === "incomplete_write_recovery");
    await unchanged(workspace);
    await apply(workspace, [{ ...commands[0], patch: { width: 200 } }], [failureId]);
    const drawings = parseWorkbook((await workspace.result(signal())).document).sheets[0].drawings;
    assert.equal(drawings.find(item => item.id === "original").width, 200);
    assert.equal(drawings.find(item => item.id === "other-drawing").width, 160);
  } finally { await workspace.dispose(); }
});
