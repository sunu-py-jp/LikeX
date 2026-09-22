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
async function mount(t, options = {}, displayScale = 1) {
  let current, renderer;
  const saves = [];
  let props = { initialWorkbook: book(), onSave: wb => { saves.push(wb); }, ...options };
  function Probe() {
    const c = useSpreadsheet(props); current = c;
    return createElement(Fragment, null, createElement(SpreadsheetComments, { controller: c }), createElement(SpreadsheetDrawings, { controller: c, geometry }), createElement(SpreadsheetDrawingInspector, { controller: c }));
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: element => element.props.className === 'lxs-drawing-layer' ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1048 * displayScale, height: 308 * displayScale }) } : null }); });
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
  await act(async () => ui.property('文字色').props.onInput(event({ currentTarget: { value: '#1e3a5f' } })));
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

test('shape color pickers update their own properties, save and undo without CSS text inputs', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectDrawing('shape'));
  const original = ui.c.workbook;
  const inspector = ui.root.findByProps({'aria-label':'オブジェクトの設定'});
  assert.equal(inspector.findAllByType('input').filter(input=>input.props.type==='text').length,0);
  for (const [label, property, color] of [['塗りつぶし','fill','#aabbcc'],['線の色','stroke','#dd5500'],['文字色','color','#224466']]) {
    assert.equal(ui.property(label).props.type,'color');
    await act(async () => ui.property(label).props.onInput(event({currentTarget:{value:color}})));
    assert.equal(ui.c.activeSheet.drawings[0][property],color);
    assert.equal(ui.c.activeSheet.drawings[1].color,'currentColor');
  }
  await act(async () => ui.c.undo()); assert.equal(ui.c.activeSheet.drawings[0].color,undefined);
  await act(async () => ui.c.redo()); assert.equal(ui.c.activeSheet.drawings[0].color,'#224466');
  await act(async () => ui.c.save()); assert.equal(ui.saves[0].sheets[0].drawings[0].fill,'#aabbcc');
  assert.notEqual(ui.c.workbook,original);
  await ui.update({colorMode:'dark'});
  await act(async () => ui.c.selectDrawing('shape'));
  await act(async () => ui.root.findByProps({'aria-label':'文字色を自動にする'}).props.onClick());
  assert.equal(ui.c.activeSheet.drawings[0].color,'#1f2937','automatic shape text remains readable on its pale fill in dark mode');
});

test('text box pickers preserve default raw colors until chosen and expose automatic/none resets', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectDrawing('text'));
  const original = ui.c.workbook;
  assert.equal(ui.property('文字色').props.type,'color');
  assert.equal(ui.property('背景色').props.type,'color');
  // A test renderer has no DOM swatch. Opening controls must never write a fallback value.
  await act(async () => ui.property('文字色').props.onFocus(event()));
  await act(async () => ui.property('背景色').props.onClick(event()));
  assert.equal(ui.c.workbook,original);
  await act(async () => ui.property('文字色').props.onInput(event({currentTarget:{value:'#112233'}})));
  await act(async () => ui.property('背景色').props.onInput(event({currentTarget:{value:'#ffeecc'}})));
  assert.equal(ui.c.activeSheet.drawings[1].color,'#112233');
  assert.equal(ui.c.activeSheet.drawings[1].background,'#ffeecc');
  await act(async () => ui.root.findByProps({'aria-label':'文字色を自動にする'}).props.onClick());
  await act(async () => ui.root.findByProps({'aria-label':'背景色をなしにする'}).props.onClick());
  assert.equal(ui.c.activeSheet.drawings[1].color,'currentColor');
  assert.equal(ui.c.activeSheet.drawings[1].background,'transparent');
});

