import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement, Fragment } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({
  stdin: { contents: 'export * from "./src/state/use-spreadsheet"; export * from "./src/ui/spreadsheet-comments"; export * from "./src/ui/spreadsheet-drawings";', resolveDir: packageRoot, sourcefile: 'drawing-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { useSpreadsheet, SpreadsheetComments, SpreadsheetDrawings, SpreadsheetDrawingInspector } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const shape = { id: 'shape', type: 'shape', shape: 'rectangle', anchor: { row: 0, column: 0, offsetX: 10, offsetY: 10 }, width: 100, height: 60, fill: '#ffffff', stroke: '#217346', strokeWidth: 2 };
const textBox = { id: 'text', type: 'text', anchor: { row: 2, column: 0, offsetX: 0, offsetY: 0 }, width: 150, height: 80, text: 'before', color: 'currentColor', background: 'transparent', fontSize: 16 };
const book = () => ({ sheets: [{ id: 'one', name: 'Sheet1', rowCount: 10, columnCount: 10, cells: {}, drawings: [shape, textBox], comments: { A1: { id: 'comment', text: 'initial' } } }] });
const geometry = { columnOffsets: Array.from({ length: 11 }, (_, i) => 48 + i * 100), rowOffsets: Array.from({ length: 11 }, (_, i) => 28 + i * 28) };
function event(overrides = {}) { return { nativeEvent: {}, target: { closest: () => null }, preventDefault() {}, stopPropagation() {}, ...overrides }; }
async function mount(t, options = {}) {
  let current, renderer;
  const saves = [];
  let props = { initialWorkbook: book(), onSave: wb => { saves.push(wb); }, ...options };
  function Probe() {
    const c = useSpreadsheet(props); current = c;
    return createElement(Fragment, null, createElement(SpreadsheetComments, { controller: c }), createElement(SpreadsheetDrawings, { controller: c, geometry }), createElement(SpreadsheetDrawingInspector, { controller: c }));
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: element => element.props.className === 'lxs-drawing-layer' ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1048, height: 308 }) } : null }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return {
    get c() { return current; }, get root() { return renderer.root; }, saves,
    textarea: () => renderer.root.findAllByType('textarea')[0],
    property: name => renderer.root.findAllByType('input').find(input => input.props['aria-label'] === name),
    drawing: id => renderer.root.findAllByType('div').find(div => div.props['data-lxs-drawing'] === id),
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
  };
}

test('comments can be applied repeatedly, then saved with the latest text', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.setCommentOpen(true));
  for (const text of ['first edit', 'second edit']) {
    await act(async () => ui.textarea().props.onChange(event({ target: { value: text } })));
    assert.equal(ui.c.pendingObjectEdit, true);
    await act(async () => ui.textarea().props.onBlur());
    assert.equal(ui.c.activeSheet.comments.A1.text, text);
    assert.equal(ui.c.pendingObjectEdit, false);
  }
  await act(async () => ui.c.save());
  assert.equal(ui.saves[0].sheets[0].comments.A1.text, 'second edit');
  assert.equal(ui.c.dirty, false);
});

test('invalid property remains pending when another property succeeds and blocks save until cancelled', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectDrawing('shape'));
  await act(async () => ui.property('幅').props.onChange(event({ target: { value: '0' } })));
  await act(async () => ui.property('幅').props.onBlur());
  assert.equal(ui.c.activeSheet.drawings[0].width, 100);
  assert.equal(ui.c.pendingObjectEdit, true);
  await act(async () => ui.property('高さ').props.onChange(event({ target: { value: '80' } })));
  await act(async () => ui.property('高さ').props.onBlur());
  assert.equal(ui.c.activeSheet.drawings[0].height, 80);
  assert.equal(ui.c.pendingObjectEdit, true);
  await act(async () => ui.c.save());
  assert.equal(ui.saves.length, 0);
  await act(async () => ui.property('幅').props.onKeyDown(event({ key: 'Escape' })));
  assert.equal(ui.c.pendingObjectEdit, false);
  await act(async () => ui.c.save());
  assert.equal(ui.saves.length, 1);
});

