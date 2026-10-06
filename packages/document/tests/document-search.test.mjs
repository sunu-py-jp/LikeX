import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export {searchDocument, createDocument, getDocumentPage, documentSchema, serializeDocument} from './src/model-entry';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
const { searchDocument, createDocument, getDocumentPage, documentSchema, serializeDocument } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=document-search-test.js').toString('base64')}`);
const text = value => ({ type: 'text', text: value });
const paragraph = value => ({ type: 'paragraph', content: [text(value)] });
const model = content => createDocument({ content: { type: 'doc', content } });
const query = (keywords, operator = 'and') => ({ keywords, operator });

test('headless search is public without React, a DOM or a rendering dependency', () => {
  assert.equal(typeof window, 'undefined'); assert.equal(typeof document, 'undefined');
  for (const path of Object.keys(output.metafile.inputs)) assert.doesNotMatch(path, /react|prosemirror-view|document-surface|document-thumbnail/);
  assert.equal(searchDocument(model([paragraph('server keyword')]), query(['keyword'])).matches.length, 1);
});

test('default AND searches complete explicit pages, while block AND keeps terms within one block', () => {
  const document = model([
    { type: 'heading', content: [text('Al'), { ...text('pha'), marks: [{ type: 'strong' }] }] },
    { type: 'table', content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [paragraph('beta')] }] }] },
    { type: 'page_break' }, paragraph('alpha beta'), { type: 'page_break' }, paragraph('alpha alone'),
  ]);
  const page = searchDocument(document, query(['alpha', 'beta']));
  assert.deepEqual(page.matches.map(hit => [hit.pageNumber, hit.text]), [[1, 'Alpha'], [1, 'beta'], [2, 'alpha beta']]);
  assert.equal(page.truncated, false);
  const block = searchDocument(document, query(['alpha', 'beta']), { matchBy: 'block' });
  assert.deepEqual(block.matches.map(hit => [hit.pageNumber, hit.text]), [[2, 'alpha beta']]);
  assert.equal(searchDocument(document, query(['alpha', 'beta'], 'or')).matches.length, 4);
  assert.equal(searchDocument(document, { keywords: ['ALPHA'], matchCase: true }).matches.length, 0);
  assert.equal(searchDocument(document, { keywords: ['ALPHA'], matchCase: false }).matches.length, 3);
});

test('keyword phrases never join separate blocks or cross nested explicit page breaks', () => {
  const document = model([{ type: 'bullet_list', content: [{ type: 'list_item', content: [
    paragraph('alpha'), { type: 'page_break' }, paragraph('beta'), paragraph('gamma'),
  ] }] }]);
  assert.deepEqual(searchDocument(document, query(['alpha', 'beta'])), { matches: [], truncated: false });
  assert.deepEqual(searchDocument(document, query(['beta\ngamma'])), { matches: [], truncated: false });
  const result = searchDocument(document, query(['beta', 'gamma']));
  assert.deepEqual(result.matches.map(hit => hit.pageNumber), [2, 2]);
  const page = getDocumentPage(document, 2);
  assert.ok(result.matches.every(hit => hit.from >= page.from && hit.to <= page.to));
});

test('inline results separate exact ProseMirror positions from UTF-16 text offsets across marks and hard breaks', () => {
  const document = model([paragraph('Earlier'), { type: 'page_break' }, { type: 'paragraph', content: [
    text('😀A'), { ...text('lpha'), marks: [{ type: 'em' }] }, { type: 'hard_break' }, text('Beta'),
  ] }]);
  const pm = documentSchema.nodeFromJSON(document.content);
  const hit = searchDocument(document, query(['alpha\nbeta'])).matches[0];
  assert.equal(hit.text, '😀Alpha\nBeta'); assert.equal(hit.pageNumber, 2);
  assert.equal(hit.matches[0].textFrom, 2); assert.equal(hit.matches[0].textTo, hit.text.length);
  assert.equal(hit.matches[0].from, hit.from + 2); assert.equal(hit.matches[0].to, hit.to);
  assert.equal(pm.textBetween(hit.matches[0].from, hit.matches[0].to, '', '\n'), 'Alpha\nBeta');
  assert.equal(pm.nodeAt(hit.from - 1).attrs.id, hit.blockId);
});

