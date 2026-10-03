import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, Fragment } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export * from './model-entry'; export * from './state/use-spreadsheet'; export * from './ui/spreadsheet-drawings'; export { SpreadsheetInsertToolbar } from './ui/spreadsheet-insert-toolbar';`, resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'same-react', setup(b) { b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); b.onResolve({ filter: /\/spreadsheet-dialog$/ }, () => ({ path: "dialog", namespace: "inline-dialog" })); b.onLoad({ filter: /.*/, namespace: "inline-dialog" }, () => ({ contents: 'import {createElement, Fragment} from "react"; export const SpreadsheetDialog=({children,actions})=>createElement(Fragment,null,children,actions);', loader: "js" })); } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const box = { id: 'box', type: 'shape', shape: 'rectangle', anchor: { row: 2, column: 2, offsetX: 0, offsetY: 0 }, width: 160, height: 80, fill: '#ffffff', stroke: '#112233', strokeWidth: 2 };
const geometry = { columnOffsets: Array.from({ length: 11 }, (_, i) => 48 + i * 100), rowOffsets: Array.from({ length: 21 }, (_, i) => 28 + i * 28) };
function book() { const b = m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Sheet', cells: {}, rowCount: 20, columnCount: 10, drawings: [box, { ...box, id: 'far', anchor: { row: 10, column: 6, offsetX: 0, offsetY: 0 } }] }] }); const r = m.applySpreadsheetCommands(b, [{ type: 'lines.insert', sheetId: 's', start: { x: 50, y: 40 }, end: { x: 150, y: 40 } }]); assert.equal(r.ok, true); return r.workbook; }
const event = extra => ({ nativeEvent: {}, keyCode: 0, preventDefault() {}, stopPropagation() {}, ...extra });
async function mount(t, overrides = {}) {
  let c, renderer, props = { initialWorkbook: book(), onSave() {}, ...overrides };
  const listeners = new Map(), doc = { activeElement: null, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); }, defaultView: { addEventListener() {}, removeEventListener() {} } };
  const target = { style: {}, scrollHeight: 60, select() {}, ownerDocument: doc, closest: () => null, focus() {}, setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} };
  function Probe() { c = m.useSpreadsheet(props); return createElement(Fragment, null, createElement(m.SpreadsheetDrawings, { controller: c, geometry }), createElement(m.SpreadsheetDrawingInspector, { controller: c }), createElement(m.SpreadsheetInsertToolbar, { controller: c })); }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: node => node.props.className === 'lxs-drawing-layer' ? { ownerDocument: doc, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1048, height: 588 }) } : target }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const id = props.initialWorkbook.sheets[0].drawings[2].id;
  await act(async () => c.selectDrawing(id));
  return { get c() { return c; }, get root() { return renderer.root; }, id, listeners,
    drawing: () => renderer.root.findByProps({ 'data-lxs-drawing': id }),
    endpoint: name => renderer.root.findByProps({ 'aria-label': `直線の${name === 'start' ? '始点' : '終点'}` }),
    pointer: (x, y) => event({ button: 0, pointerId: 1, clientX: x + 48, clientY: y + 28, currentTarget: target }),
    async update(next) { props = { ...props, ...next }; await act(async () => renderer.update(createElement(Probe))); },
    points: () => m.getSpreadsheetLinePoints(c.activeSheet, id),
  };
}

test('line exposes only two endpoint handles and stroke hit area while block arrows keep rectangle controls', async t => {
  const ui = await mount(t);
  assert.equal(ui.drawing().findAllByType('button').length, 2);
  assert.equal(ui.drawing().findAll(node => node.props['data-lxs-resize-corner']).length, 0);
  assert.equal(ui.drawing().findAllByProps({ className: 'lxs-drawing-rotate' }).length, 0);
  assert.equal(ui.drawing().findByProps({ 'data-lxs-line-hit': 'true' }).props.style.pointerEvents, 'stroke');
  assert.equal(ui.drawing().props.style, undefined);
  assert.equal(ui.root.findAllByProps({ 'aria-label': '角度（°）' }).length, 0);
  await ui.update({ readOnly: true });
  assert.equal(ui.drawing().findAllByType('button').length, 0);
});

test('endpoint drag shows only the nearby shape ports, snaps, detaches outside and records one undo', async t => {
  const ui = await mount(t), original = ui.c.workbook;
  await act(async () => ui.endpoint('end').props.onPointerDown(ui.pointer(150, 40)));
  assert.equal(ui.root.findAll(node => node.props['data-lxs-connection-port']).length, 0);
  await act(async () => ui.drawing().props.onPointerMove(ui.pointer(190, 95)));
  const ports = ui.root.findAll(node => node.props['data-lxs-connection-port']);
  assert.equal(ports.length, 8); assert.ok(ports.every(port => port.props['data-lxs-connection-port'].startsWith('box:')));
  assert.equal(ui.c.workbook, original);
  await act(async () => ui.drawing().props.onPointerUp(ui.pointer(204, 95)));
  assert.deepEqual(ui.points().end.binding, { targetId: 'box', port: 'left' });
  assert.equal(ui.points().end.x, 201); assert.equal(ui.points().end.y, 96);
  await act(async () => ui.c.undo()); assert.deepEqual(ui.points().end, { x: 150, y: 40 });
  await act(async () => ui.c.redo());
  await act(async () => ui.c.selectDrawing(ui.id));
  await act(async () => ui.endpoint('end').props.onPointerDown(ui.pointer(201, 96)));
  await act(async () => ui.drawing().props.onPointerMove(ui.pointer(450, 200)));
  assert.equal(ui.root.findAll(node => node.props['data-lxs-connection-port']).length, 0);
  await act(async () => ui.drawing().props.onPointerUp(ui.pointer(450, 200)));
  assert.deepEqual(ui.points().end, { x: 450, y: 200 });
});

test('movement detaches line, keyboard endpoints retain the other end, and marker dropdown edits use history', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.externalExecute({ type: 'lines.update', sheetId: 's', drawingId: ui.id, end: { x: 0, y: 0, binding: { targetId: 'box', port: 'left' } } }));
  const before = ui.points();
  await act(async () => ui.drawing().props.onKeyDown(event({ key: 'ArrowRight', shiftKey: true })));
  assert.equal(ui.points().end.binding, undefined); assert.equal(ui.points().end.x, before.end.x + 10);
  const end = ui.points().end;
  await act(async () => ui.endpoint('start').props.onKeyDown(event({ key: 'ArrowDown' })));
  assert.deepEqual(ui.points().end, end); assert.equal(ui.points().start.y, before.start.y + 1);
  await act(async () => ui.root.findByProps({ 'aria-label': '始点の矢印' }).props.onChange(event({ target: { value: 'diamond' } })));
  assert.equal(ui.c.activeSheet.drawings[2].startArrow, 'diamond');
  await act(async () => ui.c.undo()); assert.equal(ui.c.activeSheet.drawings[2].startArrow, undefined);
});

test('denied permission, stale target, escape and resizing-disabled gestures cannot commit', async t => {
  for (const reason of ['denied', 'stale', 'escape', 'disabled']) {
    const ui = await mount(t, reason === 'denied' ? { onEditRequest: async () => false } : {}), before = ui.points();
    await act(async () => ui.endpoint('end').props.onPointerDown(ui.pointer(150, 40)));
    await act(async () => ui.drawing().props.onPointerMove(ui.pointer(220, 180)));
    if (reason === 'stale') await act(async () => ui.c.externalExecute({ type: 'cells.set', sheetId: 's', values: { A1: 'new' } }));
    if (reason === 'disabled') await ui.update({ features: { resize: false } });
    if (reason === 'escape') await act(async () => ui.drawing().props.onKeyDown(event({ key: 'Escape' })));
    await act(async () => ui.drawing().props.onPointerUp(ui.pointer(220, 180)));
    assert.deepEqual(ui.points(), before, reason);
  }
});

test('line menu has separate four presets and block arrows; all line presets create endpoint geometry', async t => {
  const ui = await mount(t);
  for (const [label, start, end] of [['直線', 'none', 'none'], ['右向き矢印線', 'none', 'triangle'], ['左向き矢印線', 'triangle', 'none'], ['双方向矢印線', 'triangle', 'triangle']]) {
    await act(async () => ui.root.findByProps({ 'aria-label': '図形を挿入' }).props.onClick());
    assert.equal(ui.root.findAllByProps({ 'aria-label': '右ブロック矢印' }).length, 1);
    assert.equal(ui.root.findAllByProps({ 'aria-label': '左ブロック矢印' }).length, 1);
    await act(async () => ui.root.findByProps({ 'aria-label': label, title: label }).props.onClick());
    const drawing = ui.c.activeSheet.drawings.at(-1);
    assert.equal(drawing.shape, 'line'); assert.equal(drawing.startArrow, start); assert.equal(drawing.endArrow, end); assert.ok(drawing.line);
  }
});

test('keyboard whole-line movement clamps one shared delta at the sheet edge and pending permission respects selection', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.externalExecute({ type: 'lines.update', sheetId: 's', drawingId: ui.id, start: { x: 0, y: 20 }, end: { x: 100, y: 20 } }));
  await act(async () => ui.drawing().props.onKeyDown(event({ key: 'ArrowLeft' })));
  assert.deepEqual(ui.points(), { start: { x: 0, y: 20 }, end: { x: 100, y: 20 } });
  let allow;
  const gated = await mount(t, { onEditRequest: () => new Promise(resolve => { allow = resolve; }) });
  const before = gated.points();
  await act(async () => gated.drawing().props.onKeyDown(event({ key: 'ArrowRight' })));
  await act(async () => gated.c.selectDrawing('box'));
  await act(async () => allow(true));
  assert.deepEqual(gated.points(), before);
});

test('line color picker starts with the saved stroke and line text remains editable', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.externalExecute({ type: 'shapes.update', sheetId: 's', drawingId: ui.id, patch: { stroke: '#0f766e' } }));
  assert.equal(ui.root.findByProps({ 'aria-label': '線の色' }).props.defaultValue, '#0f766e');
  await act(async () => ui.drawing().props.onDoubleClick());
  const text = ui.root.findByType('textarea');
  await act(async () => text.props.onChange(event({ target: { value: 'line label' } })));
  await act(async () => text.props.onBlur());
  assert.equal(ui.c.activeSheet.drawings[2].text, 'line label');
});


test('elbow gallery insertion and route switching keep endpoint editing and share the rendered hit path', async t => {
  const ui = await mount(t);
  for (const label of ['折れ線', '矢印付き折れ線']) {
    await act(async () => ui.root.findByProps({ 'aria-label': '図形を挿入' }).props.onClick());
    await act(async () => ui.root.findByProps({ 'aria-label': label, title: label }).props.onClick());
    const line = ui.c.activeSheet.drawings.at(-1);
    assert.equal(line.routing, 'elbow'); assert.equal(line.endArrow, label === '矢印付き折れ線' ? 'triangle' : 'none');
    const node = ui.root.findByProps({ 'data-lxs-drawing': line.id }), paths = node.findAllByType('polyline');
    assert.equal(paths.length, 2); assert.equal(paths[0].props.points, paths[1].props.points);
    assert.ok(paths[0].props.points.split(' ').length > 2); assert.equal(node.findAllByType('button').length, 2);
    assert.equal(ui.root.findByProps({ 'aria-label': '線の経路' }).props.value, 'elbow');
    await act(async () => ui.root.findByProps({ 'aria-label': '線の経路' }).props.onChange(event({ target: { value: 'straight' } })));
    assert.equal(ui.c.activeSheet.drawings.at(-1).routing, undefined);
    await act(async () => ui.c.undo()); assert.equal(ui.c.activeSheet.drawings.at(-1).routing, 'elbow');
  }
});