test('text box Ctrl+S commits its pending text before saving; Escape discards it', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectDrawing('text'));
  await act(async () => ui.drawing('text').props.onKeyDown(event({ key: 'Enter' })));
  await act(async () => ui.textarea().props.onChange(event({ target: { value: 'saved text' } })));
  await act(async () => ui.textarea().props.onKeyDown(event({ key: 's', ctrlKey: true })));
  assert.equal(ui.saves[0].sheets[0].drawings[1].text, 'saved text');
  assert.equal(ui.c.pendingObjectEdit, false);
  await act(async () => ui.drawing('text').props.onKeyDown(event({ key: 'Enter' })));
  await act(async () => ui.textarea().props.onChange(event({ target: { value: 'cancel this' } })));
  await act(async () => ui.textarea().props.onKeyDown(event({ key: 'Escape' })));
  assert.equal(ui.c.activeSheet.drawings[1].text, 'saved text');
  assert.equal(ui.c.pendingObjectEdit, false);
});

test('shape text is edited as one drawing, saved, undone and redone independently of text-box features', async t => {
  const ui = await mount(t, { features: { textBoxes: false } });
  await act(async () => ui.c.selectDrawing('shape'));
  await act(async () => ui.drawing('shape').props.onDoubleClick());
  assert.equal(ui.textarea().props['aria-label'], '図形の文字');
  await act(async () => ui.textarea().props.onChange(event({ target: { value: '内容確認\n担当：総務' } })));
  assert.equal(ui.c.pendingObjectEdit, true);
  await act(async () => ui.textarea().props.onBlur());
  assert.equal(ui.c.pendingObjectEdit, false);
  assert.equal(ui.c.activeSheet.drawings[0].text, '内容確認\n担当：総務');
  assert.equal(ui.c.activeSheet.drawings.length, 2, 'text stays in the original shape');
  await act(async () => ui.c.undo());
  assert.equal(ui.c.activeSheet.drawings[0].text, undefined);
  await act(async () => ui.c.redo());
  assert.equal(ui.c.activeSheet.drawings[0].text, '内容確認\n担当：総務');
  await act(async () => ui.c.selectDrawing('shape'));
  await act(async () => ui.property('文字色').props.onChange(event({ target: { value: '#1e3a5f' } })));
  await act(async () => ui.property('文字色').props.onBlur());
  await act(async () => ui.drawing('shape').props.onKeyDown(event({ key: 'Enter' })));
  await act(async () => ui.textarea().props.onChange(event({ target: { value: '保存するラベル' } })));
  await act(async () => ui.textarea().props.onKeyDown(event({ key: 's', ctrlKey: true })));
  assert.equal(ui.saves[0].sheets[0].drawings[0].text, '保存するラベル');
  assert.equal(ui.saves[0].sheets[0].drawings[0].color, '#1e3a5f');
});

test('shape text cancellation, readonly and shape feature removal cannot mutate the drawing', async t => {
  const ui = await mount(t);
  const original = ui.c.workbook;
  await act(async () => ui.c.selectDrawing('shape'));
  await act(async () => ui.drawing('shape').props.onKeyDown(event({ key: 'Enter' })));
  await act(async () => ui.textarea().props.onChange(event({ target: { value: '取り消す文字' } })));
  await act(async () => ui.textarea().props.onKeyDown(event({ key: 'Escape' })));
  assert.equal(ui.c.workbook, original);
  assert.equal(ui.c.pendingObjectEdit, false);
  await act(async () => ui.drawing('shape').props.onDoubleClick());
  await act(async () => ui.textarea().props.onChange(event({ target: { value: '未確定' } })));
  await ui.update({ features: { shapes: false } });
  assert.equal(ui.drawing('shape'), undefined);
  assert.equal(ui.c.pendingObjectEdit, false);
  assert.equal(ui.c.workbook, original);
  await ui.update({ features: {}, readOnly: true });
  await act(async () => ui.c.selectDrawing('shape'));
  await act(async () => ui.drawing('shape').props.onDoubleClick());
  assert.equal(ui.root.findAllByType('textarea').length, 0);
  assert.equal(ui.property('文字色').props.disabled, true);
});

