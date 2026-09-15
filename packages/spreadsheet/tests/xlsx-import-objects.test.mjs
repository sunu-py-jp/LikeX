import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export { readWorksheetExtras } from './import/sheet-extras';
  export { parseXml } from './import/xml'; export { normalizeWorkbook } from './model/workbook';
  export { SPREADSHEET_SHAPES, getShapeDefinition } from './model/shapes';`,
  resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { readWorksheetExtras, parseXml, normalizeWorkbook, SPREADSHEET_SHAPES, getShapeDefinition } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const bytes = source => typeof source === 'string' ? new TextEncoder().encode(source) : source;
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64'));
const relType = name => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${name}`;
const drawingPath = 'xl/drawings/drawing1.xml';
const relationship = (id, type, target, external = false) => ({ id, type: relType(type), target, external });
const relationshipXml = entries => `<Relationships>${entries.map(({ id, type, target, external }) =>
  `<Relationship Id="${id}" Type="${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
const marker = (row, column, dx = 0, dy = 0) => `<col>${column}</col><colOff>${dx * 9525}</colOff><row>${row}</row><rowOff>${dy * 9525}</rowOff>`;
const one = (object, row = 1, column = 2, width = 120, height = 60) => `<oneCellAnchor><from>${marker(row, column, 3, 4)}</from><ext cx="${width * 9525}" cy="${height * 9525}"/>${object}<clientData/></oneCellAnchor>`;
const color = (value = '123456') => `<solidFill><srgbClr val="${value}"/></solidFill>`;
const shape = (preset = 'rect', options = {}) => `<sp><nvSpPr><cNvPr id="${options.id ?? 1}" name="Sample"/><cNvSpPr${options.textBox ? ' txBox="1"' : ''}/></nvSpPr><spPr>
  <xfrm${options.rotation ? ` rot="${options.rotation * 60000}"` : ''}${options.flipX ? ' flipH="1"' : ''}${options.flipY ? ' flipV="1"' : ''}>${options.xfrmFrame ?? ''}</xfrm>
  <prstGeom prst="${preset}"><avLst>${options.guides ?? ''}</avLst></prstGeom>${color('E8F3EC')}<ln w="19050">${color('217346')}${options.ends ?? ''}</ln>${options.effects ?? ''}</spPr>
  <txBody><bodyPr${options.body ?? ''}/><p><r><rPr sz="1200" b="1">${color()}</rPr><t>確認 &amp; &lt;OK&gt;</t></r><br/><r><rPr sz="1200" b="1">${color()}</rPr><t>次</t></r></p><p><r><t>段落</t></r></p></txBody></sp>`;
const image = (id = 'image', extra = '') => `<pic><nvPicPr><cNvPr id="2" name="Image" descr="説明"/></nvPicPr><blipFill><blip r:embed="${id}"/>${extra}<stretch><fillRect/></stretch></blipFill><spPr><xfrm/></spPr></pic>`;

function harness({ drawings = '', sheetXml = '', files = {}, drawingRels = [], sheetRels = [], cells = {}, sheet = {}, context: extra = {} } = {}) {
  const entries = new Map(Object.entries(files).map(([path, value]) => [path, bytes(value)]));
  if (drawings) { entries.set(drawingPath, bytes(`<wsDr>${drawings}</wsDr>`)); entries.set('xl/drawings/_rels/drawing1.xml.rels', bytes(relationshipXml(drawingRels))); }
  const reads = [], warnings = [];
  const context = { archive: { paths: [...entries.keys()], has: path => entries.has(path), read: async path => {
    reads.push(path); assert.ok(entries.has(path), `missing ${path}`); return entries.get(path);
  } }, warnings, resources: {}, warn: warning => warnings.push(warning), ...extra };
  const initial = { id: 'test', name: 'テスト', rowCount: 10, columnCount: 10, cells, ...sheet };
  const node = parseXml(bytes(`<worksheet>${drawings ? '<drawing r:id="drawing"/>' : ''}${sheetXml}</worksheet>`));
  const relationships = new Map([...sheetRels, ...(drawings ? [relationship('drawing', 'drawing', drawingPath)] : [])].map(rel => [rel.id, rel]));
  return { context, warnings, reads, initial, run: async () => readWorksheetExtras(node, initial, 'xl/worksheets/sheet1.xml', relationships, context) };
}

