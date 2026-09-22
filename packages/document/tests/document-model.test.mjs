import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const output = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['src/model/index.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { createDocument, normalizeDocument, serializeDocument, parseDocument, executeDocumentCommands: execute, getDocumentText, getBlocks, getBlock, getImages, getImage, inspectDocumentImage, documentSchema } = api;
const paragraph = (text, id = undefined) => ({ type: 'paragraph', attrs: { id }, ...(text ? { content: [{ type: 'text', text }] } : {}) });
const book = () => createDocument({ id: 'doc', title: 'Report', content: { type: 'doc', content: [paragraph('Alpha beta', 'p1'), paragraph('Second', 'p2')] } });
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';

test('factory produces a usable document with stable IDs and immutable, detached data', () => {
  const original = book();
  assert.equal(original.format, 'likex.document'); assert.equal(original.version, 1);
  assert.equal(createDocument().content.content[0].type, 'paragraph');
  const input = structuredClone(original), normalized = normalizeDocument(input);
  input.content.content[0].content[0].text = 'mutated';
  assert.equal(getDocumentText(normalized), 'Alpha beta\nSecond');
  assert.equal(normalizeDocument(normalized), normalized);
  assert.ok(Object.isFrozen(normalized) && Object.isFrozen(normalized.content.content));
  assert.throws(() => { normalized.title = 'oops'; }, TypeError);
  const json = serializeDocument(original);
  assert.equal(serializeDocument(parseDocument(json)), json);
  assert.equal(serializeDocument(original), json);
  assert.equal(parseDocument(json).content.content[0].attrs.id, 'p1');
});

test('model entry works without document/window and whitespace-only runs remain valid', () => {
  assert.equal(typeof globalThis.document, 'undefined'); assert.equal(typeof globalThis.window, 'undefined');
  const document = createDocument({ content: { type: 'doc', content: [paragraph(' \t ')] } });
  assert.equal(getDocumentText(document), ' \t ');
});

test('text edits, formatting, heading and alignment use numeric positions and preserve IDs', () => {
  const original = book();
  const result = execute(original, [
    { type: 'text.insert', from: 6, text: ' new' },
    { type: 'mark.set', from: 1, to: 6, mark: 'strong' },
    { type: 'mark.set', from: 1, to: 6, mark: 'text_style', attrs: { fontSize: 18, color: '#f00' } },
    { type: 'mark.set', from: 1, to: 6, mark: 'text_style', attrs: { color: '#00f' } },
    { type: 'paragraph.set', from: 1, to: 6, nodeType: 'heading', level: 2, align: 'center' },
  ]);
  assert.equal(getDocumentText(original), 'Alpha beta\nSecond');
  assert.equal(getDocumentText(result.document), 'Alpha new beta\nSecond');
  const first = result.document.content.content[0];
  assert.equal(first.type, 'heading'); assert.equal(first.attrs.id, 'p1');
  assert.equal(first.attrs.level, 2); assert.equal(first.attrs.align, 'center');
  const style = first.content[0].marks.find(mark => mark.type === 'text_style');
  assert.equal(style.attrs.fontSize, 18); assert.equal(style.attrs.color, '#0000ff');
  assert.deepEqual(result.selection, { from: 1, to: 6 });
  const removed = execute(result.document, { type: 'text.delete', from: 6, to: 10 }).document;
  assert.equal(getDocumentText(removed), 'Alpha beta\nSecond');
});

test('list operations wrap paragraphs, switch numbering and unwrap without losing text', () => {
  const original = book(), wrapped = execute(original, { type: 'list.set', from: 1, to: 19, kind: 'bullet' }).document;
  assert.equal(wrapped.content.content[0].type, 'bullet_list');
  assert.equal(wrapped.content.content[0].content.length, 2);
  const ordered = execute(wrapped, { type: 'list.set', from: 3, to: 6, kind: 'ordered' }).document;
  assert.equal(ordered.content.content[0].type, 'ordered_list');
  const unwrapped = execute(ordered, { type: 'list.set', from: 3, to: documentSchema.nodeFromJSON(ordered.content).content.size - 3, kind: 'none' }).document;
  assert.equal(unwrapped.content.content[0].type, 'paragraph');
  assert.equal(getDocumentText(unwrapped), getDocumentText(original));
});

test('tables are inserted at the requested position and cell text uses the same text API', () => {
  const inserted = execute(book(), { type: 'table.insert', at: 12, rows: 2, columns: 3, header: true }).document;
  const table = getBlocks(inserted).find(block => block.node.type === 'table');
  assert.equal(table.node.content.length, 2); assert.equal(table.node.content[0].content.length, 3);
  assert.equal(table.node.content[0].content[0].type, 'table_header');
  const cellParagraph = getBlocks(inserted).find(block => block.node.type === 'paragraph' && block.from > table.from && block.to < table.to);
  const filled = execute(inserted, { type: 'text.insert', from: cellParagraph.contentFrom, text: 'Revenue' }).document;
  assert.match(getDocumentText(filled), /Revenue/);
  assert.equal(getBlock(filled, table.id).node.type, 'table');
});

test('images preserve aspect ratio, support alt, query by ID, update and delete', () => {
  assert.deepEqual(inspectDocumentImage(pixel), { src: pixel, bytes: 68, width: 1, height: 1 });
  const original = execute(book(), { type: 'image.insert', at: 12, src: pixel, width: 240, alt: 'Chart' }).document;
  const image = getImages(original)[0];
  assert.equal(image.node.attrs.height, 240); assert.equal(image.node.attrs.alt, 'Chart');
  const next = execute(original, { type: 'image.update', id: image.id, width: 120 }).document;
  assert.equal(getImage(next, image.id).node.attrs.height, 120);
  assert.equal(getImage(next, image.id).node.attrs.width, 120);
  assert.equal(getImages(execute(next, { type: 'block.delete', id: image.id }).document).length, 0);
});

test('page breaks and document metadata have headless commands', () => {
  const result = execute(book(), [ { type: 'pageBreak.insert', at: 12 }, { type: 'document.update', title: 'New', page: { margins: { left: 25 } } } ]).document;
  assert.ok(result.content.content.some(node => node.type === 'page_break'));
  assert.equal(result.title, 'New'); assert.equal(result.page.margins.left, 25); assert.equal(result.page.margins.top, 20);
});

test('GUI transaction steps use the same immutable command path and normalize copied IDs', () => {
  const document = book();
  const result = execute(document, { type: 'transaction.apply', steps: [{ stepType: 'replace', from: 1, to: 1, slice: { content: [{ type: 'text', text: 'Hello ' }] } }], selection: { from: 7, to: 7 } });
  assert.equal(getDocumentText(result.document), 'Hello Alpha beta\nSecond');
  assert.deepEqual(result.selection, { from: 7, to: 7 });
  const copied = createDocument({ content: { type: 'doc', content: [paragraph('A', 'same'), paragraph('B', 'same')] } });
  assert.equal(copied.content.content[0].attrs.id, 'same');
  assert.notEqual(copied.content.content[1].attrs.id, 'same');
});

test('a failed batch is atomic, including a failed GUI step', () => {
  const original = book(), saved = serializeDocument(original);
  assert.throws(() => execute(original, [{ type: 'text.insert', from: 1, text: 'Changed' }, { type: 'text.delete', from: 0, to: 9999 }]), /position/i);
  assert.equal(serializeDocument(original), saved);
  assert.throws(() => execute(original, { type: 'transaction.apply', steps: [{ stepType: 'replace', from: 1, to: 1, slice: { content: [{ type: 'text', text: 'X' }] } }, { stepType: 'not-a-step' }] }));
  assert.equal(serializeDocument(original), saved);
});

test('invalid structure, untrusted links, attributes and invalid page settings are rejected', () => {
  const original = book();
  assert.throws(() => createDocument({ content: { type: 'doc', content: [{ type: 'script' }] } }));
  assert.throws(() => normalizeDocument({ ...original, version: 2 }));
  assert.throws(() => createDocument({ page: { margins: { left: 200 } } }));
  assert.throws(() => execute(original, { type: 'mark.set', from: 1, to: 4, mark: 'link', attrs: { href: 'javascript:alert(1)' } }));
  assert.throws(() => execute(original, { type: 'mark.set', from: 1, to: 4, mark: 'text_style', attrs: { color: 'red;display:none' } }));
  assert.throws(() => execute(original, { type: 'image.insert', at: 1, src: 'https://example.test/a.png' }));
  assert.throws(() => execute(original, { type: 'image.insert', at: 1, src: 'data:image/png;base64,YWJjZA==' }));
  assert.throws(() => createDocument({ content: { type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'alert(1)' } }] } }));
  assert.throws(() => execute(original, { type: 'document.update', title: null }));
});