test('drawing drag previews do not mutate the workbook and one completed gesture is one undo step', async t => {
  const ui = await mount(t);
  const pointerTarget = { ownerDocument: { activeElement: null }, closest: () => null, focus() {}, setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} };
  const pointer = (x, y) => event({ button: 0, pointerId: 1, currentTarget: pointerTarget, clientX: x, clientY: y });
  const before = ui.c.workbook;
  await act(async () => ui.drawing('shape').props.onPointerDown(pointer(70, 50)));
  await act(async () => ui.drawing('shape').props.onPointerMove(pointer(120, 80)));
  assert.equal(ui.c.workbook, before);
  await act(async () => ui.drawing('shape').props.onPointerMove(pointer(160, 90)));
  await act(async () => ui.drawing('shape').props.onPointerUp(pointer(160, 90)));
  assert.notEqual(ui.c.workbook, before);
  assert.deepEqual(ui.c.activeSheet.drawings[0].anchor, { row: 1, column: 1, offsetX: 0, offsetY: 22 });
  await act(async () => ui.c.undo());
  assert.equal(ui.c.workbook, before);
  await act(async () => ui.drawing('shape').props.onPointerDown(pointer(70, 50)));
  await act(async () => ui.drawing('shape').props.onPointerMove(pointer(120, 80)));
  await act(async () => ui.drawing('shape').props.onPointerCancel());
  assert.equal(ui.c.workbook, before);
});

test('feature changes and readonly mode remove mutation entry points and pending object drafts', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectDrawing('text'));
  await act(async () => ui.drawing('text').props.onKeyDown(event({ key: 'Enter' })));
  await act(async () => ui.textarea().props.onChange(event({ target: { value: 'unsaved editor' } })));
  await ui.update({ features: { textBoxes: false, shapes: false, comments: false } });
  assert.equal(ui.drawing('text'), undefined);
  assert.equal(ui.drawing('shape'), undefined);
  assert.equal(ui.c.pendingObjectEdit, false);
  await ui.update({ features: {}, readOnly: true });
  await act(async () => { ui.c.selectDrawing('shape'); ui.c.setCommentOpen(true); });
  assert.equal(ui.property('幅').props.disabled, true);
  assert.equal(ui.root.findAllByType('textarea').length, 0);
  assert.equal(ui.c.dirty, false);
});

test('pointer selection flushes a focused comment before its editor is replaced', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.setCommentOpen(true));
  await act(async () => ui.textarea().props.onChange(event({ target: { value: 'kept on selection' } })));
  const editor = { matches: () => true, blur: () => ui.textarea().props.onBlur() };
  const pointerTarget = { ownerDocument: { activeElement: editor }, closest: () => ({ contains: element => element === editor }), focus() {}, setPointerCapture() {}, hasPointerCapture: () => false };
  await act(async () => ui.drawing('shape').props.onPointerDown(event({ button: 0, pointerId: 1, currentTarget: pointerTarget, clientX: 70, clientY: 50 })));
  assert.equal(ui.c.activeSheet.comments.A1.text, 'kept on selection');
  assert.equal(ui.c.pendingObjectEdit, false);
});