test('color picking respects denied edit requests and readonly controls', async t => {
  const ui = await mount(t,{onEditRequest:async()=>false});
  await act(async () => ui.c.selectDrawing('shape'));
  const original=ui.c.workbook;
  await act(async () => ui.property('塗りつぶし').props.onInput(event({currentTarget:{value:'#ff0000'}})));
  assert.equal(ui.c.workbook,original);
  await ui.update({readOnly:true});
  await act(async () => ui.c.selectDrawing('shape'));
  assert.equal(ui.property('塗りつぶし').props.disabled,true);
  const reset=ui.root.findByProps({'aria-label':'塗りつぶしをなしにする'});
  assert.equal(reset.props.disabled,true);
  await act(async () => reset.props.onClick());
  assert.equal(ui.c.workbook,original);
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
    const target = () => kind === 'move' ? ui.drawing('shape') : ui.drawing('shape').findByProps({ 'data-lxs-resize-corner': 'se' });
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
  const handle = () => ui.drawing('picture').findByProps({ 'data-lxs-resize-corner': 'se' });
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
  const handle = () => ui.drawing('picture').findByProps({ 'data-lxs-resize-corner': 'se' });
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
  const handle = () => ui.drawing('picture').findByProps({ 'data-lxs-resize-corner': 'se' });
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
  const handle = () => ui.drawing('shape').findByProps({ 'data-lxs-resize-corner': 'se' });
  const pointer = imagePointer();
  await act(async () => handle().props.onPointerDown(pointer(170, 110)));
  await act(async () => handle().props.onPointerUp(pointer(200, 110)));
  assert.equal(ui.c.activeSheet.drawings[0].width, 130);
  assert.equal(ui.c.activeSheet.drawings[0].height, 60);
});

