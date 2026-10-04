import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { create } from "react-test-renderer";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = await build({ stdin: { contents: `export {default as Demo} from './apps/playground/src/explorer-picker-demo'; export {createDraftSnapshot,resolveExplorerPickerItems} from './packages/explorer/src/model-entry';`, resolveDir: root }, bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", loader: { ".css": "empty" },
  plugins: [{ name: "picker-boundary", setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^@likex\/explorer\/model$/ }, () => ({ path: `${root}packages/explorer/src/model-entry.ts` }));
    builder.onResolve({ filter: /^@likex\/explorer$/ }, () => ({ path: "explorer", namespace: "picker-boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "picker-boundary" }, () => ({ resolveDir: root, contents: `import {createElement} from 'react'; export const ExplorerPicker=props=>createElement('demo-picker',props); export const ExplorerPickerDialog=props=>createElement('demo-picker-dialog',props);` }));
  } }],
});
const { Demo, createDraftSnapshot, resolveExplorerPickerItems } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("picker demo starts with a valid complete root only and passes cancellation to lazy reads", async () => {
  let renderer;
  await act(async () => { renderer = create(createElement(Demo)); });
  try {
    const props = renderer.root.findByType("demo-picker").props;
    assert.equal(props.initialEntries.length, 4);
    assert.ok(props.initialEntries.every(entry => entry.parent === "root"));
    assert.doesNotThrow(() => createDraftSnapshot(props.initialEntries));
    assert.deepEqual(props.folderLoading.initialLoadedFolderIds, ["root"]);
    const controller = new AbortController(); controller.abort();
    await act(async () => { await assert.rejects(props.onLoadFolder({ folderId: "lazy-sales", path: "/営業資料" }, { signal: controller.signal }), { name: "AbortError" }); });
    const stream = props.onSearchRequest({ query: "機能仕様", conditions: { matchCase: false, wholeName: false, useRegex: false } }, { signal: controller.signal });
    await assert.rejects(stream.next(), { name: "AbortError" });
  } finally { await act(async () => renderer.unmount()); }
});

test("selection candidates are separate from confirmation, and cancel retains the committed result", async () => {
  let renderer;
  await act(async () => { renderer = create(createElement(Demo)); });
  try {
    const props = renderer.root.findByType("demo-picker").props;
    const selection = resolveExplorerPickerItems(props.initialEntries, ["lazy-readme"]);
    assert.equal(selection.ok, true);
    await act(async () => props.onSelectionChange(selection.items));
    assert.equal(renderer.root.findAllByProps({ className: "picker-demo-results" }).length, 0);
    await act(async () => props.onConfirm(selection.items));
    const results = renderer.root.findByProps({ className: "picker-demo-results" });
    assert.equal(results.findByType("strong").children.join(""), "このデモについて.md");
    await act(async () => renderer.root.findByType("demo-picker").props.onCancel());
    assert.equal(renderer.root.findByProps({ className: "picker-demo-results" }).findByType("code").children.join(""), "/このデモについて.md");
  } finally { await act(async () => renderer.unmount()); }
});

test("all four modes are shared by embedded and controlled dialog pickers", async () => {
  let renderer;
  await act(async () => { renderer = create(createElement(Demo)); });
  try {
    const expected = [["file", false], ["file", true], ["folder", false], ["both", true]];
    for (let index = 0; index < expected.length; index++) {
      await act(async () => renderer.root.findAllByProps({ className: "picker-demo-mode" })[index].props.onClick());
      const embedded = renderer.root.findByType("demo-picker").props, dialog = renderer.root.findByType("demo-picker-dialog").props;
      assert.deepEqual([embedded.kind, embedded.multiple], expected[index]);
      assert.deepEqual([dialog.kind, dialog.multiple], expected[index]);
    }
    await act(async () => renderer.root.findByProps({ className: "picker-demo-launch" }).props.onClick());
    assert.equal(renderer.root.findByType("demo-picker-dialog").props.open, true);
    await act(async () => renderer.root.findByType("demo-picker-dialog").props.onOpenChange(false));
    assert.equal(renderer.root.findByType("demo-picker-dialog").props.open, false);
  } finally { await act(async () => renderer.unmount()); }
});
