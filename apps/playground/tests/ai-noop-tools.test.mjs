import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSlideDeck, createSlideElement, serializeSlideDeck } from "@likex/slide/model";
import { normalizeWorkbook, serializeWorkbook } from "@likex/spreadsheet/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundled = await build({
  stdin: { contents: `export * from './apps/playground/build/ai/tools.ts'; export * from './apps/playground/build/ai/no-change.ts';`, resolveDir: root },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { SkillWorkspace, AIRepetitionError } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const signal = new AbortController().signal;
const slide = serializeSlideDeck(createSlideDeck({ slides: [{ id: "page", name: "Page", notes: "", background: "#ffffff", elements: [
  createSlideElement({ id: "title", type: "text", text: "𰻞𰻞麵", x: 100, y: 230, width: 1080, height: 260, fontSize: 112 }),
  createSlideElement({ id: "second", type: "text", text: "Second", x: 100 }),
] }] }));
const spreadsheet = serializeWorkbook(normalizeWorkbook({ sheets: [{ id: "sheet", name: "Sheet", rowCount: 20, columnCount: 6, cells: { A1: { value: "42" } } }] }));
const update = (patch, elementId = "title") => ({ type: "element.update", slideId: "page", elementId, patch });
const apply = (workspace, commands, dryRun = false) => workspace.invoke("apply_commands", { commands, dryRun, resolvesFailureIds: [] }, signal);
const repetition = error => error instanceof AIRepetitionError && error.details.code === "repeated_no_change";

test("normalized empty patches share a fingerprint despite strict-null fields and JSON key order", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", slide);
  try {
    const first = await apply(workspace, [update({ text: null, x: null, name: null })]);
    assert.equal(first.noChange.code, "empty_patch");
    assert.equal(first.noChange.repeatCount, 1);
    assert.equal(first.noChange.stopAfter, 3);
    const second = await apply(workspace, [{ patch: {}, elementId: "title", slideId: "page", type: "element.update" }]);
    assert.equal(second.noChange.repeatCount, 2);
    await assert.rejects(apply(workspace, [update({})]), repetition);
    assert.deepEqual(workspace.unresolvedWrites, []);
    assert.equal(await readFile(workspace.file, "utf8"), slide);
  } finally { await workspace.dispose(); }
});

test("same-value edits retain their count across inspection and reference reads", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", slide);
  try {
    assert.equal((await apply(workspace, [update({ x: 100, text: "𰻞𰻞麵" })])).noChange.repeatCount, 1);
    await workspace.invoke("inspect_document", { query: { kind: "slide", slideId: "page", includeData: true, elementId: null } }, signal);
    await workspace.invoke("read_reference", { name: "commands.md", offset: 0, limit: 100 }, signal);
    assert.equal((await apply(workspace, [{ patch: { text: "𰻞𰻞麵", x: 100 }, elementId: "title", slideId: "page", type: "element.update" }])).noChange.repeatCount, 2);
    await workspace.invoke("read_skill", {}, signal);
    await assert.rejects(apply(workspace, [update({ x: 100, text: "𰻞𰻞麵" })]), repetition);
    assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});

test("independent targets count separately and an actual document edit resets all counts", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", slide);
  try {
    assert.equal((await apply(workspace, [update({ x: 100 })])).noChange.repeatCount, 1);
    assert.equal((await apply(workspace, [update({ x: 100 }, "second")])).noChange.repeatCount, 1);
    assert.equal((await apply(workspace, [update({ x: 100 })])).noChange.repeatCount, 2);
    const changed = await apply(workspace, [update({ text: "Changed" })]);
    assert.equal(changed.changed, true);
    assert.equal(changed.noChange, undefined);
    assert.equal((await apply(workspace, [update({ x: 100 })])).noChange.repeatCount, 1);
    assert.equal((await apply(workspace, [update({ x: 100 }, "second")])).noChange.repeatCount, 1);
  } finally { await workspace.dispose(); }
});

test("dry-run attempts neither increment nor reset unchanged-edit counts", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", slide);
  try {
    await apply(workspace, [update({ x: 100 })]);
    for (let index = 0; index < 4; index++) assert.equal((await apply(workspace, [update({ x: 100 })], true)).noChange, undefined);
    assert.equal((await apply(workspace, [update({ x: 100 })])).noChange.repeatCount, 2);
    const dry = await apply(workspace, [update({ x: 500 })], true);
    assert.equal(dry.changed, true);
    assert.equal(dry.noChange, undefined);
    await assert.rejects(apply(workspace, [update({ x: 100 })]), repetition);
    assert.equal(await readFile(workspace.file, "utf8"), slide);
  } finally { await workspace.dispose(); }
});

test("Spreadsheet applies the same repetition policy and permits a normal idempotent edit", async () => {
  const workspace = await SkillWorkspace.create(root, "spreadsheet", spreadsheet);
  try {
    const commands = [{ type: "cells.set", sheetId: "sheet", values: { A1: "42" } }];
    const first = await apply(workspace, commands);
    assert.equal(first.changed, false);
    assert.equal(first.noChange.code, "no_change");
    assert.equal(first.noChange.repeatCount, 1);
    assert.equal((await workspace.result(signal)).changed, false);
    await workspace.invoke("inspect_document", { query: { kind: "range", sheetId: "sheet", range: "A1" } }, signal);
    assert.equal((await apply(workspace, [{ values: { A1: "42" }, sheetId: "sheet", type: "cells.set" }])).noChange.repeatCount, 2);
    await assert.rejects(apply(workspace, commands), repetition);
    assert.deepEqual(workspace.unresolvedWrites, []);
    assert.equal(await readFile(workspace.file, "utf8"), spreadsheet);
  } finally { await workspace.dispose(); }
});
