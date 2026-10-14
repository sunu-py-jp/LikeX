import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip, main, rel } from './helpers/xlsx-import-fixtures.mjs';

const output = await build({ stdin: { contents: `export * from './model-entry';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const normalStyles = (extra = '') => `<styleSheet xmlns="${main}"><fonts count="2"><font><name val="Calibri"/><sz val="11"/></font><font><name val="MS PGothic"/><sz val="11"/><b/><i/>${extra}</font></fonts><cellStyleXfs count="2"><xf fontId="0"/><xf fontId="1"/></cellStyleXfs><cellStyles count="2"><cellStyle name="Other" builtinId="1" xfId="0"/><cellStyle name="標準" builtinId="0" xfId="1"/></cellStyles><cellXfs count="1"><xf fontId="0"/></cellXfs></styleSheet>`;
function file({ styles = normalStyles(), sheet = '<cols><col min="1" max="60" width="1.5"/></cols><sheetData/>', sheets, parts = {}, links = [], workbookExtra = '' } = {}) {
  return zip(fixture({ sheets: sheets ?? [{ name: 'Sheet 1', xml: sheet }], workbookExtra,
    links: [{ id: 'styles', type: 'styles', target: 'styles.xml' }, ...links], parts: { 'xl/styles.xml': styles, ...parts } }));
}
const measured = (maximumDigitWidth = 10.5, pixelRatio = 1.5) => ({ columnWidthMeasurement: () => ({ maximumDigitWidth, pixelRatio }) });

test('column units use the Normal style XF font, measured once for every sheet', async () => {
  const fonts = [];
  const result = await m.importSpreadsheetXlsx(file({ sheets: [{ name: 'A', xml: '<cols><col min="1" max="1" width="1.5"/></cols><sheetData/>' }, { name: 'B', xml: '<sheetData/>' }] }), {
    columnWidthMeasurement: async font => { fonts.push(font); return { maximumDigitWidth: 8, pixelRatio: 1 }; },
  });
  assert.deepEqual(fonts, [{ fontFamily: 'MS PGothic', fontSize: 11 / .75, bold: true, italic: true }]);
  assert.ok(Object.isFrozen(fonts[0]));
  assert.equal(result.workbook.sheets[0].columnWidths[0], 12);
  assert.equal(result.workbook.sheets[1].columnWidths[0], 72);
  assert.ok(!result.warnings.some(w => w.message.includes('列幅を測定')));
});

test('Normal font schemes resolve their active theme Latin family', async () => {
  const fonts = [];
  const result = await m.importSpreadsheetXlsx(file({ styles: normalStyles('<scheme val="minor"/>'), links: [{ id: 'theme', type: 'theme', target: 'theme/theme1.xml' }], parts: {
    'xl/theme/theme1.xml': '<theme><themeElements><fontScheme><minorFont><latin typeface="Aptos"/><font script="Jpan" typeface="Yu Gothic"/></minorFont></fontScheme></themeElements></theme>',
  } }), { columnWidthMeasurement: font => { fonts.push(font); return { maximumDigitWidth: 9, pixelRatio: 1 }; } });
  assert.equal(fonts[0].fontFamily, 'Aptos');
  assert.equal(result.workbook.sheets[0].columnWidths[0], 13);
});

test('narrow columns keep device-pixel rounding at 100% and 150%, including cumulative positions', async () => {
  const at100 = await m.importSpreadsheetXlsx(file(), measured(7, 1));
  const at150 = await m.importSpreadsheetXlsx(file(), measured());
  assert.equal(at100.workbook.sheets[0].columnWidths[0], 10);
  assert.equal(at150.workbook.sheets[0].columnWidths[0], 16 / 1.5);
  const sum = Object.entries(at150.workbook.sheets[0].columnWidths).filter(([index]) => Number(index) < 60).reduce((total, [, width]) => total + width, 0);
  assert.ok(Math.abs(sum - 640) < 1e-9);
  // Truncating at CSS-pixel resolution would incorrectly lose 40 CSS pixels here.
  assert.ok(sum - 60 * 10 > 39.99);
  const restored = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(at150.workbook));
  for (let column = 0; column < 60; column++) assert.ok(Math.abs(restored.workbook.sheets[0].columnWidths[column] - 16 / 1.5) <= 1);
});

test('source drawing coordinates follow the same first-valid overlapping column declarations', async () => {
  const result = await m.importSpreadsheetXlsx(file({ sheet: '<cols><col min="1" max="10" width="-1"/><col min="1" max="10" width="1.5"/><col min="3" max="3" width="4"/></cols><sheetData/><drawing r:id="drawing"/>', parts: {
    'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships><Relationship Id="drawing" Type="${rel}drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    'xl/drawings/drawing1.xml': `<wsDr><oneCellAnchor><from><col>3</col><colOff>0</colOff><row>1</row><rowOff>0</rowOff></from><ext cx="381000" cy="190500"/><sp><nvSpPr><cNvPr id="1" name="Box"/><cNvSpPr/></nvSpPr><spPr><xfrm><off x="304800" y="190500"/><ext cx="381000" cy="190500"/></xfrm><prstGeom prst="rect"/></spPr></sp></oneCellAnchor></wsDr>`,
  } }), measured());
  const sheet = result.workbook.sheets[0], drawing = sheet.drawings[0];
  assert.equal(sheet.columnWidths[2], 16 / 1.5);
  assert.equal(drawing.anchor.column, 3);
  assert.equal(drawing.anchor.offsetX, 0);
  assert.equal(m.getDrawingBounds(result.workbook, sheet.id, drawing.id).left, 32);
  assert.ok(result.warnings.some(w => w.message.includes('最初の有効な列幅')));
});

test('stored defaults, base character widths and named-range sheet growth share the measurement', async () => {
  for (const [setting, expected] of [['defaultColWidth="1.5"', 16 / 1.5], ['baseColWidth="8"', 64]]) {
    const result = await m.importSpreadsheetXlsx(file({ sheet: `<sheetFormatPr ${setting}/><sheetData/>`,
      workbookExtra: '<definedNames><definedName name="Later">\'Sheet 1\'!CV101</definedName></definedNames>' }), measured());
    const sheet = result.workbook.sheets[0];
    assert.equal(sheet.columnCount, 100);
    assert.equal(sheet.columnWidths[0], expected);
    assert.equal(sheet.columnWidths[99], expected);
  }
});

test('unavailable measurements keep deterministic headless widths and disclose font approximation', async () => {
  for (const options of [{}, { columnWidthMeasurement: () => undefined }]) {
    const result = await m.importSpreadsheetXlsx(file(), options);
    assert.equal(result.workbook.sheets[0].columnWidths[0], 10);
    assert.equal(result.warnings.filter(w => w.message.includes('列幅を測定')).length, 1);
  }
  const standard = await m.importSpreadsheetXlsx(zip(fixture()));
  assert.equal(standard.workbook.sheets[0].columnWidths[0], 64);
  assert.ok(!standard.warnings.some(w => w.message.includes('列幅を測定')));
});

test('invalid host metrics fail clearly instead of normalizing poisoned column geometry', async () => {
  for (const metrics of [null, {}, { maximumDigitWidth: NaN, pixelRatio: 1 }, { maximumDigitWidth: Infinity, pixelRatio: 1 },
    { maximumDigitWidth: 0, pixelRatio: 1 }, { maximumDigitWidth: .1, pixelRatio: 1 }, { maximumDigitWidth: 4097, pixelRatio: 1 },
    { maximumDigitWidth: 7, pixelRatio: 0 }, { maximumDigitWidth: 7, pixelRatio: Infinity }, { maximumDigitWidth: 7, pixelRatio: .1 }, { maximumDigitWidth: 7, pixelRatio: 9 }]) {
    await assert.rejects(m.importSpreadsheetXlsx(file(), { columnWidthMeasurement: () => metrics }), /列幅測定結果が不正/);
  }
  const failure = new Error('host measurement failed');
  await assert.rejects(m.importSpreadsheetXlsx(file(), { columnWidthMeasurement: () => { throw failure; } }), error => error === failure);
});

test('abort while awaiting font measurement settles promptly and cleans up the listener', async () => {
  const controller = new AbortController(); let entered, finish, attached = 0, removed = 0;
  const ready = new Promise(resolve => { entered = resolve; });
  const signal = { get aborted() { return controller.signal.aborted; }, get reason() { return controller.signal.reason; },
    throwIfAborted: () => controller.signal.throwIfAborted(),
    addEventListener: (...args) => { attached++; controller.signal.addEventListener(...args); },
    removeEventListener: (...args) => { removed++; controller.signal.removeEventListener(...args); },
  };
  const result = m.importSpreadsheetXlsx(file(), { signal, columnWidthMeasurement: () => { entered(); return new Promise(resolve => { finish = resolve; }); } });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await ready;
  controller.abort();
  await rejected;
  assert.ok(attached > 0); assert.equal(removed, attached);
  finish({ maximumDigitWidth: 7, pixelRatio: 1 });
  const preAborted = new AbortController(); preAborted.abort(); let calls = 0;
  await assert.rejects(m.importSpreadsheetXlsx(file(), { signal: preAborted.signal, columnWidthMeasurement: () => { calls++; } }), { name: 'AbortError' });
  assert.equal(calls, 0);
});