test('image resize can reach the dimension limit without floating point overflow rejection', async t => {
  const ui = await mount(t, { initialWorkbook: imageBook(145, 87) });
  await act(async () => ui.c.selectDrawing('picture'));
  const handle = () => ui.drawing('picture').findByProps({ 'data-lxs-resize-corner': 'se' });
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

function centeredArrowBook(flips = {}) {
  const workbook = book();
  workbook.sheets[0].drawings[0] = { ...shape, shape: 'arrow', text: '確認する', ...flips,
    anchor: { row: 5, column: 2, offsetX: 10, offsetY: 10 } };
  return workbook;
}
const resizedShape = ui => ui.c.activeSheet.drawings.find(item => item.id === 'shape');
function displayedRectangle(drawing) {
  return { left: geometry.columnOffsets[drawing.anchor.column] + drawing.anchor.offsetX,
    top: geometry.rowOffsets[drawing.anchor.row] + drawing.anchor.offsetY, width: drawing.width, height: drawing.height };
}
const cornerCases = [
  { corner: 'nw', start: [258, 178], end: [398, 278], expected: { left: 358, top: 238, width: 40, height: 40 } },
  { corner: 'ne', start: [358, 178], end: [218, 278], expected: { left: 218, top: 238, width: 40, height: 40 } },
  { corner: 'sw', start: [258, 238], end: [398, 138], expected: { left: 358, top: 138, width: 40, height: 40 } },
  { corner: 'se', start: [358, 238], end: [218, 138], expected: { left: 218, top: 138, width: 40, height: 40 } },
];
for (const { corner, start, end, expected } of cornerCases) {
  test(`${corner} corner crosses its fixed opposite corner, preserving identity and one undoable saved change`, async t => {
    const ui = await mount(t, { initialWorkbook: centeredArrowBook() });
    await act(async () => ui.c.selectDrawing('shape'));
    const handles = ui.drawing('shape').findAllByType('button').filter(item => item.props['data-lxs-resize-corner']);
    assert.deepEqual(handles.map(item => item.props['data-lxs-resize-corner']).sort(), ['ne', 'nw', 'se', 'sw']);
    const handle = () => ui.drawing('shape').findByProps({ 'data-lxs-resize-corner': corner });
    const pointer = imagePointer(), before = ui.c.workbook;
    await act(async () => handle().props.onPointerDown(pointer(...start)));
    await act(async () => handle().props.onPointerMove(pointer(...end)));
    assert.equal(ui.c.workbook, before, 'crossing previews do not commit');
    assert.deepEqual(ui.drawing('shape').props.style, expected);
    await act(async () => handle().props.onPointerUp(pointer(...end)));
    const changed = ui.c.workbook, drawing = resizedShape(ui);
    assert.deepEqual(displayedRectangle(drawing), expected);
    assert.equal(drawing.flipX, true); assert.equal(drawing.flipY, true);
    assert.equal(drawing.id, 'shape'); assert.equal(drawing.text, '確認する');
    assert.equal(ui.c.selectedDrawingId, 'shape');
    await act(async () => ui.c.undo()); assert.equal(ui.c.workbook, before);
    await act(async () => ui.c.redo()); assert.equal(ui.c.workbook, changed);
    await act(async () => ui.c.save());
    const reopened = await mount(t, { initialWorkbook: JSON.parse(JSON.stringify(ui.saves[0])) });
    assert.deepEqual(resizedShape(reopened), drawing);
  });
}

test('single-axis crossing at 200% zoom and repeated crossing compose with existing flips', async t => {
  const ui = await mount(t, { initialWorkbook: centeredArrowBook({ flipX: true, flipY: true }) }, 2);
  await act(async () => ui.c.selectDrawing('shape'));
  const handle = () => ui.drawing('shape').findByProps({ 'data-lxs-resize-corner': 'se' });
  const pointer = imagePointer();
  await act(async () => handle().props.onPointerDown(pointer(716, 476)));
  await act(async () => handle().props.onPointerUp(pointer(436, 516)));
  assert.deepEqual(displayedRectangle(resizedShape(ui)), { left: 218, top: 178, width: 40, height: 80 });
  assert.equal(!!resizedShape(ui).flipX, false);
  assert.equal(resizedShape(ui).flipY, true);
  const before = ui.c.workbook;
  await act(async () => handle().props.onPointerDown(pointer(516, 516)));
  await act(async () => handle().props.onPointerMove(pointer(596, 276)));
  await act(async () => handle().props.onPointerUp(pointer(516, 516)));
  assert.equal(ui.c.workbook, before, 'returning to the initial corner restores the original orientation without history');
});

test('crossing can be cancelled and a disabled resize cannot commit a captured gesture', async t => {
  const ui = await mount(t, { initialWorkbook: centeredArrowBook() });
  await act(async () => ui.c.selectDrawing('shape'));
  const pointer = imagePointer(), before = ui.c.workbook;
  const handle = () => ui.drawing('shape').findByProps({ 'data-lxs-resize-corner': 'nw' });
  await act(async () => handle().props.onPointerDown(pointer(258, 178)));
  await act(async () => handle().props.onPointerMove(pointer(398, 278)));
  await act(async () => handle().props.onPointerCancel());
  assert.equal(ui.c.workbook, before);
  await act(async () => handle().props.onPointerDown(pointer(258, 178)));
  await act(async () => handle().props.onPointerMove(pointer(398, 278)));
  await ui.update({ features: { resize: false } });
  assert.equal(ui.drawing('shape').findAllByType('button').filter(item => item.props['data-lxs-resize-corner']).length, 0);
  await act(async () => ui.drawing('shape').props.onPointerUp(pointer(398, 278)));
  assert.equal(ui.c.workbook, before);
  assert.equal(ui.c.canUndo, false);
});

test('denied editing permission discards the flipped preview without changing saved orientation', async t => {
  const ui = await mount(t, { initialWorkbook: centeredArrowBook(), onEditRequest: async () => false });
  await act(async () => ui.c.selectDrawing('shape'));
  const before = ui.c.workbook, pointer = imagePointer();
  const handle = () => ui.drawing('shape').findByProps({ 'data-lxs-resize-corner': 'se' });
  await act(async () => handle().props.onPointerDown(pointer(358, 238)));
  await act(async () => handle().props.onPointerUp(pointer(218, 138)));
  assert.equal(ui.c.workbook, before);
  assert.equal(ui.c.canUndo, false);
});

const rotationHandle = (ui, id = 'shape') => ui.drawing(id).findByProps({ className: 'lxs-drawing-rotate' });
test('rotation drag previews at zoom, commits once on release, keeps selection and survives Undo/Redo and save', async t => {
  const ui = await mount(t, { initialWorkbook: centeredArrowBook({ flipX: true }) }, 2);
  await act(async () => ui.c.selectDrawing('shape'));
  const before = ui.c.workbook, pointer = imagePointer();
  await act(async () => rotationHandle(ui).props.onPointerDown(pointer(616, 296)));
  await act(async () => rotationHandle(ui).props.onPointerMove(pointer(736, 416)));
  assert.equal(ui.c.workbook, before);
  assert.equal(ui.drawing('shape').props.style.transform, 'rotate(90deg)');
  await act(async () => rotationHandle(ui).props.onPointerUp(pointer(616, 536)));
  assert.equal(resizedShape(ui).rotation, 180);
  assert.equal(resizedShape(ui).flipX, true);
  assert.equal(resizedShape(ui).text, '確認する');
  assert.equal(ui.c.selectedDrawingId, 'shape');
  const after = ui.c.workbook;
  await act(async () => ui.c.undo()); assert.equal(ui.c.workbook, before);
  await act(async () => ui.c.redo()); assert.equal(ui.c.workbook, after);
  await act(async () => ui.c.save()); assert.equal(ui.saves[0].sheets[0].drawings[0].rotation, 180);
});

test('rotation handles support Shift snapping and keyboard angle changes with Home reset', async t => {
  const ui = await mount(t, { initialWorkbook: centeredArrowBook() });
  await act(async () => ui.c.selectDrawing('shape'));
  const pointer = imagePointer();
  await act(async () => rotationHandle(ui).props.onPointerDown(pointer(308, 148)));
  const point = pointer(308 + 60 * Math.sin(22 * Math.PI / 180), 208 - 60 * Math.cos(22 * Math.PI / 180));
  await act(async () => rotationHandle(ui).props.onPointerUp({ ...point, shiftKey: true }));
  assert.equal(resizedShape(ui).rotation, 15);
  await act(async () => rotationHandle(ui).props.onKeyDown(event({ key: 'ArrowRight' })));
  assert.equal(resizedShape(ui).rotation, 16);
  await act(async () => rotationHandle(ui).props.onKeyDown(event({ key: 'ArrowLeft', shiftKey: true })));
  assert.equal(resizedShape(ui).rotation, 1);
  await act(async () => rotationHandle(ui).props.onKeyDown(event({ key: 'Home' })));
  assert.equal(resizedShape(ui).rotation, undefined);
  assert.equal(ui.c.selectedDrawingId, 'shape');
});

test('rotation can be cancelled with Escape, pointer cancellation, external updates or a resize feature change', async t => {
  for (const reason of ['escape', 'pointer', 'feature', 'workbook']) {
    const ui = await mount(t, { initialWorkbook: centeredArrowBook() });
    await act(async () => ui.c.selectDrawing('shape'));
    const pointer = imagePointer(), before = ui.c.workbook;
    await act(async () => rotationHandle(ui).props.onPointerDown(pointer(308, 148)));
    await act(async () => rotationHandle(ui).props.onPointerMove(pointer(368, 208)));
    if (reason === 'escape') await act(async () => ui.drawing('shape').props.onKeyDown(event({ key: 'Escape' })));
    if (reason === 'pointer') await act(async () => rotationHandle(ui).props.onPointerCancel());
    if (reason === 'feature') await ui.update({ features: { resize: false } });
    if (reason === 'workbook') await act(async () => ui.c.externalExecute({ type: 'cells.set', sheetId: 'one', values: { A1: 'newer' } }));
    await act(async () => ui.drawing('shape').props.onPointerUp(pointer(368, 208)));
    assert.equal(resizedShape(ui).rotation, undefined);
    if (reason !== 'workbook') { assert.equal(ui.c.workbook, before); assert.equal(ui.c.canUndo, false); }
    if (reason === 'feature') assert.equal(ui.drawing('shape').findAllByProps({ className: 'lxs-drawing-rotate' }).length, 0);
  }
});

test('rotation property works for images and text boxes and is unavailable when resizing is disabled', async t => {
  const ui = await mount(t, { initialWorkbook: imageBook() });
  for (const id of ['shape', 'text', 'picture']) {
    await act(async () => ui.c.selectDrawing(id));
    await act(async () => ui.property('角度（°）').props.onChange(event({ target: { value: '-45' } })));
    await act(async () => ui.property('角度（°）').props.onBlur());
    const drawing = ui.c.activeSheet.drawings.find(item => item.id === id);
    assert.equal(drawing.rotation, 315);
    assert.equal(ui.drawing(id).props.style.transform, 'rotate(315deg)');
    assert.equal(ui.property('角度（°）').props.value, '315');
  }
  await ui.update({ features: { resize: false } });
  assert.equal(ui.property('角度（°）'), undefined);
  assert.equal(ui.drawing('picture').findAllByProps({ className: 'lxs-drawing-rotate' }).length, 0);
  assert.equal(ui.drawing('picture').props.style.transform, 'rotate(315deg)');
});

test('a rotated corner resizes in local axes while keeping its opposite visual point fixed', async t => {
  const ui = await mount(t, { initialWorkbook: centeredArrowBook({ rotation: 90 }) });
  await act(async () => ui.c.selectDrawing('shape'));
  const pointer = imagePointer();
  const handle = () => ui.drawing('shape').findByProps({ 'data-lxs-resize-corner': 'se' });
  // Center (308,208), rotated SE=(278,258), fixed NW=(338,158).
  await act(async () => handle().props.onPointerDown(pointer(278, 258)));
  await act(async () => handle().props.onPointerUp(pointer(258, 298)));
  const drawing = resizedShape(ui);
  assert.equal(drawing.rotation, 90); assert.equal(drawing.width, 140); assert.equal(drawing.height, 80);
  assert.deepEqual(displayedRectangle(drawing), { left: 228, top: 188, width: 140, height: 80 });
  assert.equal(handle().props.style.cursor, 'nesw-resize');
});

test('committed property inputs route repeated Ctrl/Cmd Undo/Redo to workbook history while draft text keeps native Undo', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectDrawing('shape'));
  for (const value of ['45', '90']) {
    await act(async () => ui.property('角度（°）').props.onChange(event({ target: { value } })));
    await act(async () => ui.property('角度（°）').props.onKeyDown(event({ key: 'Enter' })));
  }
  assert.equal(resizedShape(ui).rotation, 90);
  assert.equal(ui.c.pendingObjectEdit, false);
  for (const [key, expected] of [[{ key: 'z', ctrlKey: true }, 45], [{ key: 'z', metaKey: true }, undefined],
    [{ key: 'z', metaKey: true, shiftKey: true }, 45], [{ key: 'y', ctrlKey: true }, 90]]) {
    let prevented = false;
    await act(async () => ui.property('角度（°）').props.onKeyDown(event({ ...key, preventDefault() { prevented = true; } })));
    assert.equal(prevented, true); assert.equal(resizedShape(ui).rotation, expected);
    assert.equal(ui.property('角度（°）').props.value, String(expected ?? 0));
    assert.equal(ui.c.selectedDrawingId, 'shape');
  }
  await act(async () => ui.property('角度（°）').props.onChange(event({ target: { value: '25' } })));
  let prevented = false;
  await act(async () => ui.property('角度（°）').props.onKeyDown(event({ key: 'z', metaKey: true, preventDefault() { prevented = true; } })));
  assert.equal(prevented, false); assert.equal(resizedShape(ui).rotation, 90);
  assert.equal(ui.property('角度（°）').props.value, '25');
});

