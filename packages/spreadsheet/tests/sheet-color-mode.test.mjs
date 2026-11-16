import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `export { default as Spreadsheet, SpreadsheetThumbnail, serializeWorkbook, parseWorkbook, exportSpreadsheetXlsx } from './src';
  export { importSpreadsheetXlsx } from './src/import/import-xlsx';
  export { openXlsxStreamingArchive } from './src/import/zip';
  export { parseXml, child, children } from './src/import/xml';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { Spreadsheet, SpreadsheetThumbnail, serializeWorkbook, parseWorkbook, exportSpreadsheetXlsx, importSpreadsheetXlsx,
  openXlsxStreamingArchive, parseXml, child, children } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const workbook = { sheets: [{ id: 'main', name: 'Main', rowCount: 6, columnCount: 5,
  cells: {
    A1: { value: 'Quarterly report', format: { color: '#217346', bold: true, fontSize: 22 } },
    A2: { value: 'Summary', format: { color: '#526359' } },
    B1: { value: 'Explicit pale fill', format: { color: '#217346', background: '#e8f3ec', borders: { bottom: { color: '#217346', width: 2 } } } },
    B2: { value: 'Explicit dark fill', format: { color: '#e9efeb', background: '#183e2a' } },
    C1: { value: '25' },
    C2: { value: '30' },
  },
  conditionalFormats: [
    { id: 'colored-text', type: 'comparison', ranges: [{ top: 0, left: 2, bottom: 0, right: 2 }], operator: 'gt', value: 10, format: { color: '#526359' } },
    { id: 'filled-text', type: 'comparison', ranges: [{ top: 1, left: 2, bottom: 1, right: 2 }], operator: 'gt', value: 10, format: { color: '#8a2600', background: '#fce4d6' } },
  ],
  drawings: [{ id: 'shape', type: 'shape', shape: 'rectangle', anchor: { row: 4, column: 0, offsetX: 0, offsetY: 0 },
    width: 80, height: 40, fill: '#e8f3ec', stroke: '#217346', strokeWidth: 2, text: 'Original', color: '#526359' }],
}] };

async function mount(t, supplied = {}, component = Spreadsheet) {
  let renderer;
  const ref = createRef();
  let props = component === Spreadsheet ? { ref, initialWorkbook: workbook, onSave() {}, ...supplied } : { workbook, ...supplied };
  await act(async () => { renderer = create(createElement(component, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { ref, get root() { return renderer.root; },
    get section() { return renderer.root.findByType('section'); },
    cell(address) {
      if (component === SpreadsheetThumbnail) return renderer.root.findByProps({ 'data-lxs-thumbnail-cell': address });
      const column = address.charCodeAt(0) - 65, row = Number(address.slice(1)) - 1;
      return renderer.root.findAllByProps({ role: 'gridcell' }).find(item => item.props['data-lxs-column'] === column && item.props['data-lxs-row'] === row);
    },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(component, props))); },
  };
}

const luminance = color => color.slice(1).match(/../g).map(value => {
  const channel = parseInt(value, 16) / 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (first, second) => {
  assert.match(first, /^#[a-f\d]{6}$/i, 'rendered explicit colors have a concrete contrast-checkable value');
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};

for (const component of [Spreadsheet, SpreadsheetThumbnail]) {
  const name = component === Spreadsheet ? 'editor' : 'thumbnail';
  test(`${name} sheet appearance defaults to light and changes independently from the surrounding UI`, async t => {
    const ui = await mount(t, { colorMode: 'dark' }, component);
    assert.equal(ui.section.props['data-color-mode'], 'dark');
    assert.equal(ui.section.props['data-sheet-color-mode'], 'light');
    assert.equal(ui.cell('A1').props.style.color, '#217346');
    for (const colorMode of ['light', 'dark']) {
      for (const sheetColorMode of ['light', 'dark', 'inherit']) {
        await ui.update({ colorMode, sheetColorMode });
        assert.equal(ui.section.props['data-color-mode'], colorMode);
        assert.equal(ui.section.props['data-sheet-color-mode'], sheetColorMode === 'inherit' ? colorMode : sheetColorMode);
      }
    }
    await ui.update({ colorMode: 'dark', sheetColorMode: undefined });
    assert.equal(ui.section.props['data-sheet-color-mode'], 'light');
    assert.equal(ui.cell('A1').props.style.color, '#217346');
  });

  test(`${name} mounted sheet mode updates adapt title, subtitle and conditional text without changing their saved colors`, async t => {
    const before = JSON.stringify(workbook);
    const ui = await mount(t, { colorMode: 'light' }, component);
    const light = new Map(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(address => [address, { ...ui.cell(address).props.style }]));
    await ui.update({ sheetColorMode: 'dark' });
    for (const address of ['A1', 'A2', 'C1']) {
      const style = ui.cell(address).props.style;
      assert.notEqual(style.color, light.get(address).color, `${address} receives dark-sheet display color`);
      assert.ok(contrast(style.color, '#1e2421') >= 4.5, `${address} remains readable on the dark sheet`);
    }
    for (const address of ['B1', 'B2', 'C2']) {
      const style = ui.cell(address).props.style;
      if (address === 'B2') assert.equal(style.backgroundColor, light.get(address).backgroundColor, 'an authored dark fill remains dark');
      else {
        assert.notEqual(style.backgroundColor, light.get(address).backgroundColor, `${address} adapts its bright fill for dark-sheet display`);
        assert.ok(luminance(style.backgroundColor) < luminance(light.get(address).backgroundColor), `${address} becomes darker`);
      }
      assert.ok(contrast(style.color, style.backgroundColor) >= 4.5, `${address} uses its actual fill for text contrast`);
    }
    await ui.update({ sheetColorMode: 'light' });
    for (const [address, style] of light) assert.deepEqual(ui.cell(address).props.style, style, `${address} returns to original light appearance`);
    assert.equal(JSON.stringify(workbook), before, 'appearance never mutates the caller-owned workbook');
  });

  test(`${name} inherited sheet appearance follows system changes while explicit sheet modes remain fixed`, async t => {
    const previousWindow = globalThis.window;
    const listeners = new Set();
    const media = { matches: false, addEventListener: (_name, listener) => listeners.add(listener),
      removeEventListener: (_name, listener) => listeners.delete(listener) };
    globalThis.window = { matchMedia: () => media };
    t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
    const ui = await mount(t, { colorMode: 'system', sheetColorMode: 'inherit' }, component);
    const setSystemDark = async matches => { await act(async () => { media.matches = matches; for (const listener of listeners) listener(); }); };
    assert.equal(ui.section.props['data-sheet-color-mode'], 'light');
    await setSystemDark(true);
    assert.equal(ui.section.props['data-color-mode'], 'dark');
    assert.equal(ui.section.props['data-sheet-color-mode'], 'dark');
    assert.ok(contrast(ui.cell('A1').props.style.color, '#1e2421') >= 4.5);
    await ui.update({ sheetColorMode: 'light' });
    await setSystemDark(false); await setSystemDark(true);
    assert.equal(ui.section.props['data-sheet-color-mode'], 'light');
    assert.equal(ui.cell('A1').props.style.color, '#217346');
    await ui.update({ sheetColorMode: 'dark' });
    await setSystemDark(false);
    assert.equal(ui.section.props['data-color-mode'], 'light');
    assert.equal(ui.section.props['data-sheet-color-mode'], 'dark');
    await ui.update({ colorMode: 'light', sheetColorMode: 'inherit' });
    assert.equal(ui.section.props['data-sheet-color-mode'], 'light');
    assert.equal(listeners.size, 0);
  });
}

test('sheet mode updates are instance-local, work when read-only and preserve draft, selection, history and notifications', async t => {
  const changes = [], dirty = [];
  const first = await mount(t, { onChange: value => changes.push(value), onDirtyChange: value => dirty.push(value) });
  const second = await mount(t, { colorMode: 'dark', sheetColorMode: 'light', readOnly: true });
  await act(async () => { assert.equal(first.ref.current.execute({ type: 'cells.set', sheetId: 'main', values: { E5: 'Edited' } }).ok, true); });
  await first.update({ readOnly: true });
  const draft = first.ref.current.getWorkbook(), native = serializeWorkbook(draft);
  const history = first.ref.current.getHistoryState(), selection = first.ref.current.getSelection();
  const changedCount = changes.length, dirtyBefore = [...dirty];
  const otherDraft = second.ref.current.getWorkbook(), otherStyle = { ...second.cell('A1').props.style };
  for (const sheetColorMode of ['dark', 'inherit', 'light', 'dark']) {
    await first.update({ sheetColorMode, colorMode: 'dark' });
    assert.equal(first.ref.current.getWorkbook(), draft, 'appearance preserves the current workbook snapshot');
    assert.deepEqual(first.ref.current.getWorkbook(), draft);
    assert.equal(serializeWorkbook(first.ref.current.getWorkbook()), native);
    assert.deepEqual(first.ref.current.getHistoryState(), history);
    assert.deepEqual(first.ref.current.getSelection(), selection);
    assert.deepEqual(second.ref.current.getWorkbook(), otherDraft);
    assert.equal(second.section.props['data-sheet-color-mode'], 'light');
    assert.deepEqual(second.cell('A1').props.style, otherStyle);
  }
  assert.ok(contrast(first.cell('A1').props.style.color, '#1e2421') >= 4.5, 'read-only mode accepts appearance updates');
  assert.equal(changes.length, changedCount);
  assert.deepEqual(dirty, dirtyBefore);
  assert.deepEqual(dirty, [false, true]);
  assert.deepEqual(first.ref.current.getWorkbook().sheets[0].drawings, draft.sheets[0].drawings);
});

test('SPON and XLSX exports retain original text, fill, border, conditional and drawing colors after dark-sheet rendering', async t => {
  const ui = await mount(t, { colorMode: 'light', sheetColorMode: 'dark', readOnly: true });
  const original = ui.ref.current.getWorkbook();
  let native;
  await act(async () => { native = await ui.ref.current.exportNative(); });
  const saved = parseWorkbook(await native.text());
  assert.deepEqual(saved, original);
  const xlsx = await exportSpreadsheetXlsx(original);
  const { workbook: restored } = await importSpreadsheetXlsx(xlsx);
  const sheet = restored.sheets[0];
  for (const address of ['A1', 'A2', 'B1', 'B2']) {
    const format = sheet.cells[address].format, expected = original.sheets[0].cells[address].format;
    assert.equal(format.color?.toLowerCase(), expected.color, `${address} exports saved text color`);
    assert.equal(format.background?.toLowerCase(), expected.background, `${address} exports saved background`);
  }
  assert.equal(sheet.cells.B1.format.borders.bottom.color.toLowerCase(), '#217346');
  assert.equal(sheet.cells.B1.format.borders.bottom.width, 2);
  // Conditional formatting is exported but intentionally omitted by the current importer.
  const archive = await openXlsxStreamingArchive(xlsx);
  const differential = children(child(parseXml(await archive.read('xl/styles.xml')), 'dxfs'), 'dxf');
  assert.equal(differential.length, 2);
  assert.equal(child(child(differential[0], 'font'), 'color').attributes.rgb, 'FF526359');
  assert.equal(child(child(differential[1], 'font'), 'color').attributes.rgb, 'FF8A2600');
  assert.equal(child(child(child(differential[1], 'fill'), 'patternFill'), 'fgColor').attributes.rgb, 'FFFCE4D6');
  for (const field of ['fill', 'stroke', 'color']) assert.equal(sheet.drawings[0][field].toLowerCase(), original.sheets[0].drawings[0][field]);
  assert.equal(ui.section.props['data-sheet-color-mode'], 'dark');
  assert.ok(contrast(ui.cell('A1').props.style.color, '#1e2421') >= 4.5);
  assert.deepEqual(ui.ref.current.getWorkbook(), original);
});