test('all 16 native shapes retain editable kinds, text, colors, clockwise rotation and reflections', async () => {
  for (const { kind } of SPREADSHEET_SHAPES) {
    const preset = getShapeDefinition(kind).xlsxPreset;
    const env = harness({ drawings: one(shape(preset, { rotation: 45, flipX: true, flipY: true,
      xfrmFrame: '<off x="1247775" y="228600"/><ext cx="1143000" cy="571500"/>', ends: kind === 'arrow' ? '<tailEnd type="triangle"/>' : '' })) });
    const imported = await env.run(), drawing = imported.drawings[0];
    assert.equal(drawing.type, 'shape'); assert.equal(drawing.shape, kind);
    assert.equal(drawing.rotation, 45); assert.equal(drawing.flipX, true); assert.equal(drawing.flipY, true);
    assert.equal(drawing.text, '確認 & <OK>\n次\n段落'); assert.equal(drawing.fontSize, 16);
    assert.equal(drawing.fill, '#E8F3EC'); assert.equal(drawing.stroke, '#217346'); assert.equal(drawing.color, '#123456');
    assert.equal(drawing.strokeWidth, 2); assert.equal(drawing.bold, true);
    assert.deepEqual(drawing.anchor, { row: 1, column: 2, offsetX: 3, offsetY: 4 });
    assert.equal(drawing.width, 120); assert.equal(drawing.height, 60);
    assert.doesNotThrow(() => normalizeWorkbook({ sheets: [imported] }));
  }
});

test('head-only arrow reverses both local axes, both ends report approximation, and custom preset adjustments warn', async () => {
  const env = harness({ drawings: one(shape('line', { ends: '<headEnd type="triangle"/>' })) +
    one(shape('line', { ends: '<headEnd type="triangle"/><tailEnd type="triangle"/>' })) +
    one(shape('rightArrow', { guides: '<gd name="adj2" fmla="val 1000"/>' })) });
  const imported = await env.run();
  assert.equal(imported.drawings[0].shape, 'arrow'); assert.equal(imported.drawings[0].flipX, true); assert.equal(imported.drawings[0].flipY, true);
  assert.ok(env.warnings.some(item => item.message.includes('両端')));
  assert.ok(env.warnings.some(item => item.message.includes('細かな変形')));
});

test('rotated two-cell anchors use unrotated xfrm frame instead of its larger bounding box', async () => {
  const object = shape('rect', { rotation: 90, xfrmFrame: '<off x="609600" y="381000"/><ext cx="1143000" cy="571500"/>' });
  const env = harness({ drawings: `<twoCellAnchor><from>${marker(0, 0)}</from><to>${marker(10, 5)}</to>${object}<clientData/></twoCellAnchor>` });
  const imported = await env.run(), drawing = imported.drawings[0];
  assert.deepEqual(drawing.anchor, { row: 2, column: 1, offsetX: 0, offsetY: 0 });
  assert.equal(drawing.width, 120); assert.equal(drawing.height, 60); assert.equal(drawing.rotation, 90);
});

test('two-cell and absolute anchors respect row and column sizes and grow the canvas with Excel defaults', async () => {
  const env = harness({ sheet: { rowCount: 2, columnCount: 2, rowHeights: { 0: 30 }, columnWidths: { 0: 90 } }, drawings:
    `<twoCellAnchor><from>${marker(1, 1, 2, 3)}</from><to>${marker(3, 3, 2, 3)}</to>${shape()}<clientData/></twoCellAnchor>` +
    `<absoluteAnchor><pos x="${(90 + 64 * 3) * 9525}" y="${(30 + 20 * 3) * 9525}"/><ext cx="952500" cy="476250"/>${shape('ellipse')}<clientData/></absoluteAnchor>` });
  const imported = await env.run();
  assert.equal(imported.drawings[0].width, 128); assert.equal(imported.drawings[0].height, 40);
  assert.equal(imported.rowCount, 5); assert.equal(imported.columnCount, 5);
  assert.equal(imported.rowHeights[4], 20); assert.equal(imported.columnWidths[4], 64);
});

