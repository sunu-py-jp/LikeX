import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundle = await build({ absWorkingDir: root,
  entryPoints: ["apps/playground/src/ai/demo-document-editor.tsx"],
  bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", loader: { ".css": "empty" },
  plugins: [{ name: "shared-react", setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { DemoDocumentEditor } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + "\n//# sourceURL=demo-document-editor-test.js").toString("base64")}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function mount(t, overrides = {}) {
  let renderer, unmounted = false;
  const events = [], dialogs = [];
  let props = { title: "設計書", kind: "slide", dirty: false, busy: false, colorMode: "light", onBack: () => events.push("back"),
    onSave: async () => { events.push("save"); return true; }, ...overrides };
  const render = () => h(DemoDocumentEditor, props, h("p", { "data-editor-content": true }, "編集中の内容"));
  await act(async () => { renderer = create(render(), { createNodeMock(element) {
    if (element.type === "dialog") {
      const dialog = { open: false, showModal() { this.open = true; events.push("modal"); }, close() { this.open = false; events.push("close"); } };
      dialogs.push(dialog); return dialog;
    }
    if (element.type === "button") return { focus() { events.push(element.props["aria-label"] ? "focus-back" : "focus-cancel"); } };
    return null;
  } }); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { events, dialogs, unmount, get root() { return renderer.root; },
    get back() { return renderer.root.findByProps({ "aria-label": `${props.kind === "slide" ? "スライド" : "スプレッドシート"}一覧に戻る` }); },
    button(label) { return renderer.root.findAllByType("button").find(button => button.props.children === label); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(render())); },
  };
}

for (const kind of ["slide", "spreadsheet"]) test(`${kind}: a clean document returns without a save, once even on repeated activation`, async t => {
  const ui = await mount(t, { kind });
  assert.equal(ui.root.findByProps({ role: "status" }).props.children, "保存済み");
  await act(async () => { ui.back.props.onClick(); ui.back.props.onClick(); });
  assert.deepEqual(ui.events, ["back"]);
  assert.equal(ui.root.findAllByType("dialog").length, 0);
});

test("busy blocks both the back control and a stale previously captured click handler", async t => {
  const ui = await mount(t, { dirty: true }), oldClick = ui.back.props.onClick;
  await ui.update({ busy: true });
  assert.equal(ui.back.props.disabled, true);
  await act(async () => oldClick());
  assert.equal(ui.root.findAllByType("dialog").length, 0);
  assert.deepEqual(ui.events, []);
  await ui.update({ busy: false });
  await act(async () => ui.back.props.onClick());
  assert.equal(ui.root.findAllByType("dialog").length, 1);
});

test("dirty back uses a modal with a safe initial focus; Cancel and Escape retain the editor", async t => {
  const ui = await mount(t, { dirty: true });
  await act(async () => ui.back.props.onClick());
  const dialog = ui.root.findByType("dialog");
  assert.ok(dialog.props["aria-labelledby"]); assert.ok(dialog.props["aria-describedby"]);
  assert.equal(ui.dialogs[0].open, true); assert.ok(ui.events.includes("focus-cancel"));
  await act(async () => ui.button("キャンセル").props.onClick());
  assert.equal(ui.root.findAllByType("dialog").length, 0); assert.ok(ui.events.includes("focus-back"));
  await act(async () => ui.back.props.onClick());
  let prevented = false;
  await act(async () => ui.root.findByType("dialog").props.onCancel({ preventDefault() { prevented = true; } }));
  assert.equal(prevented, true); assert.equal(ui.root.findAllByType("dialog").length, 0);
  assert.equal(ui.root.findByProps({ "data-editor-content": true }).props.children, "編集中の内容");
  assert.equal(ui.events.includes("save"), false); assert.equal(ui.events.includes("back"), false);
});

test("explicit discard returns without saving and cannot be repeated", async t => {
  const ui = await mount(t, { dirty: true });
  await act(async () => ui.back.props.onClick());
  const discard = ui.button("保存せず戻る").props.onClick;
  await act(async () => { discard(); discard(); });
  assert.equal(ui.events.filter(event => event === "back").length, 1); assert.equal(ui.events.includes("save"), false);
});

test("save waits for persistence, excludes duplicate save/discard/Escape, then returns once", async t => {
  const wait = deferred(); let saves = 0;
  const ui = await mount(t, { dirty: true, onSave: () => { saves++; return wait.promise; } });
  await act(async () => ui.back.props.onClick());
  const save = ui.button("保存して戻る").props.onClick, discard = ui.button("保存せず戻る").props.onClick;
  await act(async () => { save(); save(); discard(); ui.root.findByType("dialog").props.onCancel({ preventDefault() {} }); });
  assert.equal(saves, 1); assert.equal(ui.events.includes("back"), false);
  assert.equal(ui.back.props.disabled, true); assert.equal(ui.button("キャンセル").props.disabled, true);
  // A host can mark its persistence busy while the frame's own save is pending.
  await ui.update({ busy: true });
  await act(async () => wait.resolve(true));
  assert.equal(ui.events.filter(event => event === "back").length, 1);
});

for (const result of [false, "error"]) test(`save ${result === false ? "refusal" : "failure"} preserves the draft and permits retry`, async t => {
  let attempts = 0;
  const ui = await mount(t, { dirty: true, onSave: async () => {
    if (++attempts === 1) { if (result === "error") throw new Error("保存容量が足りません"); return false; }
    return true;
  } });
  await act(async () => ui.back.props.onClick());
  await act(async () => ui.button("保存して戻る").props.onClick());
  assert.equal(ui.events.includes("back"), false);
  assert.ok(ui.root.findByProps({ role: "alert" }).props.children);
  assert.equal(ui.root.findByProps({ "data-editor-content": true }).props.children, "編集中の内容");
  assert.equal(ui.button("保存して戻る").props.disabled, false);
  await act(async () => ui.button("保存して戻る").props.onClick());
  assert.equal(attempts, 2); assert.equal(ui.events.filter(event => event === "back").length, 1);
});

test("late persistence completion after unmount cannot navigate or update the replacement editor", async t => {
  const wait = deferred();
  const ui = await mount(t, { dirty: true, onSave: () => wait.promise });
  await act(async () => ui.back.props.onClick());
  await act(async () => ui.button("保存して戻る").props.onClick());
  await ui.unmount();
  await act(async () => wait.resolve(true));
  assert.equal(ui.events.includes("back"), false);
});

test("a new external busy operation blocks save and discard while allowing the dialog to close", async t => {
  const ui = await mount(t, { dirty: true });
  await act(async () => ui.back.props.onClick());
  const save = ui.button("保存して戻る").props.onClick, discard = ui.button("保存せず戻る").props.onClick;
  await ui.update({ busy: true });
  await act(async () => { save(); discard(); });
  assert.equal(ui.events.includes("save"), false); assert.equal(ui.events.includes("back"), false);
  await act(async () => ui.button("キャンセル").props.onClick());
  assert.equal(ui.root.findAllByType("dialog").length, 0);
});
