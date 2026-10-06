import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export {createDocument, getDocumentPage} from './src/model';export {documentSchema} from './src/model/schema';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createDocument, getDocumentPage, documentSchema } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const model = content => createDocument({ content: { type: 'doc', content } });

test('explicit page positions agree with ProseMirror, including nested breaks and UTF-16 text', () => {
  const document = model([paragraph('😀Start'), { type: 'ordered_list', content: [
    { type: 'list_item', content: [paragraph('Before'), { type: 'page_break' }, paragraph('After')] },
    { type: 'list_item', content: [paragraph('Next')] },
  ] }, { type: 'table', content: [{ type: 'table_row', content: [
    { type: 'table_cell', content: [paragraph('A'), { type: 'page_break' }, paragraph('B')] },
    { type: 'table_cell', content: [paragraph('C')] },
  ] }] }, { type: 'page_break' }]);
  const before = JSON.stringify(document), pm = documentSchema.nodeFromJSON(document.content), breaks = [];
  pm.descendants((node, position) => { if (node.type.name === 'page_break') breaks.push(position); });
  let start = 0;
  [...breaks, pm.content.size].forEach((end, index) => {
    const page = getDocumentPage(document, index + 1);
    assert.deepEqual(page, { pageNumber: index + 1, from: start, to: end });
    assert.ok(Object.isFrozen(page)); assert.equal(getDocumentPage(document, index + 1), page);
    start = end + 1;
  });
  assert.equal(getDocumentPage(document, 5), undefined); assert.equal(JSON.stringify(document), before);
});

test('empty and consecutive-break pages are addressable; bad page numbers fail validation', () => {
  const document = model([{ type: 'page_break' }, { type: 'page_break' }]);
  assert.deepEqual([1, 2, 3].map(page => getDocumentPage(document, page)), [
    { pageNumber: 1, from: 0, to: 0 }, { pageNumber: 2, from: 1, to: 1 }, { pageNumber: 3, from: 2, to: 2 },
  ]);
  assert.equal(getDocumentPage(document), getDocumentPage(document, 1));
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) assert.throws(() => getDocumentPage(document, value));
  assert.equal(getDocumentPage(document, Number.MAX_SAFE_INTEGER), undefined);
});