test('table dimensions must be rectangular and merged rows can be fully spanned', () => {
  const row = cells => ({ type: 'table_row', content: cells });
  const cell = (attrs = {}) => ({ type: 'table_cell', attrs, content: [paragraph('')] });
  const content = rows => ({ type: 'doc', content: [{ type: 'table', content: rows }] });
  assert.throws(() => createDocument({ content: content([row([cell(), cell()]), row([cell()])]) }), /width/);
  const merged = createDocument({ content: content([row([cell({ rowspan: 2, colspan: 2 })]), row([])]) });
  assert.equal(merged.content.content[0].content.length, 2);
  assert.throws(() => createDocument({ content: content([row([])]) }), /column/);
});

test('queries return detached snapshots and unknown IDs return undefined', () => {
  const document = book(), block = getBlock(document, 'p1');
  assert.deepEqual({ from: block.from, to: block.to, contentFrom: block.contentFrom, contentTo: block.contentTo }, { from: 0, to: 12, contentFrom: 1, contentTo: 11 });
  block.node.content[0].text = 'External';
  assert.equal(getDocumentText(document), 'Alpha beta\nSecond');
  assert.equal(getBlock(document, 'missing'), undefined); assert.equal(getImage(document, 'missing'), undefined);
});

test('block insertion at a leaf boundary does not replace the existing image or page break', () => {
  let document = createDocument({ content: { type: 'doc', content: [{ type: 'image', attrs: { src: pixel } }] } });
  const originalId = getImages(document)[0].id;
  document = execute(document, { type: 'image.insert', at: 0, src: pixel, alt: 'Second' }).document;
  assert.equal(getImages(document).length, 2);
  assert.equal(getImages(document)[1].id, originalId);
  document = execute(document, { type: 'pageBreak.insert', at: 0 }).document;
  assert.equal(document.content.content[0].type, 'page_break');
  assert.equal(getImages(document).length, 2);
});

