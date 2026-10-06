import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
const { searchSlides, createSlideDeck, createSlideElement, importSlidePptx, exportSlidePptx,
  serializeSlideDeck, parseSlideDeck } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const text = (id, value, extra = {}) => createSlideElement({ type: 'text', id, text: value, ...extra });
const shape = (id, value) => createSlideElement({ type: 'shape', id, shape: 'rect', text: value });
const slide = (id, elements = [], extra = {}) => ({ id, name: id, background: '#fff', notes: '', elements, ...extra });
const create = slides => createSlideDeck({ id: 'deck', title: 'Customer Meeting', slides });
const query = { keywords: ['customer', 'meeting'] };

test('headless page-level AND finds keywords across independent elements and returns detached positions', () => {
  const input = create([slide('first', [text('customer', 'Customer needs'), shape('meeting', 'Next meeting')]),
    slide('second', [text('single', 'Customer only')]), slide('third', [text('both', 'Customer meeting')])]);
  const before = JSON.stringify(input), found = searchSlides(input, query);
  assert.equal(typeof document, 'undefined');
  assert.ok(!Object.keys(output.metafile.inputs).some(path => /node_modules\/(?:react|react-dom)\//.test(path)));
  assert.deepEqual(found, { matches: [
    { slideId: 'first', pageNumber: 1, elementId: 'customer', owner: 'slide', ownerId: 'first', source: 'text', text: 'Customer needs', matches: [{ keyword: 'customer', from: 0, to: 8 }] },
    { slideId: 'first', pageNumber: 1, elementId: 'meeting', owner: 'slide', ownerId: 'first', source: 'text', text: 'Next meeting', matches: [{ keyword: 'meeting', from: 5, to: 12 }] },
    { slideId: 'third', pageNumber: 3, elementId: 'both', owner: 'slide', ownerId: 'third', source: 'text', text: 'Customer meeting', matches: [{ keyword: 'customer', from: 0, to: 8 }, { keyword: 'meeting', from: 9, to: 16 }] },
  ], truncated: false });
  found.matches[0].text = 'changed'; found.matches[0].matches[0].keyword = 'changed';
  assert.equal(JSON.stringify(input), before);
  assert.equal(searchSlides(input, query).matches[0].matches[0].keyword, 'customer');
});

test('element-level AND, OR and case-sensitive literal matching stay distinct', () => {
  const input = create([slide('first', [text('a', 'Customer'), shape('b', 'meeting'), text('c', 'customer meeting')])]);
  assert.deepEqual(searchSlides(input, query, { matchBy: 'element' }).matches.map(hit => hit.elementId), ['c']);
  assert.deepEqual(searchSlides(input, { ...query, operator: 'or' }).matches.map(hit => hit.elementId), ['a', 'b', 'c']);
  assert.deepEqual(searchSlides(input, { ...query, matchCase: true }).matches.map(hit => hit.elementId), ['b', 'c']);
  assert.equal(searchSlides(input, { keywords: ['Customer.*meeting'] }).matches.length, 0);
  assert.equal(searchSlides(input, { keywords: ['Customermeeting'] }).matches.length, 0);
  assert.deepEqual(searchSlides(input, { keywords: [] }), { matches: [], truncated: false });
});

test('AND does not cross page boundaries or concatenate adjacent elements', () => {
  const input = create([slide('first', [text('a', 'customer')]), slide('second', [text('b', 'meeting')])]);
  assert.equal(searchSlides(input, query).matches.length, 0);
  const split = create([slide('first', [text('a', 'cus'), text('b', 'tomer')])]);
  assert.equal(searchSlides(split, { keywords: ['customer'] }).matches.length, 0);
});

test('page names, element names, notes and image alternatives are opt-in and deck titles are excluded', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
  const input = create([slide('first', [text('a', 'agenda', { name: 'Customer' }),
    createSlideElement({ type: 'image', id: 'image', name: 'Portrait', src: png, alt: 'Customer meeting' })],
  { name: 'Customer meeting', notes: 'Customer meeting notes' })]);
  assert.equal(searchSlides(input, query).matches.length, 0);
  assert.deepEqual(searchSlides(input, query, { includeNotes: true }).matches.map(hit => hit.source), ['notes']);
  assert.deepEqual(searchSlides(input, query, { includeImageAlt: true }).matches.map(hit => hit.source), ['alt']);
  const names = searchSlides(input, query, { includeNames: true });
  assert.deepEqual(names.matches.map(hit => [hit.source, hit.elementId]), [['name', undefined], ['name', 'a']]);
  assert.deepEqual(searchSlides(input, { keywords: ['customer', 'agenda'] }, { includeNames: true, matchBy: 'element' }).matches.map(hit => hit.source), ['text', 'name']);
  assert.equal(searchSlides(create([slide('empty')]), query, { includeNames: true }).matches.length, 0);
});

test('inherited artwork is searched once on each applied page and distinguishes its owner', () => {
  const input = createSlideDeck({
    masters: [{ id: 'master', name: 'Master', background: '#fff', elements: [text('master-text', 'Customer')] },
      { id: 'unused-master', name: 'Unused', background: '#fff', elements: [text('unused', 'Customer meeting unused')] }],
    layouts: [{ id: 'layout', masterId: 'master', name: 'Layout', elements: [shape('layout-text', 'meeting')],
      placeholders: [{ id: 'slot', kind: 'body', element: text('prototype', 'Customer meeting prototype') }] },
      { id: 'hidden-layout', masterId: 'master', name: 'Hidden', showMasterShapes: false, elements: [], placeholders: [] }],
    slides: [slide('first', [text('local', 'Customer follow-up')], { layoutId: 'layout' }),
      slide('second', [], { layoutId: 'layout', showMasterShapes: false }),
      slide('third', [], { layoutId: 'hidden-layout' }), slide('fourth')],
  });
  assert.deepEqual(searchSlides(input, query).matches.map(hit => [hit.pageNumber, hit.elementId, hit.owner, hit.ownerId]), [
    [1, 'master-text', 'master', 'master'], [1, 'layout-text', 'layout', 'layout'], [1, 'local', 'slide', 'first'],
  ]);
  assert.deepEqual(searchSlides(input, { keywords: ['meeting'] }).matches.map(hit => [hit.pageNumber, hit.elementId]), [[1, 'layout-text'], [2, 'layout-text']]);
});

test('UTF-16 offsets preserve original text and cover every occurrence', () => {
  const input = create([slide('page', [text('a', '😀顧客との会議、顧客会議')])]);
  const found = searchSlides(input, { keywords: ['顧客', '会議'] }).matches[0];
  assert.deepEqual(found.matches.map(match => [match.from, match.to, found.text.slice(match.from, match.to)]), [
    [2, 4, '顧客'], [6, 8, '会議'], [9, 11, '顧客'], [11, 13, '会議'],
  ]);
});

test('limits report omitted fields, never accidentally change the page-level AND predicate', () => {
  const input = create([slide('first', [text('a', 'customer'), text('b', 'meeting')])]);
  const limited = searchSlides(input, query, { limit: 1 });
  assert.equal(limited.matches.length, 1); assert.equal(limited.truncated, true);
  assert.equal(searchSlides(input, query, { limit: 2 }).truncated, false);
  assert.equal(searchSlides(input, { keywords: ['customer', 'absent'] }, { limit: 1 }).truncated, false);
});

test('invalid options and model data fail before returning partial results', () => {
  const input = create([slide('page', [text('a', 'customer meeting')])]);
  for (const options of [null, [], { matchBy: 'deck' }, { includeNotes: 1 }, { includeNames: 'true' },
    { includeImageAlt: null }, { limit: 0 }, { limit: 1.5 }, { limit: 10_001 }, { limit: Infinity }, { unknown: true }])
    assert.throws(() => searchSlides(input, query, options));
  for (const invalid of [null, { keywords: [''] }, { keywords: ['customer'], operator: 'xor' }, { keywords: 'customer' }])
    assert.throws(() => searchSlides(input, invalid));
  assert.throws(() => searchSlides({ ...input, slides: [{ ...input.slides[0], id: '' }] }, query));
});

test('excessive occurrence lists fail explicitly instead of allocating an unbounded response', () => {
  const repeated = 'a'.repeat(10_000);
  const input = create([slide('page', Array.from({ length: 11 }, (_, index) => text(`a${index}`, repeated)))]);
  assert.equal(searchSlides(input, { keywords: ['a'] }, { limit: 10 }).truncated, true);
  assert.throws(() => searchSlides(input, { keywords: ['a'] }), /100,000/);
  const one = create([slide('page', [text('a', `${repeated}a`)])]);
  assert.throws(() => searchSlides(one, { keywords: ['a'] }));
});

test('matching positions work after native and PPTX import without rendering', async () => {
  const input = create([slide('first'), slide('second', [text('a', 'Customer meeting')])]);
  const native = parseSlideDeck(serializeSlideDeck(input));
  assert.equal(searchSlides(native, query).matches[0].pageNumber, 2);
  const imported = await importSlidePptx(await exportSlidePptx(input));
  const hit = searchSlides(imported.deck, query).matches[0];
  assert.equal(hit.pageNumber, 2);
  assert.equal(hit.slideId, imported.deck.slides[1].id);
  assert.equal(hit.elementId, imported.deck.slides[1].elements[0].id);
});
