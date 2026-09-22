import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ entryPoints: [new URL("../src/ui/use-field-drag.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", write: false, plugins: [{ name: "react", setup(builder) { builder.onResolve({ filter: /^react$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { useFieldDrag } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function pointer(type, x, y, pointerId = 1) { const event = new Event(type, { cancelable: true }); Object.assign(event, { clientX: x, clientY: y, pointerId }); return event; }
async function setup(t, mobile = false) {
  let hook, currentTime = 0, sequence = 0;
  const frames = new Map(), win = new EventTarget(), doc = new EventTarget(), handle = new EventTarget();
  Object.assign(win, { innerWidth: 1000, innerHeight: 600, getComputedStyle: el => ({ overflowY: el.overflow }), requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame: id => frames.delete(id) });
  doc.defaultView = win; handle.ownerDocument = doc; handle.setPointerCapture = () => {}; handle.hasPointerCapture = () => false;
  const viewport = { overflow: "auto", scrollTop: 0, parentElement: null, getBoundingClientRect: () => ({ left: 100, right: 800, top: 100, bottom: 450 }) };
  const canvas = mobile ? { overflow: "visible", parentElement: viewport, getBoundingClientRect: viewport.getBoundingClientRect } : viewport;
  canvas.querySelectorAll = () => ["a", "b", "c"].map((id, index) => ({ dataset: { formFieldId: id }, getBoundingClientRect: () => ({ left: 120, right: 760, top: 110 + index * 110 - viewport.scrollTop, bottom: 200 + index * 110 - viewport.scrollTop }) }));
  const model = { fields: ["a", "b", "c"].map(id => ({ id })) }, moves = [];
  let options = { canvas: { current: canvas }, model, enabled: true, move: (...args) => moves.push(args) }, tree;
  function Harness(props) { hook = useFieldDrag(props); return null; }
  await act(() => { tree = create(h(Harness, options)); }); t.after(() => act(() => tree.unmount()));
  return { get hook() { return hook; }, moves, viewport, canvas, frames, doc, win,
    start: (id = "a", x = 150, y = 150) => act(() => hook.start({ isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: handle }, id)),
    move: (x, y, id) => act(() => doc.dispatchEvent(pointer("pointermove", x, y, id))),
    drop: (x, y, id) => act(() => doc.dispatchEvent(pointer("pointerup", x, y, id))),
    frame: () => act(() => { currentTime += 16; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(currentTime)); }),
    configure: patch => act(() => { options = { ...options, ...patch }; tree.update(h(Harness, options)); }),
  };
}
test("drag shows a compact preview and correct insertion boundary, then commits once", async t => {
  const env = await setup(t); await env.start(); await env.move(152, 152); assert.equal(env.hook.view, null);
  await env.move(170, 340); assert.equal(env.hook.view.fieldId, "a"); assert.deepEqual(env.hook.view.line, { x: 120, y: 323, width: 640 }); assert.equal(env.moves.length, 0);
  await env.drop(170, 340); assert.deepEqual(env.moves, [["a", 1]]); assert.equal(env.hook.view, null); assert.equal(env.frames.size, 0); assert.equal(env.hook.suppressClick(), true);
});
test("first and last insertion positions preserve move index semantics", async t => {
  const env = await setup(t); await env.start(); await env.move(170, 440); await env.drop(170, 440); assert.deepEqual(env.moves, [["a", 2]]);
  await env.start("c", 150, 380); await env.move(170, 120); await env.drop(170, 120); assert.deepEqual(env.moves[1], ["c", 0]);
});
test("edge scroll continues without pointer events and uses mobile scroll parent", async t => {
  const env = await setup(t, true); await env.start(); await env.move(170, 480); await env.frame(); const first = env.viewport.scrollTop; await env.frame();
  assert.ok(first > 0); assert.ok(env.viewport.scrollTop > first); assert.equal(env.moves.length, 0);
  await env.move(170, 90); await env.frame(); assert.ok(env.viewport.scrollTop < first * 2);
  await env.drop(170, 90); assert.equal(env.moves.length, 0); assert.equal(env.frames.size, 0);
});
test("no-op, foreign pointer, escape, cancellation and permission/model changes cannot commit", async t => {
  const env = await setup(t); await env.start(); await env.move(170, 160); assert.equal(env.hook.view.line, null); await env.drop(170, 160); assert.equal(env.moves.length, 0);
  await env.start(); await env.move(170, 350, 2); assert.equal(env.hook.view, null); await env.move(170, 350);
  await act(() => { const event = new Event("keydown", { cancelable: true }); Object.assign(event, { key: "Escape" }); env.doc.dispatchEvent(event); });
  await env.drop(170, 350); assert.equal(env.moves.length, 0); assert.equal(env.frames.size, 0);
  await env.start(); await env.move(170, 350); await env.configure({ enabled: false }); await env.drop(170, 350); assert.equal(env.moves.length, 0); assert.equal(env.hook.view, null);
  await env.configure({ enabled: true }); await env.start(); await env.move(170, 350); await env.configure({ model: { fields: [{ id: "a" }, { id: "c" }] } }); await env.drop(170, 350); assert.equal(env.moves.length, 0);
  await env.start(); await env.move(170, 350); await act(() => env.doc.dispatchEvent(pointer("pointercancel", 170, 350))); assert.equal(env.hook.view, null); assert.equal(env.frames.size, 0);
});

test("mobile drop excludes the palette and inspector outside the visible canvas", async t => {
  const env = await setup(t, true);
  env.canvas.getBoundingClientRect = () => ({left:100,right:800,top:180,bottom:420});
  env.canvas.querySelectorAll = () => ["a", "b", "c"].map((id,index) => ({dataset:{formFieldId:id},getBoundingClientRect:()=>({left:120,right:760,top:190+index*60,bottom:230+index*60})}));
  await env.start("b",150,270); await env.move(170,120); await env.drop(170,120);
  assert.deepEqual(env.moves,[]);
  await env.start("a",150,210); await env.move(170,440); await env.drop(170,440);
  assert.deepEqual(env.moves,[]);
});
test("stationary frames preserve drag presentation identity when there is no scroll",async t=>{
  const env=await setup(t);await env.start();await env.move(170,260);const presentation=env.hook.view;
  await env.frame();await env.frame();assert.equal(env.hook.view,presentation);
});