test('external drawing updates invalidate move and resize previews before the next React render', async t => {
  for (const kind of ['move', 'resize']) {
    const ui = await mount(t);
    await act(async () => ui.c.selectDrawing('shape'));
    const pointerTarget = { ownerDocument: { activeElement: null }, closest: () => null, focus() {}, setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} };
    const pointer = (x, y) => event({ button: 0, pointerId: 1, currentTarget: pointerTarget, clientX: x, clientY: y });
    const target = () => kind === 'move' ? ui.drawing('shape') : ui.drawing('shape').findByProps({ className: 'lxs-drawing-resize' });
    const before = ui.c.getWorkbook();
    await act(async () => target().props.onPointerDown(pointer(70, 50)));
    await act(async () => target().props.onPointerMove(pointer(160, 90)));
    assert.equal(ui.c.getWorkbook(), before);
    let externalSnapshot;
    await act(async () => {
      assert.equal(ui.c.externalExecute({ type: 'shapes.update', sheetId: 'one', drawingId: 'shape', patch: { anchor: { row: 4, column: 3 }, width: 240, height: 120 } }).ok, true);
      externalSnapshot = ui.c.getWorkbook();
      // Pointer release can share a tick with a host command, before props refresh.
      target().props.onPointerUp(pointer(160, 90));
      assert.equal(ui.c.getWorkbook(), externalSnapshot, kind);
    });
    assert.deepEqual(ui.c.activeSheet.drawings[0].anchor, { row: 4, column: 3, offsetX: 0, offsetY: 0 });
    assert.equal(ui.c.activeSheet.drawings[0].width, 240);
    assert.equal(ui.c.activeSheet.drawings[0].height, 120);
    await act(async () => ui.c.undo());
    assert.equal(ui.c.getWorkbook(), before, 'cancelled preview does not add an undo entry');
  }
});

