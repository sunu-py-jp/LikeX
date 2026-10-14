import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip } from './helpers/xlsx-import-fixtures.mjs';

const output = await build({ stdin: { contents: `
  export { importSpreadsheetXlsx, createSpreadsheetExcelFontMeasurer } from './src/index';
  export { importSpreadsheetXlsx as importModel } from './src/model-entry';`,
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const font = { fontFamily: 'MS PGothic', fontSize: 11 / 0.75, bold: false, italic: false };
const source = () => zip(fixture({ sheets: [{ name: 'Narrow columns', xml: '<cols><col min="1" max="60" width="1.42578125"/></cols><sheetData/>' }],
  links: [{ id: 'styles', type: 'styles', target: 'styles.xml' }], parts: {
    'xl/styles.xml': '<styleSheet><fonts><font><name val="MS PGothic"/><sz val="11"/></font></fonts><cellStyleXfs><xf fontId="0"/></cellStyleXfs><cellStyles><cellStyle name="Normal" builtinId="0" xfId="0"/></cellStyles></styleSheet>',
  } }));
function browser({ available = true, ratio = 1.5, load = async () => [] } = {}) {
  const measured = [], loaded = [];
  const context = { font: '', measureText(text) {
    measured.push({ text, font: this.font });
    if (!available) return { width: this.font.endsWith('monospace') ? 20 : 30 };
    return { width: /^\d$/.test(text) ? text === '8' ? 10.8 : 10.1 : text.length * 10.8 };
  } };
  return { measured, loaded, defaultView: { devicePixelRatio: ratio },
    fonts: { load: (...args) => { loaded.push(args); return load(...args); } },
    createElement(tag) { assert.equal(tag, 'canvas'); return { getContext: kind => { assert.equal(kind, '2d'); return context; } }; },
  };
}
function useDocument(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; });
}

test('browser entry measures the Normal font at device resolution and retains fractional narrow columns', async t => {
  const document = browser(); useDocument(t, document);
  const { workbook, warnings } = await api.importSpreadsheetXlsx(source());
  assert.equal(document.loaded.length, 1);
  assert.match(document.loaded[0][0], /22px "MS PGothic"/);
  assert.deepEqual(document.measured.filter(m => /^\d$/.test(m.text)).map(m => m.text), Array.from('0123456789'));
  assert.equal(workbook.sheets[0].columnWidths[1], 16 / 1.5);
  const total = Object.values(workbook.sheets[0].columnWidths).reduce((sum, width) => sum + width, 0);
  assert.ok(Math.abs(total - 640) < 1e-9);
  assert.ok(!warnings.some(w => w.message.includes('列幅へ近似')));
});

test('web fonts finish loading before their widths are sampled', async () => {
  let finish;
  const document = browser({ load: () => new Promise(resolve => { finish = resolve; }) });
  const result = api.createSpreadsheetExcelFontMeasurer(document)(font);
  assert.equal(document.measured.length, 0);
  finish([]);
  assert.deepEqual(await result, { maximumDigitWidth: 10.8, pixelRatio: 1.5 });
});

test('missing fonts and failed font loading do not adopt unrelated fallback-font widths', async t => {
  useDocument(t, browser({ available: false }));
  const result = await api.importSpreadsheetXlsx(source());
  assert.equal(result.workbook.sheets[0].columnWidths[1], 10);
  assert.ok(result.warnings.some(w => w.message.includes('列幅へ近似')));
  const document = browser({ load: async () => { throw new Error('unavailable font'); } });
  assert.equal(await api.createSpreadsheetExcelFontMeasurer(document)(font), undefined);
  assert.equal(document.measured.length, 0);
});

test('explicit host metrics override automatic measurement and model imports never touch the DOM', async t => {
  useDocument(t, { createElement() { throw new Error('must not measure'); } });
  let calls = 0;
  const result = await api.importSpreadsheetXlsx(source(), { columnWidthMeasurement(f) {
    calls++; assert.equal(f.fontFamily, 'MS PGothic'); return { maximumDigitWidth: 11, pixelRatio: 1.5 };
  } });
  assert.equal(calls, 1);
  assert.equal(result.workbook.sheets[0].columnWidths[1], 16 / 1.5);
  const plain = await api.importModel(source());
  assert.equal(plain.workbook.sheets[0].columnWidths[1], 10);
});

test('browser entry is safe without DOM and reports unavailable non-default metrics', async t => {
  useDocument(t, undefined);
  const result = await api.importSpreadsheetXlsx(source());
  assert.equal(result.workbook.sheets[0].columnWidths[1], 10);
  assert.ok(result.warnings.some(w => w.message.includes('列幅へ近似')));
  assert.equal(await api.createSpreadsheetExcelFontMeasurer({ createElement: () => ({ getContext: () => null }) })(font), undefined);
});

test('cancelling while a browser font is loading rejects without waiting for the font', async t => {
  let started, finish;
  const ready = new Promise(resolve => { started = resolve; });
  const document = browser({ load: () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  useDocument(t, document);
  const controller = new AbortController();
  const task = api.importSpreadsheetXlsx(source(), { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(task, error => error.name === 'AbortError');
  finish([]);
});
