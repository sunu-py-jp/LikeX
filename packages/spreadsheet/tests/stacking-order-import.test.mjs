import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './model-entry';
  export { openOfficePackage, createZipArchive } from './core';`,
  resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=';
const drawingPath = 'xl/drawings/drawing1.xml';
const common = (id, column) => ({ id, anchor: { row: column, column, offsetX: 0, offsetY: 0 }, width: 120, height: 80 });
const source = () => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Layers', cells: {}, rowCount: 20, columnCount: 10, drawings: [
  { ...common('shape', 1), type: 'shape', shape: 'rectangle', fill: '#00ff00', stroke: '#000000', strokeWidth: 1 },
  { ...common('text', 2), type: 'text', text: 'Text', fontSize: 16, color: '#000000', background: '#ffffff' },
  { ...common('image', 3), type: 'image', resourceId: 'pixel', alt: 'Image' },
  { ...common('line', 4), type: 'shape', shape: 'line', line: { start: { anchor: common('start', 4).anchor },
    end: { anchor: { row: 4, column: 5, offsetX: 56, offsetY: 0 } } }, fill: 'transparent', stroke: '#000000', strokeWidth: 2 },
] }], resources: { images: { pixel: { name: 'Pixel', mimeType: 'image/png', width: 1, height: 1, dataUrl: png } } } });
const kinds = workbook => workbook.sheets[0].drawings.map(drawing => drawing.type === 'shape' ? drawing.shape : drawing.type);

async function modifyDrawings(blob, transform) {
  const archive = await m.openOfficePackage(blob), entries = [];
  for (const path of archive.paths) {
    let bytes = await archive.read(path);
    if (path === drawingPath) bytes = new TextEncoder().encode(transform(new TextDecoder().decode(bytes)));
    entries.push({ path, content: new Blob([bytes]) });
  }
  return m.createZipArchive(entries);
}

test('XLSX XML order wins over object IDs and positions for mixed drawing kinds through SPON and XLSX round trips', async () => {
  const file = await modifyDrawings(await m.exportSpreadsheetXlsx(source()), xml => {
    const anchors = [...xml.matchAll(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g)].map(match => match[0]).reverse();
    assert.equal(anchors.length, 4);
    assert.deepEqual(anchors.map(anchor => Number(anchor.match(/<xdr:cNvPr id="(\d+)"/)[1])), [4, 3, 2, 1]);
    let index = 0;
    return xml.replace(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g, () => anchors[index++]);
  });
  const expected = ['line', 'image', 'text', 'rectangle'];
  const imported = await m.importSpreadsheetXlsx(file);
  assert.deepEqual(kinds(imported.workbook), expected);
  const restored = m.parseWorkbook(m.serializeWorkbook(imported.workbook));
  assert.deepEqual(kinds(restored), expected);
  const reimported = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(restored));
  assert.deepEqual(kinds(reimported.workbook), expected);
});

test('hidden XLSX objects never become visible foreground layers; false visibility values retain each kind', async () => {
  for (const hidden of ['1', 'true', '0', 'false']) {
    const file = await modifyDrawings(await m.exportSpreadsheetXlsx(source()), xml => xml.replace(/<xdr:cNvPr /g, `<xdr:cNvPr hidden="${hidden}" `));
    const { workbook, warnings } = await m.importSpreadsheetXlsx(file);
    if (hidden === '1' || hidden === 'true') {
      assert.equal(workbook.sheets[0].drawings?.length ?? 0, 0);
      assert.ok(warnings.some(warning => warning.message.includes('非表示')));
    } else {
      assert.deepEqual(kinds(workbook), ['rectangle', 'text', 'image', 'line']);
      assert.equal(warnings.some(warning => warning.message.includes('非表示')), false);
    }
  }
});