test('new shape text and its editor share the reflected native text frame while following outer rotation', async t => {
  const initialWorkbook = centeredArrowBook({ shape: 'triangle', width: 122, height: 122, flipY: true, rotation: 45 });
  const ui = await mount(t, { initialWorkbook });
  await act(async () => ui.c.selectDrawing('shape'));
  const read = ui.drawing('shape').findByProps({ className: 'lxs-shape-text' }).props.style;
  assert.equal(read.left, 31); assert.equal(read.top, 1); assert.equal(read.width, 60); assert.equal(read.height, 60);
  assert.equal(read.transform, undefined, 'text is positioned inside the flipped shape but is not mirrored');
  assert.equal(ui.drawing('shape').props.style.transform, 'rotate(45deg)');
  await act(async () => ui.drawing('shape').props.onDoubleClick());
  const editor = ui.drawing('shape').findByProps({ className: 'lxs-shape-text-edit-frame' }).props.style;
  for (const key of ['left', 'top', 'width', 'height']) assert.equal(editor[key], read[key]);
});

test('switching drawings flushes an object property before the shared selection guard runs', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectDrawing('shape'));
  await act(async () => ui.property('幅').props.onChange(event({ target: { value: '240' } })));
  const editor = { matches: () => true, blur: () => ui.property('幅').props.onBlur() };
  const pointerTarget = { ownerDocument: { activeElement: editor }, closest: () => ({ contains: element => element === editor }),
    focus() {}, setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} };
  await act(async () => ui.drawing('text').props.onPointerDown(event({ button: 0, pointerId: 4, clientX: 40, clientY: 90, currentTarget: pointerTarget })));
  assert.equal(ui.c.pendingObjectEdit, false);
  assert.equal(ui.c.activeSheet.drawings.find(drawing => drawing.id === 'shape').width, 240);
  assert.equal(ui.c.selectedDrawingId, 'text');
  await act(async () => ui.drawing('text').props.onPointerCancel());
});