test('embedded raster resources are validated and shared, preserve image aspect ratio, and remain JSON serializable', async () => {
  const env = harness({ drawings: one(image()) + one(image(), 5, 5, 40, 40),
    files: { 'xl/media/pixel.png': png }, drawingRels: [relationship('image', 'image', '../media/pixel.png')] });
  const imported = await env.run();
  assert.equal(imported.drawings[0].resourceId, 'image-1'); assert.equal(imported.drawings[1].resourceId, 'image-1');
  assert.equal(imported.drawings[0].alt, '説明'); assert.equal(env.reads.filter(path => path.endsWith('.png')).length, 1);
  assert.equal(env.context.resources['image-1'].width, 1); assert.equal(env.context.resources['image-1'].height, 1);
  assert.ok(env.warnings.some(item => item.message.includes('縦横比')));
  assert.doesNotThrow(() => normalizeWorkbook(JSON.parse(JSON.stringify({ sheets: [imported], resources: { images: env.context.resources } }))));
});

test('external media, SVG, charts, grouped objects and unsupported geometry are omitted without fetching media', async () => {
  const env = harness({ drawings: one(image('external')) + one(image('svg')) + one('<graphicFrame/>') + one('<grpSp/>') + one(shape('star5')),
    files: { 'xl/media/image.svg': '<svg onload="alert(1)"/>' },
    drawingRels: [relationship('external', 'image', 'https://example.invalid/pixel.png', true), relationship('svg', 'image', '../media/image.svg')] });
  const imported = await env.run();
  assert.equal(imported.drawings, undefined); assert.deepEqual(env.context.resources, {});
  assert.ok(!env.reads.some(path => path.startsWith('http') || path.endsWith('.svg'))); assert.equal(env.warnings.length, 5);
});

test('invalid and oversized image data cannot enter the model; an oversized image rejects the import', async () => {
  const invalid = harness({ drawings: one(image()), files: { 'xl/media/bad.png': new Uint8Array(20) }, drawingRels: [relationship('image', 'image', '../media/bad.png')] });
  assert.equal((await invalid.run()).drawings, undefined); assert.deepEqual(invalid.context.resources, {});
  const large = harness({ drawings: one(image()), files: { 'xl/media/large.png': new Uint8Array(5 * 1024 * 1024 + 1) }, drawingRels: [relationship('image', 'image', '../media/large.png')] });
  await assert.rejects(large.run(), /5 MiB/);
});

test('textbox content, embedded colors and rotation import independently of the omitted outline', async () => {
  const env = harness({ drawings: one(shape('rect', { textBox: true, rotation: 30, effects: '<effectLst><outerShdw/></effectLst>' })) });
  const drawing = (await env.run()).drawings[0];
  assert.equal(drawing.type, 'text'); assert.equal(drawing.background, '#E8F3EC'); assert.equal(drawing.rotation, 30);
  assert.ok(env.warnings.some(item => item.message.includes('外枠'))); assert.ok(env.warnings.some(item => item.message.includes('3D')));
});

test('classic comments retain text and authors, relocate merged comments, and omit threaded comments', async () => {
  const env = harness({ sheet: { merges: [{ top: 0, left: 0, bottom: 1, right: 1 }] }, files: {
    'xl/comments1.xml': '<comments><authors><author>田中</author></authors><commentList><comment ref="B2" authorId="0"><text><r><t>確認</t></r><r><t>済み</t></r></text></comment><comment ref="C20" authorId="0"><text><t>次</t></text></comment></commentList></comments>',
  }, sheetRels: [relationship('comments', 'comments', 'xl/comments1.xml'), relationship('threaded', 'threadedComment', 'https://example.invalid/threaded', true)] });
  const imported = await env.run();
  assert.equal(imported.comments.A1.text, '確認済み'); assert.equal(imported.comments.A1.author, '田中'); assert.equal(imported.rowCount, 20);
  assert.equal(imported.comments.C20.text, '次'); assert.ok(env.warnings.some(item => item.message.includes('スレッド')));
});

