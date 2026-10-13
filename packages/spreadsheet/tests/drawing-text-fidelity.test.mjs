import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './model-entry'; export { drawingText } from './import/drawing-style';
 export { parseXml } from './import/xml'; export { drawingTextStyle } from './ui/drawings/drawing-text-style';`,
 resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const parse = xml => m.parseXml(new TextEncoder().encode(xml));
const sheet = { id: 'one', name: 'Sheet1', cells: {}, rowCount: 20, columnCount: 10 };
const color = '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>';
function read(xml, fontReference, extra = {}) {
  const warnings = [];
  return { drawing: m.drawingText(parse(xml), { warn: value => warnings.push(value), ...extra }, sheet, fontReference && parse(fontReference)), warnings };
}
const box = style => ({ id: 'label', type: 'text', anchor: { row: 1, column: 1, offsetX: 0, offsetY: 0 }, width: 48, height: 20,
 text: '消費税区分名称', fontSize: 12, color: '#FF0000', background: 'transparent', ...style });
const layout = { fontFamily: 'ＭＳ Ｐゴシック', italic: true, underline: true, textInsets: { left: 0, top: 0, right: 0, bottom: 0 },
 textWrap: 'none', textOverflow: 'overflow', textVerticalOverflow: 'overflow', textAlign: 'left', textVerticalAlign: 'top', textAutoFit: 'none', textLineHeight: 1.2 };

test('DrawingML inherits paragraph run properties per field even when the run only specifies its language', () => {
  const { drawing, warnings } = read(`<a:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" wrap="none"/><a:p><a:pPr><a:defRPr sz="900" b="1" i="1" u="sng">${color}<a:ea typeface="ＭＳ Ｐゴシック"/></a:defRPr></a:pPr><a:r><a:rPr lang="ja-JP"/><a:t>消費税区分名称</a:t></a:r></a:p></a:txBody>`);
  assert.equal(drawing.fontSize, 12); assert.equal(drawing.color, '#FF0000'); assert.equal(drawing.fontFamily, 'ＭＳ Ｐゴシック');
  assert.equal(drawing.bold, true); assert.equal(drawing.italic, true); assert.equal(drawing.underline, true);
  assert.deepEqual(drawing.textInsets, layout.textInsets); assert.equal(drawing.textWrap, 'none'); assert.deepEqual(warnings, []);
});

test('explicit run properties override defaults and fontRef resolves Japanese theme fonts and colors', () => {
  const { drawing, warnings } = read(`<a:txBody><a:bodyPr/><a:p><a:pPr><a:defRPr sz="900" b="1"/></a:pPr><a:r><a:rPr sz="1200" b="0"/><a:t>注記</a:t></a:r></a:p></a:txBody>`,
    '<a:fontRef idx="minor"><a:srgbClr val="FF0000"/></a:fontRef>', { themeFonts: { '+mn-ea': 'Yu Gothic' } });
  assert.equal(drawing.fontSize, 16); assert.equal(drawing.bold, false); assert.equal(drawing.fontFamily, 'Yu Gothic'); assert.equal(drawing.color, '#FF0000'); assert.deepEqual(warnings, []);
});

test('nowrap overflow labels retain their visible area while shrink and clipping remain explicit independent settings', () => {
  const style = m.drawingTextStyle(box(layout));
  assert.equal(style.padding, '0px 0px 0px 0px'); assert.equal(style.whiteSpace, 'pre'); assert.equal(style.clipPath, 'none');
  assert.equal(style.fontFamily, 'ＭＳ Ｐゴシック'); assert.equal(style.fontSize, 12);
  const { drawing } = read(`<a:txBody><a:bodyPr wrap="square" horzOverflow="clip" vertOverflow="clip" anchor="b"><a:normAutofit fontScale="75000"/></a:bodyPr><a:p><a:pPr algn="r"><a:lnSpc><a:spcPct val="125000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="900"/><a:t>消費税区分名称</a:t></a:r></a:p></a:txBody>`);
  assert.equal(drawing.textAutoFit, 'shrink'); assert.equal(drawing.textFontScale, 0.75); assert.equal(drawing.textLineHeight, 1.25);
  assert.equal(drawing.textAlign, 'right'); assert.equal(drawing.textVerticalAlign, 'bottom');
  assert.equal(m.drawingTextStyle(box(drawing)).fontSize, 9); assert.equal(m.drawingTextStyle(box(drawing)).clipPath, 'inset(0px 0px)');
});