test('normalized public models contain only ordinary JSON objects for Next.js server-to-client props', () => {
  const document = execute(book(), { type: 'mark.set', from: 1, to: 5, mark: 'text_style', attrs: { color: '#123456' } }).document;
  function plain(value) {
    if (value && typeof value === 'object') {
      assert.equal(Object.getPrototypeOf(value), Array.isArray(value) ? Array.prototype : Object.prototype);
      Object.values(value).forEach(plain);
    }
  }
  plain(document);
});

test('HTML image parsing preserves natural aspect ratio and table width attributes reach DOM styles', () => {
  const parseImage = documentSchema.nodes.image.spec.parseDOM[0].getAttrs;
  const attrs = values => ({ getAttribute: name => values[name] ?? null });
  assert.deepEqual(parseImage(attrs({ src: pixel })), { src: pixel, alt: '', width: 1, height: 1 });
  assert.deepEqual(parseImage(attrs({ src: pixel, width: '240' })), { src: pixel, alt: '', width: 240, height: 240 });
  assert.equal(parseImage(attrs({ src: 'https://example.test/tracker.png' })), false);
  const cell = documentSchema.nodes.table_cell.create({ colwidth: [90, 110], colspan: 2, backgroundColor: '#ffffff' }, documentSchema.nodes.paragraph.create());
  const dom = documentSchema.nodes.table_cell.spec.toDOM(cell);
  assert.match(dom[1].style, /width:200px/); assert.match(dom[1].style, /background-color:#ffffff/);
});