test('native tables retain definitions without rewriting cell values; invalid headers omit only the definition', async () => {
  const table = name => `<table displayName="${name}" ref="A1:B3" totalsRowCount="1"><tableColumns><tableColumn id="1" name="商品"/><tableColumn id="2" name="数量"/></tableColumns><tableStyleInfo name="TableStyleMedium2"/></table>`;
  const env = harness({ sheetXml: '<tableParts><tablePart r:id="table"/></tableParts>', files: { 'xl/tables/table1.xml': table('Sales') },
    sheetRels: [relationship('table', 'table', 'xl/tables/table1.xml')], cells: { A1: { value: '商品' }, B1: { value: '数量' }, A2: { value: 'りんご' }, B2: { value: '5' }, B3: { value: '=SUM(B2)' } } });
  const imported = await env.run();
  assert.equal(imported.tables[0].name, 'Sales'); assert.equal(imported.tables[0].range.bottom, 1); assert.equal(imported.cells.B3.value, '=SUM(B2)');
  assert.doesNotThrow(() => normalizeWorkbook({ sheets: [imported] }));
  const bad = harness({ sheetXml: '<tableParts><tablePart r:id="table"/></tableParts>', files: { 'xl/tables/table1.xml': table('Sales') }, sheetRels: [relationship('table', 'table', 'xl/tables/table1.xml')], cells: { A1: { value: 'different' } } });
  const rejected = await bad.run(); assert.equal(rejected.tables, undefined); assert.equal(rejected.cells.A1.value, 'different');
});

test('simple validations cover discontiguous ranges, named lists, strict integer bounds and 1904 date conversion', async () => {
  const env = harness({ context: { date1904: true, resolveListValues: name => name === 'Options' ? ['A', 'B'] : undefined }, sheetXml:
    '<dataValidations><dataValidation type="list" sqref="A1 C1:C2" allowBlank="1"><formula1>"未着手,完了"</formula1></dataValidation>' +
    '<dataValidation type="list" sqref="D1"><formula1>Options</formula1></dataValidation>' +
    '<dataValidation type="whole" operator="greaterThan" sqref="B2"><formula1>4.5</formula1></dataValidation>' +
    '<dataValidation type="date" operator="equal" sqref="B3"><formula1>0</formula1></dataValidation></dataValidations>' });
  const imported = await env.run();
  assert.deepEqual(imported.cells.C2.validation.values, ['未着手', '完了']); assert.equal(imported.cells.C2.validation.allowBlank, true);
  assert.deepEqual(imported.cells.D1.validation.values, ['A', 'B']); assert.equal(imported.cells.B2.validation.min, 5);
  assert.equal(imported.cells.B3.validation.min, '1904-01-01'); assert.equal(imported.cells.B3.validation.max, '1904-01-01');
});

test('complex or nonblocking validation rules warn, and overlapping expansion cannot evade the work budget', async () => {
  const env = harness({ sheetXml: '<dataValidations><dataValidation type="custom" sqref="A1"><formula1>ISNUMBER(A1)</formula1></dataValidation><dataValidation type="whole" sqref="B1" errorStyle="warning"><formula1>1</formula1><formula2>5</formula2></dataValidation></dataValidations>' });
  assert.deepEqual((await env.run()).cells, {}); assert.equal(env.warnings.length, 2);
  const repeated = '<dataValidation type="whole" sqref="A1:J10000"><formula1>0</formula1><formula2>5</formula2></dataValidation>';
  const large = harness({ sheetXml: `<dataValidations>${repeated}${repeated}</dataValidations>` });
  await assert.rejects(large.run(), /対象セル数/);
});

test('cancellation and drawing counts stop import before any pending resources are read', async () => {
  const controller = new AbortController(); controller.abort();
  const env = harness({ drawings: one(image()), context: { signal: controller.signal } });
  await assert.rejects(env.run(), { name: 'AbortError' }); assert.deepEqual(env.reads, []);
  const large = harness({ drawings: Array.from({ length: 1001 }, () => one('<grpSp/>')).join('') });
  await assert.rejects(large.run(), /オブジェクト数/);
});
