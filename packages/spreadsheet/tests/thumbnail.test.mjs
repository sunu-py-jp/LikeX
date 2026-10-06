import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `export * from './src/thumbnail'; export {calculateSpreadsheetRange} from './src/model/calculated-range'; export {calculateWorkbook} from './src/model/formula'; export {prepareSpreadsheetThumbnail} from './src/ui/thumbnail/prepare-thumbnail';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, plugins: [{ name: 'react-and-formula-observation', setup(b) {
    b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    b.onLoad({ filter: /\/model\/formula\.ts$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8'), target = 'let node = parsed.get(cell.value);';
      assert.ok(source.includes(target));
      return { contents: source.replace(target, 'globalThis.__thumbnailFormulaReads?.push(`${sheetId}:${canonical}`);\n' + target), loader: 'ts' };
    });
  } }] });
const { SpreadsheetThumbnail, calculateSpreadsheetRange, calculateWorkbook, prepareSpreadsheetThumbnail } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=spreadsheet-thumbnail-tests.mjs').toString('base64')}`);
const input = () => ({ sheets: [
  { id: 'first', name: 'First', rowCount: 1000, columnCount: 100, cells: { A1: { value: '=Other!A1+K1' }, K1: { value: '=6*2' }, A21: { value: '=1/0' }, K20: { value: 'OFFSCREEN' },
    A2: { value: 'https://example.invalid' }, B2: { value: '12.5', format: { numberFormat: 'currency', bold: true, color: '#123456', borders: { top: { color: '#ff0000', width: 2 } } } } } },
  { id: 'other', name: 'Other', rowCount: 100, columnCount: 20, cells: { A1: { value: '=40+2' }, B1: { value: '=1/0' }, B2: { value: 'OTHER SHEET CONTENT' } } },
] });
const cell = (scene, address) => scene.cells.find(value => value.address === address);