test('shape and canvas text keep node selections and separate text-match offsets without OCR', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
  const document = model([
    { type: 'shape', attrs: { preset: 'rect', text: 'Shape alpha' } },
    { type: 'drawing_canvas', attrs: { shapes: [
      { id: 'one', preset: 'rect', text: 'Canvas beta', x: 0, y: 0 },
      { id: 'two', preset: 'rect', text: 'Gamma', x: 100, y: 0 },
    ] } },
    { type: 'image', attrs: { src: png, alt: 'Hidden OCR alpha beta' } },
  ]);
  const pm = documentSchema.nodeFromJSON(document.content), result = searchDocument(document, query(['alpha', 'beta']));
  assert.deepEqual(result.matches.map(hit => hit.kind), ['shape', 'canvas-shape']);
  assert.equal(result.matches[1].canvasShapeId, 'one');
  for (const hit of result.matches) {
    assert.equal(hit.to, hit.from + pm.nodeAt(hit.from).nodeSize);
    for (const match of hit.matches) {
      assert.equal(match.from, hit.from); assert.equal(match.to, hit.to);
      assert.equal(hit.text.slice(match.textFrom, match.textTo), match.keyword);
    }
  }
  assert.deepEqual(searchDocument(document, query(['alpha', 'beta']), { matchBy: 'block' }), { matches: [], truncated: false });
  assert.equal(searchDocument(document, query(['OCR'])).matches.length, 0);
});

test('location limits follow complete page AND evaluation and explicitly report truncation', () => {
  const document = model([paragraph('alpha'), paragraph('other'), paragraph('beta'), { type: 'page_break' }, paragraph('alpha')]);
  const result = searchDocument(document, query(['alpha', 'beta']), { limit: 1 });
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0].text, 'alpha'); assert.equal(result.truncated, true);
  assert.equal(searchDocument(document, query(['alpha', 'beta']), { limit: 2 }).truncated, false);
  assert.deepEqual(searchDocument(document, query(['alpha', 'missing']), { limit: 1 }), { matches: [], truncated: false });
  assert.deepEqual(searchDocument(document, query([])), { matches: [], truncated: false });
});

test('search validates input, rejects resource overruns and leaves source models unchanged', () => {
  const document = model([paragraph('alpha beta')]), before = serializeDocument(document);
  for (const options of [{ limit: 0 }, { limit: 10001 }, { limit: 1.5 }, { limit: NaN }, { matchBy: 'document' }, { unknown: true }, null]) assert.throws(() => searchDocument(document, query(['alpha']), options));
  for (const invalid of [{ keywords: [''] }, { keywords: ['alpha'], operator: 'regex' }, { keywords: [12] }, null]) assert.throws(() => searchDocument(document, invalid));
  assert.throws(() => searchDocument({ ...document, format: 'wrong' }, query([])));
  const result = searchDocument(document, query(['alpha']));
  result.matches[0].text = 'Changed'; result.matches[0].matches[0].from = 900;
  assert.equal(serializeDocument(document), before);
  assert.throws(() => searchDocument(model([paragraph('a'.repeat(10001))]), query(['a'])));
});


test('aggregate position output is bounded independently of the location limit', () => {
  const document = model([...Array.from({ length: 10 }, () => paragraph('a'.repeat(10000))), paragraph('a')]);
  assert.throws(() => searchDocument(document, query(['a'])), /100,000/);
  const limited = searchDocument(document, query(['a']), { limit: 1 });
  assert.equal(limited.matches.length, 1); assert.equal(limited.matches[0].matches.length, 10000); assert.equal(limited.truncated, true);
});
