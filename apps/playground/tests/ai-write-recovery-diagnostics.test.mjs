import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSlideDeck, createSlideElement, parseSlideDeck, serializeSlideDeck } from "@likex/slide/model";
import { normalizeWorkbook, parseWorkbook, serializeWorkbook } from "@likex/spreadsheet/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const built = await build({ stdin: { resolveDir: root, contents: "export * from './apps/playground/build/ai/tools.ts'; export * from './apps/playground/build/ai/write-diagnostics.ts'; export * from './apps/playground/build/ai/tool-errors.ts';" }, bundle: true, platform: "node", format: "esm", write: false });
const { SkillWorkspace, WriteFailures, AIToolError } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const signal = () => new AbortController().signal;
const apply = (workspace, commands, resolvesFailureIds = []) => workspace.invoke("apply_commands", { commands, resolvesFailureIds, dryRun: false }, signal());
const capture = async action => { let result; await assert.rejects(action, error => { result = error; return true; }); return result; };
const goodId = "0e518726-2ab2-436b-9cce-53e1eb2b6897", typoId = "0e518726-2ab1-436b-9cce-53e1eb2b6897";
const initial = serializeSlideDeck(createSlideDeck({ slides: [{ id: "slide-architecture", name: "Before", notes: "", background: "#fff",
  elements: ["heading", goodId, "body", "footer"].map(id => createSlideElement({ id, type: "text", text: id })) }] }));
function batch() { return [
  { type: "element.update", slideId: "slide-architecture", elementId: "heading", patch: { x: 64, width: 1180 } },
  { type: "element.delete", slideId: "slide-architecture", elementIds: [typoId, "body", "footer"] },
  ...Array.from({ length: 16 }, (_, index) => ({ type: "element.add", slideId: "slide-architecture", element: { id: `architecture-${index}`, type: "text", text: `Architecture ${index}`, x: 50 + index * 40, y: 200 } })),
  { type: "slide.update", slideId: "slide-architecture", patch: { name: "ERP architecture" } },
]; }
const repaired = commands => commands.map((command, index) => index === 1 ? { ...command, elementIds: [goodId, "body", "footer"] } : command);

test("19-command UUID typo recovery identifies the missing inspection without changing the pending write", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", initial);
  try {
    const commands = batch(), first = await capture(apply(workspace, commands)), id = first.details.failureId;
    assert.equal(first.details.code, "unknown_id"); assert.equal(first.details.path, "commands[1].elementIds[0]");
    const failures = workspace.unresolvedWrites, corrected = repaired(commands);
    // Knowing the ID from an earlier read or from the error is not a fresh inspection.
    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await capture(apply(workspace, corrected, [id]));
      assert.equal(error.details.code, "write_recovery_requires_inspection"); assert.equal(error.details.failureId, id);
      assert.equal(error.details.path, "commands[1].elementIds[0]"); assert.match(error.message, /対象・操作は揃っています/);
      assert.deepEqual(error.details.expected, { tool: "inspect_document", arguments: { query: { kind: "slide", slideId: "slide-architecture", includeData: true, elementId: null } } });
      assert.match(error.details.retry, /Do not send another write before the inspection/);
      assert.deepEqual(workspace.unresolvedWrites, failures); assert.equal(await readFile(workspace.file, "utf8"), initial);
    }
    await workspace.invoke("validate_document", {}, signal());
    assert.equal((await capture(apply(workspace, corrected, [id]))).details.code, "write_recovery_requires_inspection");
    await workspace.invoke("inspect_document", { query: { kind: "slide", slideId: "slide-architecture", includeData: true, elementId: null } }, signal());
    await apply(workspace, corrected, [id]);
    assert.deepEqual(workspace.unresolvedWrites, []);
    const slide = parseSlideDeck(await readFile(workspace.file, "utf8")).slides[0];
    assert.equal(slide.name, "ERP architecture"); assert.equal(slide.elements.length, 17); assert.equal(slide.elements.find(element => element.id === "heading").x, 64);
    assert.equal(slide.elements.some(element => element.id === goodId), false);
  } finally { await workspace.dispose(); }
});

test("partial replacement is diagnosed as incomplete metadata coverage, not merely missing inspection", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", initial);
  try {
    const first = await capture(apply(workspace, batch())), id = first.details.failureId;
    const replacement = { type: "slide.replaceContent", slideId: "slide-architecture", elements: [{ id: "replacement", type: "text", text: "Complete architecture" }] };
    for (const inspected of [false, true]) {
      if (inspected) await workspace.invoke("inspect_document", { query: { kind: "slide", slideId: "slide-architecture", includeData: true, elementId: null } }, signal());
      const error = await capture(apply(workspace, [replacement], [id]));
      assert.equal(error.details.code, "incomplete_write_recovery"); assert.match(error.message, /再取得だけでは/);
      assert.equal(error.details.expected.commandCount, 19); assert.ok(error.details.expected.operationTypes.includes("slide.update"));
      assert.match(error.details.retry, /also retain slide.update metadata/);
      assert.equal(await readFile(workspace.file, "utf8"), initial);
    }
    await apply(workspace, [replacement, batch().at(-1)], [id]);
    assert.deepEqual(workspace.unresolvedWrites, []);
    const slide = parseSlideDeck(await readFile(workspace.file, "utf8")).slides[0];
    assert.equal(slide.name, "ERP architecture"); assert.equal(slide.elements[0].text, "Complete architecture");
  } finally { await workspace.dispose(); }
});