function imageBook(width = 333, height = 200) {
  const workbook = book();
  workbook.resources = { images: { pixel: { name: 'pixel.png', mimeType: 'image/png', width: 1, height: 1,
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=' } } };
  // An explicitly sized frame remains valid even if it differs from the source image.
  workbook.sheets[0].drawings.push({ id: 'picture', type: 'image', resourceId: 'pixel', alt: 'Image',
    anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 }, width, height });
  return workbook;
}
const picture = ui => ui.c.activeSheet.drawings.find(item => item.id === 'picture');
const sameRatio = (dimensions, expected) => assert.ok(Math.abs(dimensions.width / dimensions.height - expected) < 1e-9);
function imagePointer() {
  const target = { ownerDocument: { activeElement: null }, closest: () => null, focus() {},
    setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} };
  return (x, y) => event({ button: 0, pointerId: 1, currentTarget: target, clientX: x, clientY: y });
}

test('image corner resizing preserves frame ratio in preview, release, undo/redo and saved JSON', async t => {
  const ui = await mount(t, { initialWorkbook: imageBook() });
  await act(async () => ui.c.selectDrawing('picture'));
  const handle = () => ui.drawing('picture').findByProps({ className: 'lxs-drawing-resize' });
  const pointer = imagePointer(), original = ui.c.workbook;
  await act(async () => handle().props.onPointerDown(pointer(400, 250)));
  await act(async () => handle().props.onPointerMove(pointer(500, 267)));
  sameRatio(ui.drawing('picture').props.style, 333 / 200);
  assert.equal(ui.c.workbook, original, 'preview does not create a draft change');
  const previewWidth = ui.drawing('picture').props.style.width;
  await act(async () => handle().props.onPointerUp(pointer(530, 272)));
  sameRatio(picture(ui), 333 / 200);
  assert.ok(picture(ui).width > previewWidth, 'release uses the final pointer coordinates');
  const resized = ui.c.workbook;
  await act(async () => ui.c.undo());
  assert.equal(ui.c.workbook, original, 'one gesture is one undo step');
  await act(async () => ui.c.redo());
  assert.equal(ui.c.workbook, resized);
  await act(async () => ui.c.save());
  const saved = JSON.parse(JSON.stringify(ui.saves[0]));
  const reopened = await mount(t, { initialWorkbook: saved });
  assert.deepEqual(picture(reopened), picture(ui));
  sameRatio(picture(reopened), 333 / 200);
});

test('image dimension fields and resize arrow keys update both dimensions while retaining fractional values', async t => {
  const ui = await mount(t, { initialWorkbook: imageBook() });
  await act(async () => ui.c.selectDrawing('picture'));
  await act(async () => ui.property('幅').props.onChange(event({ target: { value: '166.5' } })));
  await act(async () => ui.property('幅').props.onBlur());
  assert.equal(picture(ui).width, 166.5);
  assert.equal(picture(ui).height, 100);
  assert.equal(ui.c.pendingObjectEdit, false);
  await act(async () => ui.property('高さ').props.onChange(event({ target: { value: '33.3' } })));
  await act(async () => ui.property('高さ').props.onBlur());
  sameRatio(picture(ui), 333 / 200);
  const handle = () => ui.drawing('picture').findByProps({ className: 'lxs-drawing-resize' });
  for (const key of ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown']) {
    await act(async () => handle().props.onKeyDown(event({ key })));
    sameRatio(picture(ui), 333 / 200);
  }
  const beforeBlur = ui.c.workbook;
  await act(async () => ui.property('高さ').props.onBlur());
  assert.equal(ui.c.workbook, beforeBlur, 'formatted inspector text does not round stored dimensions on blur');
});

test('image resize limits scale both axes, and an unmoved or cancelled handle adds no history', async t => {
  const ui = await mount(t, { initialWorkbook: imageBook(320, 0.032) });
  await act(async () => ui.c.selectDrawing('picture'));
  const handle = () => ui.drawing('picture').findByProps({ className: 'lxs-drawing-resize' });
  const pointer = imagePointer(), original = ui.c.workbook;
  await act(async () => handle().props.onPointerDown(pointer(400, 30)));
  await act(async () => handle().props.onPointerUp(pointer(400, 30)));
  assert.equal(ui.c.workbook, original);
  await act(async () => handle().props.onPointerDown(pointer(400, 30)));
  await act(async () => handle().props.onPointerMove(pointer(100000, 100000)));
  sameRatio(ui.drawing('picture').props.style, 10000);
  assert.ok(ui.drawing('picture').props.style.width <= 10000);
  await act(async () => handle().props.onPointerCancel());
  assert.equal(ui.c.workbook, original);
  await act(async () => handle().props.onPointerDown(pointer(400, 30)));
  await act(async () => handle().props.onPointerUp(pointer(-1000, -1000)));
  sameRatio(picture(ui), 10000);
  assert.ok(picture(ui).height > 0 && picture(ui).height < 1);
});

test('explicit external image frame updates remain independent and shape resizing remains unconstrained', async t => {
  const ui = await mount(t, { initialWorkbook: imageBook() });
  await act(async () => {
    assert.equal(ui.c.externalExecute({ type: 'images.update', sheetId: 'one', drawingId: 'picture', patch: { width: 600 } }).ok, true);
  });
  assert.equal(picture(ui).height, 200);
  await act(async () => ui.c.selectDrawing('shape'));
  const handle = () => ui.drawing('shape').findByProps({ className: 'lxs-drawing-resize' });
  const pointer = imagePointer();
  await act(async () => handle().props.onPointerDown(pointer(170, 110)));
  await act(async () => handle().props.onPointerUp(pointer(200, 110)));
  assert.equal(ui.c.activeSheet.drawings[0].width, 130);
  assert.equal(ui.c.activeSheet.drawings[0].height, 60);
});

test('image resize can reach the dimension limit without floating point overflow rejection', async t => {
  const ui = await mount(t, { initialWorkbook: imageBook(145, 87) });
  await act(async () => ui.c.selectDrawing('picture'));
  const handle = () => ui.drawing('picture').findByProps({ className: 'lxs-drawing-resize' });
  const pointer = imagePointer();
  await act(async () => handle().props.onPointerDown(pointer(200, 120)));
  await act(async () => handle().props.onPointerUp(pointer(100000, 100000)));
  assert.equal(picture(ui).width, 10000);
  assert.equal(picture(ui).height, 6000);
  assert.equal(ui.c.error, null);
  await act(async () => ui.c.undo());
  await act(async () => ui.c.selectDrawing('picture'));
  await act(async () => ui.property('幅').props.onChange(event({ target: { value: '10000' } })));
  await act(async () => ui.property('幅').props.onBlur());
  assert.equal(picture(ui).width, 10000);
  assert.equal(picture(ui).height, 6000);
});