test('the lightweight entry avoids editor/session modules and renders at most the first 200 cells', () => {
  assert.ok(!Object.keys(bundle.metafile.inputs).some(path => /\/(session|history|state)\//.test(path)), 'No editor state or session is imported');
  const workbook = input(), before = JSON.stringify(workbook); globalThis.__thumbnailFormulaReads = [];
  const html = renderToStaticMarkup(h(SpreadsheetThumbnail, { workbook, title: 'Quarterly report' }));
  assert.equal((html.match(/data-lxs-thumbnail-cell=/g) ?? []).length, 200);
  assert.match(html, /data-lxs-thumbnail-cell="A1"[^>]*><span[^>]*>54<\/span>/);
  assert.match(html, /Quarterly report/); assert.match(html, /LikeX/); assert.match(html, /height:280px;min-height:0/);
  assert.match(html, /role="img"/); assert.match(html, /viewBox="0 0 1000 560"/); assert.match(html, /preserveAspectRatio="xMidYMid meet"/);
  assert.doesNotMatch(html, /<button|<input|<textarea|<select|<a\b|contenteditable|tabindex|role="grid"|OFFSCREEN|OTHER SHEET CONTENT/i);
  assert.deepEqual(globalThis.__thumbnailFormulaReads, ['first:A1', 'other:A1', 'first:K1']);
  assert.equal(JSON.stringify(workbook), before);
});

test('range calculation returns requested values only, shares formula semantics, and retains validation and limits', () => {
  const workbook = input(); globalThis.__thumbnailFormulaReads = [];
  const values = calculateSpreadsheetRange(workbook, 'first', 'A1:B2');
  assert.deepEqual(Object.keys(values), ['A1', 'B1', 'A2', 'B2']); assert.equal(values.A1, 54); assert.equal(values.B1, '');
  assert.deepEqual(globalThis.__thumbnailFormulaReads, ['first:A1', 'other:A1', 'first:K1']);
  assert.equal(values.A1, calculateWorkbook(workbook).first.A1);
  assert.throws(() => { values.A1 = 999; });
  assert.throws(() => calculateSpreadsheetRange(workbook, 'missing', 'A1'));
  assert.throws(() => calculateSpreadsheetRange(workbook, 'first', 'A1:CV1000'), /10,000/);
  assert.throws(() => calculateSpreadsheetRange(workbook, 'first', 'A0'));
  assert.throws(() => calculateSpreadsheetRange(undefined, 'first', 'A1'));
  const invalid = input(); invalid.sheets[1].cells.B2.format = { fontSize: -1 };
  assert.throws(() => calculateSpreadsheetRange(invalid, 'first', 'A1'), /フォント/);
  const formulas = { sheets: [{ id: 's', name: 'S', rowCount: 20, columnCount: 10, cells: {
    A1: { value: '=A1' }, A2: { value: '=1/0' }, A3: { value: "'123" }, A4: { value: '=1+1', format: { numberFormat: 'text' } },
    A5: { value: '=IFERROR(A2,7)' }, A6: { value: '=SUM(B1:B20)' }, A7: { value: '=IF(FALSE,A1,5)' }, A8: { value: '=DATE(2026,1,1)' },
  } }] };
  const expected = calculateWorkbook(formulas).s, selected = calculateSpreadsheetRange(formulas, 's', 'A1:A8');
  for (const address of Object.keys(selected)) assert.equal(selected[address], expected[address], address);
  assert.equal(selected.A1, '#CYCLE!'); assert.equal(selected.A5, 7); assert.equal(selected.A7, 5);
});

test('static preview shares formatting, clips merges and bounds drawing and text output', () => {
  const workbook = input(), sheet = workbook.sheets[0];
  sheet.columnWidths = { 0: 140 }; sheet.rowHeights = { 0: 40 };
  sheet.merges = [{ top: 2, left: 8, bottom: 24, right: 12 }];
  delete sheet.cells.K20;
  sheet.cells.I3 = { value: 'Merged title' }; sheet.cells.A3 = { value: 'x'.repeat(5000) };
  sheet.drawings = Array.from({ length: 105 }, (_, index) => ({ id: `text-${index}`, type: 'text', text: `Note ${index}`,
    fontSize: 12, color: '#123456', background: '#ffffff', anchor: { row: 1, column: 1, offsetX: 5, offsetY: 6 }, width: 70, height: 40 }));
  sheet.drawings.unshift({ ...sheet.drawings[0], id: 'outside', anchor: { row: 50, column: 0, offsetX: 0, offsetY: 0 } });
  const scene = prepareSpreadsheetThumbnail(workbook);
  assert.equal(scene.width, 1040); assert.equal(scene.height, 572);
  assert.equal(cell(scene, 'I3').style.width, 200); assert.equal(cell(scene, 'I3').style.height, 18 * 28);
  assert.equal(cell(scene, 'J3'), undefined); assert.equal(cell(scene, 'A3').text.length, 2000);
  assert.equal(cell(scene, 'B2').style.fontWeight, 700); assert.equal(cell(scene, 'B2').style.borderTop, '2px solid #ff0000');
  assert.equal(scene.drawings.length, 100); assert.equal(scene.drawings[0].drawing.id, 'text-0');
  const html = renderToStaticMarkup(h(SpreadsheetThumbnail, { workbook }));
  assert.equal((html.match(/data-lxs-thumbnail-drawing=/g) ?? []).length, 100);
  assert.match(html, /Note 0/); assert.doesNotMatch(html, /Note 100/);
});

test('automatic conditional scales use complete visible ranges only, avoiding misleading partial extrema', () => {
  const workbook = input(), sheet = workbook.sheets[0];
  sheet.cells.A1 = { value: '5' }; sheet.cells.B1 = { value: '10' }; sheet.cells.C1 = { value: '7' }; sheet.cells.D1 = { value: '3' };
  sheet.conditionalFormats = [
    { id: 'visible', type: 'dataBar', ranges: [{ top: 0, left: 0, bottom: 0, right: 1 }], color: '#00ff00' },
    { id: 'offscreen', type: 'dataBar', ranges: [{ top: 0, left: 2, bottom: 30, right: 2 }], color: '#ff0000' },
    { id: 'explicit', type: 'dataBar', ranges: [{ top: 0, left: 3, bottom: 30, right: 3 }], color: '#0000ff', min: 0, max: 10 },
  ];
  const scene = prepareSpreadsheetThumbnail(workbook);
  assert.equal(cell(scene, 'A1').dataBar.width, 50); assert.equal(cell(scene, 'C1').dataBar, undefined); assert.equal(cell(scene, 'D1').dataBar.width, 30);
});

test('images, shapes and bound lines reuse validated local sources and model geometry', () => {
  const workbook = input(), sheet = workbook.sheets[0];
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
  workbook.resources = { images: { logo: { name: 'Logo', mimeType: 'image/png', dataUrl: src, width: 1, height: 1 } } };
  const anchor = { row: 0, column: 0, offsetX: 10, offsetY: 10 };
  sheet.drawings = [
    { id: 'logo', type: 'image', resourceId: 'logo', alt: 'Logo', anchor, width: 50, height: 40, rotation: 30, flipX: true },
    { id: 'shape', type: 'shape', shape: 'rectangle', fill: '#ffffff', stroke: '#000000', strokeWidth: 1, text: 'Shared shape', anchor: { ...anchor, column: 2 }, width: 100, height: 40 },
    { id: 'line', type: 'shape', shape: 'arrow', fill: '#000000', stroke: '#ff0000', strokeWidth: 2, anchor, width: 200, height: 40,
      line: { start: { anchor }, end: { anchor: { ...anchor, column: 2 }, binding: { targetId: 'shape', port: 'left' } } } },
  ];
  const html = renderToStaticMarkup(h(SpreadsheetThumbnail, { workbook }));
  assert.match(html, /data-lxs-thumbnail-drawing="logo"/); assert.ok(html.includes(src)); assert.match(html, /rotate\(30deg\)/); assert.match(html, /scale\(-1,1\)/);
  assert.match(html, /Shared shape/); assert.match(html, /<polyline/); assert.match(html, /marker-end=/);
});

test('prop replacement refreshes contents and invalid complete input renders a safe placeholder with an isolated error callback', async t => {
  let renderer; const errors = [], valid = input();
  await act(() => { renderer = create(h(SpreadsheetThumbnail, { workbook: valid, title: 'Safe title' })); });
  t.after(() => act(() => renderer.unmount()));
  const changed = input(); changed.sheets[0].cells.A1 = { value: 'New value' };
  await act(() => renderer.update(h(SpreadsheetThumbnail, { workbook: changed, title: 'Safe title' })));
  assert.equal(renderer.root.findByProps({ 'data-lxs-thumbnail-cell': 'A1' }).findByType('span').children[0], 'New value');
  const invalid = input(); invalid.resources = { images: { bad: { name: 'Bad', mimeType: 'image/png', dataUrl: 'https://example.invalid/image', width: 1, height: 1 } } };
  await act(() => renderer.update(h(SpreadsheetThumbnail, { workbook: invalid, title: 'Safe title', onError: error => { errors.push(error); throw new Error('observer'); } })));
  assert.equal(errors.length, 1); assert.ok(errors[0] instanceof Error);
  assert.equal(renderer.root.findAllByType('foreignObject').length, 0);
  assert.equal(renderer.root.findByProps({ className: 'lxs-title' }).children[0], 'Safe title');
  await act(() => renderer.update(h(SpreadsheetThumbnail, { workbook: valid })));
  assert.equal(renderer.root.findAllByType('foreignObject').length, 1);
});

test('static fitting requires no resize observers and system-color subscriptions clean up on replacement and unmount', async () => {
  const previousWindow = globalThis.window, previousResize = globalThis.ResizeObserver;
  const listeners = new Set(); let renderer;
  globalThis.ResizeObserver = class { constructor() { throw new Error('No observers for static fitting'); } };
  const media = { matches: true, addEventListener(name, callback) { assert.equal(name, 'change'); listeners.add(callback); }, removeEventListener(name, callback) { listeners.delete(callback); } };
  globalThis.window = { matchMedia() { return media; } };
  try {
    await act(() => { renderer = create(h(SpreadsheetThumbnail, { workbook: input(), colorMode: 'system', primaryColor: '#6655aa' })); });
    assert.equal(listeners.size, 1); assert.equal(renderer.root.findByType('section').props['data-color-mode'], 'dark');
    await act(() => renderer.update(h(SpreadsheetThumbnail, { workbook: input(), colorMode: 'light', style: { height: 180 } })));
    assert.equal(listeners.size, 0); assert.equal(renderer.root.findByType('section').props.style.height, 180);
    await act(() => renderer.unmount()); renderer = null;
  } finally { if (renderer) await act(() => renderer.unmount()); globalThis.window = previousWindow; globalThis.ResizeObserver = previousResize; }
});

test('async error observers are isolated and replacing an observer alone does not repeat the same error', async t => {
  let renderer; const invalid = { sheets: [] }, first = [], second = [];
  await act(() => { renderer = create(h(SpreadsheetThumbnail, { workbook: invalid, onError: async error => {
    first.push(error); throw new Error('async observer rejection');
  } })); });
  t.after(() => act(() => renderer.unmount()));
  assert.equal(first.length, 1);
  const replacement = async error => { second.push(error); throw new Error('replacement observer rejection'); };
  await act(() => renderer.update(h(SpreadsheetThumbnail, { workbook: invalid, onError: replacement })));
  assert.equal(first.length, 1); assert.equal(second.length, 0);
  await act(() => renderer.update(h(SpreadsheetThumbnail, { workbook: { sheets: [] }, onError: replacement })));
  assert.equal(first.length, 1); assert.equal(second.length, 1);
  assert.equal(renderer.root.findAllByType('foreignObject').length, 0);
});
