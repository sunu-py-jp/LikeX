import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: `export * from './model-entry'; export { prepareWorksheetDrawings } from './export/xlsx/drawings'; export { readWorksheetDrawings } from './import/drawings'; export { parseXml } from './import/xml';`, resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const bytes = s => new TextEncoder().encode(s), path = 'xl/drawings/drawing1.xml';
const target = { id: 'target', type: 'shape', shape: 'rectangle', anchor: { row: 4, column: 3, offsetX: 5, offsetY: 7 }, width: 180, height: 100, strokeWidth: 2, fill: '#FFFFFF', stroke: '#112233', text: '接続先', rotation: 30, flipX: true };
const book = shape => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Sheet', rowCount: 30, columnCount: 20, cells: {}, drawings: [{ ...target, shape }] }] });
function add(book, start, end, extra = {}) {
  const r = m.applySpreadsheetCommands(book, [{ type: 'lines.insert', sheetId: 's', start, end, ...extra }]); assert.equal(r.ok, true, r.message); return r.workbook;
}
async function imported(xml, initial, extraFiles = {}) {
  const warnings = [], files = new Map(Object.entries({ [path]: bytes(xml), ...extraFiles }));
  const context = { archive: { paths: [...files.keys()], has: name => files.has(name), read: async name => { assert.ok(files.has(name), name); return files.get(name); } }, resources: {}, warnings, warn: warning => warnings.push(warning) };
  const sheet = await m.readWorksheetDrawings(m.parseXml(bytes('<worksheet><sheetFormatPr defaultRowHeight="21" defaultColWidth="14.28515625"/><drawing r:id="draw"/></worksheet>')), initial,
    new Map([['draw', { id: 'draw', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', target: path, external: false }]]), context);
  return { sheet, warnings, resources: context.resources };
}
async function roundtrip(b) {
  const output = await m.prepareWorksheetDrawings(b.sheets[0], b.resources, { sheetIndex: 1 }), xml = await output.parts.find(part => part.path === path).content.text();
  const files = Object.fromEntries(await Promise.all(output.parts.filter(part => part.path !== path).map(async part => [part.path, new Uint8Array(await part.content.arrayBuffer())])));
  return { ...await imported(xml, { ...b.sheets[0], drawings: undefined }, files), xml };
}
const equalPoint = (a, b) => { assert.ok(Math.abs(a.x - b.x) < .001, `${a.x} vs ${b.x}`); assert.ok(Math.abs(a.y - b.y) < .001, `${a.y} vs ${b.y}`); };

test('standard cxnSp roundtrips horizontal, vertical, reversed and zero-length lines and all arrowheads', async () => {
  for (const [x1, y1, x2, y2] of [[50, 60, 350, 60], [80, 300, 80, 50], [300, 200, 50, 30], [10, 10, 10, 10]]) for (const arrow of ['none', 'triangle', 'openArrow', 'diamond', 'oval', 'stealth']) {
    const b = add(book('rectangle'), { x: x1, y: y1 }, { x: x2, y: y2 }, { startArrow: arrow, endArrow: arrow });
    const result = await roundtrip(b), line = result.sheet.drawings.at(-1), points = m.getSpreadsheetLinePoints(result.sheet, line.id);
    assert.match(result.xml, /<xdr:cxnSp>/); assert.equal(line.startArrow, arrow); assert.equal(line.endArrow, arrow);
    equalPoint(points.start, { x: x1, y: y1 }); equalPoint(points.end, { x: x2, y: y2 });
    assert.equal(result.warnings.length, 0);
  }
});

test('custom eight-port geometry preserves native target kinds, text, rotation, flips and bindings', async () => {
  for (const shape of ['rectangle', 'roundedRectangle', 'ellipse', 'triangle', 'diamond', 'rightArrow', 'leftArrow']) {
    const b = add(book(shape), { x: 30, y: 30 }, { x: 0, y: 0, binding: { targetId: 'target', port: 'topRight' } });
    const result = await roundtrip(b), box = result.sheet.drawings[0], line = result.sheet.drawings[1];
    assert.match(result.xml, /<a:custGeom>/); assert.match(result.xml, /<a:endCxn id="1" idx="1"/);
    assert.equal((result.xml.match(/<a:cxn ang=/g) ?? []).length, 8);
    assert.equal(box.shape, shape); assert.equal(box.text, target.text); assert.equal(box.rotation, 30); assert.equal(box.flipX, true);
    assert.equal(box.width, target.width); assert.equal(box.height, target.height); assert.deepEqual(box.anchor, target.anchor);
    assert.deepEqual(line.line.end.binding, { targetId: box.id, port: 'topRight' });
    equalPoint(m.getSpreadsheetLinePoints(result.sheet, line.id).end, m.getSpreadsheetLinePoints(b.sheets[0], b.sheets[0].drawings[1].id).end);
    assert.equal(result.warnings.length, 0, JSON.stringify(result.warnings));
    assert.doesNotThrow(() => m.normalizeWorkbook({ sheets: [result.sheet] }));
  }
});

test('imports standard preset connection indices and detaches unsupported target sites with warnings', async () => {
  const b = add(book('rectangle'), { x: 20, y: 30 }, { x: 0, y: 0, binding: { targetId: 'target', port: 'left' } });
  const output = await roundtrip(b);
  const native = output.xml.replace(/<a:custGeom>[\s\S]*?<\/a:custGeom>/, '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>').replace('idx="6"', 'idx="1"');
  const initial = { ...b.sheets[0], drawings: undefined };
  const good = await imported(native, initial);
  assert.equal(good.sheet.drawings[1].line.end.binding.port, 'left');
  for (const broken of [native.replace('idx="1"', 'idx="99"'), native.replace('<a:endCxn id="1"', '<a:endCxn id="2"'), native.replace('<a:endCxn id="1"', '<a:endCxn id="999"')]) {
    const bad = await imported(broken, initial);
    assert.equal(bad.sheet.drawings[1].line.end.binding, undefined);
    assert.ok(bad.warnings.some(w => w.message.includes('接続を解除')));
  }
});

test('curve connectors warn on straightening and unsupported markers warn rather than disappear', async () => {
  const b = add(book('rectangle'), { x: 20, y: 30 }, { x: 70, y: 90 }, { startArrow: 'triangle' });
  const out = await roundtrip(b), native = out.xml.replace('prst="line"', 'prst="curvedConnector3"').replace('headEnd type="triangle"', 'headEnd type="unknown"');
  const result = await imported(native, { ...b.sheets[0], drawings: undefined });
  assert.equal(result.sheet.drawings[1].startArrow, 'triangle');
  assert.ok(result.warnings.some(w => w.message.includes('直線へ変更')));
  assert.ok(result.warnings.some(w => w.message.includes('三角')));
});

test('connector labels export as valid independent native text boxes with an explicit warning', async () => {
  let b = add(book('rectangle'), { x: 20, y: 30 }, { x: 350, y: 90 });
  b = m.updateDrawing(b, 's', b.sheets[0].drawings[1].id, { text: '接続ラベル', bold: true, color: '#123456' });
  const warnings = [], output = await m.prepareWorksheetDrawings(b.sheets[0], undefined, { sheetIndex: 1, onWarning: warning => warnings.push(warning) });
  const xml = await output.parts.find(part => part.path === path).content.text(), connector = xml.match(/<xdr:cxnSp>[\s\S]*?<\/xdr:cxnSp>/)[0];
  assert.doesNotMatch(connector, /txBody/); assert.equal(warnings.length, 1); assert.equal(warnings[0].drawingId, b.sheets[0].drawings[1].id);
  const result = await imported(xml, { ...b.sheets[0], drawings: undefined });
  const text = result.sheet.drawings.find(drawing => drawing.type === 'text');
  assert.equal(text.text, '接続ラベル'); assert.equal(text.bold, true); assert.equal(text.color, '#123456');
});

test('three duplicate Office target IDs never reconnect to the last duplicate', async () => {
  const b = add(book('rectangle'), { x: 20, y: 30 }, { x: 0, y: 0, binding: { targetId: 'target', port: 'left' } });
  const out = await roundtrip(b), targetXml = out.xml.match(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/)[0];
  const xml = out.xml.replace(targetXml, targetXml.repeat(3));
  const result = await imported(xml, { ...b.sheets[0], drawings: undefined });
  assert.equal(result.sheet.drawings.at(-1).line.end.binding, undefined);
  assert.ok(result.warnings.some(warning => warning.message.includes('接続を解除')));
});

test('image and text box targets retain frame geometry and standard connection references', async () => {
  const resource = { name: 'pixel.png', mimeType: 'image/png', width: 1, height: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=' };
  for (const type of ['image', 'text']) {
    let b = book('rectangle');
    const common = { id: 'target', type, anchor: target.anchor, width: target.width, height: target.height, rotation: 45, flipY: true };
    b = m.normalizeWorkbook({ ...b, sheets: [{ ...b.sheets[0], drawings: [{ ...common, ...(type === 'image' ? { resourceId: 'pixel', alt: 'image target' } : { text: 'textbox target', background: 'transparent', fontSize: 16, color: '#112233' }) }] }], resources: type === 'image' ? { images: { pixel: resource } } : undefined });
    b = add(b, { x: 30, y: 40 }, { x: 0, y: 0, binding: { targetId: 'target', port: 'bottomLeft' } });
    const result = await roundtrip(b), box = result.sheet.drawings[0], line = result.sheet.drawings[1];
    assert.equal(box.type, type); assert.equal(box.width, target.width); assert.equal(box.height, target.height); assert.equal(box.rotation, 45); assert.equal(box.flipY, true);
    assert.deepEqual(box.anchor, target.anchor); assert.equal(line.line.end.binding.targetId, box.id);
    equalPoint(m.getSpreadsheetLinePoints(result.sheet, line.id).end, m.getSpreadsheetLinePoints(b.sheets[0], b.sheets[0].drawings[1].id).end);
    assert.equal(result.warnings.length, 0, JSON.stringify(result.warnings));
  }
});