test('text layout survives public creation, update, copy, SPON and XLSX roundtrip', async () => {
  const created = m.applySpreadsheetCommands({ sheets: [sheet] }, [{ type: 'textBoxes.insert', sheetId: 'one', anchor: { row: 1, column: 1 },
    text: '消費税区分名称', width: 48, height: 20, fontSize: 12, color: '#FF0000', ...layout }]);
  assert.equal(created.ok, true); const id = created.workbook.sheets[0].drawings[0].id;
  const updated = m.applySpreadsheetCommands(created.workbook, [{ type: 'textBoxes.update', sheetId: 'one', drawingId: id, patch: { text: '消費税額', textAlign: 'right' } }]);
  assert.equal(updated.ok, true); assert.equal(updated.changed, true);
  const drawing = updated.workbook.sheets[0].drawings[0];
  assert.equal(drawing.fontFamily, layout.fontFamily); assert.deepEqual(drawing.textInsets, layout.textInsets);
  assert.equal(m.copySpreadsheetDrawing(updated.workbook, 'one', id).drawing.textAlign, 'right');
  assert.deepEqual(m.parseWorkbook(m.serializeWorkbook(updated.workbook)), updated.workbook);
  const imported = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(updated.workbook));
  const actual = imported.workbook.sheets[0].drawings[0];
  for (const key of Object.keys(layout)) assert.deepEqual(actual[key], drawing[key], key);
  assert.deepEqual(imported.warnings, []);
});

test('invalid text layout fails atomically and style-only edits are detected', () => {
  const initial = { sheets: [{ ...sheet, drawings: [box(layout)] }] };
  for (const patch of [{ textInsets: { ...layout.textInsets, left: -1 } }, { textFontScale: 0 }, { textAlign: 'bad' }, { fontFamily: 'x; color:red' }, { italic: 'true' }]) {
    const rejected = m.applySpreadsheetCommands(initial, [{ type: 'textBoxes.update', sheetId: 'one', drawingId: 'label', patch: { text: 'would-change' } }, { type: 'textBoxes.update', sheetId: 'one', drawingId: 'label', patch }]);
    assert.equal(rejected.ok, false); assert.equal(initial.sheets[0].drawings[0].text, '消費税区分名称');
  }
  const updated = m.applySpreadsheetCommands(initial, [{ type: 'textBoxes.update', sheetId: 'one', drawingId: 'label', patch: { textInsets: { ...layout.textInsets, left: 2 } } }]);
  assert.equal(updated.ok, true); assert.equal(updated.changed, true); assert.equal(initial.sheets[0].drawings[0].textInsets.left, 0);
});

test('native drawing defaults stay zero through public insertion, SPON and XLSX while explicit insets survive', async () => {
  const explicitInsets = { left: 2, top: 3, right: 4, bottom: 5 };
  const commands = ['shape', 'text'].flatMap(kind => [undefined, explicitInsets].map(textInsets => ({
    type: kind === 'shape' ? 'shapes.insert' : 'textBoxes.insert', sheetId: 'one',
    ...(kind === 'shape' ? { shape: 'rectangle' } : {}), anchor: { row: 1, column: 1 },
    text: '狭い枠の文字', width: 48, height: 20, ...(textInsets ? { textInsets } : {}),
  })));
  const created = m.applySpreadsheetCommands({ sheets: [sheet] }, commands);
  assert.equal(created.ok, true);
  const saved = m.parseWorkbook(m.serializeWorkbook(created.workbook));
  assert.deepEqual(saved, created.workbook, 'default interpretation does not rewrite the stored objects');
  for (const [i, drawing] of saved.sheets[0].drawings.entries()) {
    assert.equal(m.drawingTextStyle(drawing).padding, i % 2 ? '3px 4px 5px 2px' : '0px 0px 0px 0px');
  }
  const imported = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(saved));
  for (const [i, drawing] of imported.workbook.sheets[0].drawings.entries()) {
    assert.deepEqual(drawing.textInsets, i % 2 ? explicitInsets : { left: 0, top: 0, right: 0, bottom: 0 });
    assert.equal(m.drawingTextStyle(drawing).padding, m.drawingTextStyle(saved.sheets[0].drawings[i]).padding);
  }
  assert.deepEqual(imported.warnings, []);
});

test('Office inherited and explicit margins retain their layout instead of adopting native zero padding', async () => {
  const { drawing } = read('<a:txBody><a:bodyPr lIns="19050"/><a:p><a:r><a:t>Excelの文字</a:t></a:r></a:p></a:txBody>');
  const insets = { left: 2, top: 4.8, right: 9.6, bottom: 4.8 };
  assert.deepEqual(drawing.textInsets, insets);
  const initial = { sheets: [{ ...sheet, drawings: [box(drawing)] }] };
  const imported = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(initial));
  assert.deepEqual(imported.workbook.sheets[0].drawings[0].textInsets, insets);
});