test("diagnostic probing cannot authorize a read or forgive changed valid targets, omitted fields or unrelated IDs", () => {
  const commands = [{ type: "element.update", slideId: "page", elementId: "typo", patch: { text: "A", x: 30 } },
    { type: "element.update", slideId: "page", elementId: "fixed", patch: { text: "B" } }];
  const tracker = new WriteFailures(); tracker.inspected();
  const failure = tracker.failed("apply", commands, new AIToolError("Unknown", { code: "unknown_id", path: "commands[0].elementId", actual: "typo", expected: { existingIds: ["known", "other", "fixed"] } }));
  const ids = [failure.details.failureId], corrected = commands.map((command, index) => index ? command : { ...command, elementId: "known" });
  const needsRead = error => error.details.code === "write_recovery_requires_inspection";
  assert.throws(() => tracker.prepare("apply", corrected, ids), needsRead);
  assert.throws(() => tracker.prepare("apply", corrected, ids), needsRead);
  const invalid = [corrected.slice(0, 1), [corrected[0], { ...corrected[1], elementId: "other" }],
    [{ ...corrected[0], patch: { text: "A" } }, corrected[1]], [{ ...corrected[0], elementId: "another-typo" }, corrected[1]]];
  for (const value of invalid) assert.throws(() => tracker.prepare("apply", value, ids), error => error.details.code === "incomplete_write_recovery");
  assert.equal(tracker.unresolved.length, 1); tracker.inspected();
  assert.doesNotThrow(() => tracker.prepare("apply", corrected, ids));
  for (const value of invalid) assert.throws(() => tracker.prepare("apply", value, ids), error => error.details.code === "incomplete_write_recovery");
  assert.equal(tracker.unresolved.length, 1, "preparing a valid recovery does not resolve it before execution");
});

test("unknown spreadsheet sheet ID asks for the ID list and safely recovers only after that read", async () => {
  const source = serializeWorkbook(normalizeWorkbook({ sheets: [{ id: "correct-sheet", name: "Sheet", rowCount: 10, columnCount: 10, cells: {} }] }));
  const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
  try {
    const commands = [{ type: "cells.set", sheetId: "typo-sheet", values: { A1: "Value" } }];
    const first = await capture(apply(workspace, commands)), id = first.details.failureId;
    const corrected = [{ ...commands[0], sheetId: "correct-sheet" }], error = await capture(apply(workspace, corrected, [id]));
    assert.equal(error.details.code, "write_recovery_requires_inspection");
    assert.deepEqual(error.details.expected, { tool: "inspect_document", arguments: { query: { kind: "list" } } });
    assert.equal(await readFile(workspace.file, "utf8"), source);
    await workspace.invoke(error.details.expected.tool, error.details.expected.arguments, signal());
    await apply(workspace, corrected, [id]);
    assert.equal(parseWorkbook(await readFile(workspace.file, "utf8")).sheets[0].cells.A1.value, "Value");
    assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});

test("wrong page IDs and invalid sheet positions get valid inspection selectors; malformed batches still report coverage", () => {
  for (const [command, path, value, fixed, query] of [
    [{ type: "slide.update", slideId: "bad-page", patch: { name: "A" } }, "slideId", "bad-page", "page", { kind: "list" }],
    [{ type: "rows.delete", sheetId: "sheet", index: 100, count: 1 }, "index", 100, 3, { kind: "sheet", sheetId: "sheet", includeData: true, offset: null, limit: null }],
  ]) {
    const tracker = new WriteFailures(), failure = tracker.failed("apply", [command], new AIToolError("invalid", { code: typeof value === "string" ? "unknown_id" : "invalid_argument", path: `commands[0].${path}`, actual: value, expected: { existingIds: [fixed] } }));
    assert.throws(() => tracker.prepare("apply", [{ ...command, [path]: fixed }], [failure.details.failureId]), error => {
      assert.equal(error.details.code, "write_recovery_requires_inspection"); assert.deepEqual(error.details.expected.arguments, { query }); return true;
    });
  }
  const tracker = new WriteFailures(), failure = tracker.failed("apply", [null], new AIToolError("invalid", { code: "invalid_argument", path: "commands[0]" }));
  assert.throws(() => tracker.prepare("apply", [{ type: "slide.update", slideId: "page", patch: { name: "A" } }], [failure.details.failureId]), error => error.details.code === "incomplete_write_recovery");
});
