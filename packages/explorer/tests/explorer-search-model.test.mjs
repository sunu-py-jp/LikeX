import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { resolveExplorerSearchHits, resolveExplorerSearchIds } = await importTypeScript('../src/model-entry.ts');
const { createExplorerSearchResultAccumulator } = await importTypeScript('../src/model/search.ts');
const entries = ['alpha', 'beta', 'folder'].map(id => ({ id, name: id, kind: id === 'folder' ? 'folder' : 'file', parent: 'root' }));

test('public model normalizes mixed search results in relevance order with first occurrence winning', () => {
  const input = Object.freeze([
    { entryId: 'beta', snippet: '<mark>plain text</mark>', reason: '', metadata: { score: 0.9 } },
    'missing', 'alpha', { entryId: 'beta', snippet: 'ignored duplicate' },
    { entryId: 'folder', metadata: {} },
  ]);
  assert.deepEqual(resolveExplorerSearchHits(input, entries), [input[0], { entryId: 'alpha' }, input[4]]);
  assert.deepEqual(resolveExplorerSearchIds(input, entries), ['beta', 'alpha', 'folder']);
  assert.deepEqual(resolveExplorerSearchHits(['alpha', { entryId: 'alpha', snippet: 'later' }], entries), [{ entryId: 'alpha' }]);
  assert.deepEqual(resolveExplorerSearchHits([], entries), []);
  assert.ok(Object.isFrozen(resolveExplorerSearchHits([], entries)));
});

test('normalization clones and recursively freezes metadata without freezing or mutating host entries or hits', () => {
  const metadata = JSON.parse('{"nested":{"tags":["x",null,true,3]},"__proto__":{"untrusted":true}}');
  const source = [{ entryId: 'alpha', snippet: '', metadata, name: 'not an entry mutation' }];
  const before = structuredClone(source), entriesBefore = structuredClone(entries);
  const hits = resolveExplorerSearchHits(source, entries);
  assert.deepEqual(source, before);
  assert.deepEqual(entries, entriesBefore);
  assert.equal(hits[0].name, undefined);
  assert.notEqual(hits[0].metadata, metadata);
  assert.ok(Object.isFrozen(hits));
  assert.ok(Object.isFrozen(hits[0]));
  assert.ok(Object.isFrozen(hits[0].metadata));
  assert.ok(Object.isFrozen(hits[0].metadata.nested));
  assert.ok(Object.isFrozen(hits[0].metadata.nested.tags));
  assert.equal(Object.prototype.untrusted, undefined);
  assert.ok(!Object.isFrozen(source[0]));
  assert.ok(!Object.isFrozen(metadata));
  metadata.nested.tags.push('later');
  assert.deepEqual(hits[0].metadata.nested.tags, ['x', null, true, 3]);
});

test('malformed hits and non-JSON metadata fail atomically', () => {
  const cycle = {}; cycle.self = cycle;
  const metadataGetter = {}; Object.defineProperty(metadataGetter, 'text', { enumerable: true, get() { throw new Error('getter executed'); } });
  const sparse = []; sparse.length = 2;
  for (const result of [null, {}, [null], [1], [{}], [{ entryId: 1 }], [{ entryId: 'alpha', snippet: 5 }],
    [{ entryId: 'alpha', reason: {} }], ...[
      [], null, new Date(), { date: new Date() }, { value: undefined }, { value: () => 1 }, { value: Symbol() },
      { value: 1n }, { value: NaN }, { value: Infinity }, { value: sparse }, { value: new Map() },
      { [Symbol('key')]: 1 }, cycle, metadataGetter,
    ].map(metadata => [{ entryId: 'alpha', metadata }])]) {
    assert.throws(() => resolveExplorerSearchHits(result, entries));
  }
  let read = false;
  const getterHit = { entryId: 'alpha', get snippet() { read = true; return 'text'; } };
  assert.throws(() => resolveExplorerSearchHits(['beta', getterHit], entries), /getter/);
  assert.equal(read, false);
});

test('result count, detail length, metadata size and total response budgets are enforced', () => {
  assert.throws(() => resolveExplorerSearchHits(Array(100_001).fill('alpha'), entries), /100,000/);
  assert.throws(() => resolveExplorerSearchHits([{ entryId: 'alpha', snippet: 'x'.repeat(10_001) }], entries), /10,000/);
  assert.throws(() => resolveExplorerSearchHits([{ entryId: 'alpha', reason: 'x'.repeat(10_001) }], entries), /10,000/);
  assert.equal(resolveExplorerSearchHits([{ entryId: 'alpha', snippet: 'x'.repeat(10_000), reason: '' }], entries)[0].snippet.length, 10_000);
  assert.throws(() => resolveExplorerSearchHits([{ entryId: 'alpha', metadata: { text: 'x'.repeat(100_000) } }], entries));
  const hits = Array.from({ length: 60 }, (_, i) => ({ entryId: i ? 'missing' : 'alpha', metadata: { text: 'x'.repeat(90_000) } }));
  assert.throws(() => resolveExplorerSearchHits(hits, entries), /maxLength|5,000,000/);
  assert.equal(hits[0].metadata.text.length, 90_000);
});

test('successive batches append unique hits and preserve immutable prior snapshots', () => {
  const collector = createExplorerSearchResultAccumulator(entries);
  const first = collector.append([{ entryId: 'beta', snippet: 'first', metadata: { batch: 1 } }]);
  const second = collector.append(['missing', { entryId: 'beta', snippet: 'replacement' }, 'alpha']);
  assert.deepEqual(second, [{ entryId: 'beta', snippet: 'first', metadata: { batch: 1 } }, { entryId: 'alpha' }]);
  assert.equal(first.length, 1);
  assert.equal(second[0], first[0]);
  assert.ok(Object.isFrozen(second));
  assert.equal(collector.append([]), second);
  assert.equal(collector.append(['alpha']), second);
  assert.throws(() => collector.append(['folder', { entryId: 'alpha', snippet: 1 }]));
  assert.equal(collector.append([]), second, 'a rejected batch publishes no prefix');
  assert.deepEqual(collector.append(['folder']).map(hit => hit.entryId), ['beta', 'alpha', 'folder']);
});

test('streamed result counts include unknown and repeated IDs across batches without partial budget commits', () => {
  const collector = createExplorerSearchResultAccumulator(entries);
  const first = collector.append(Array(50_000).fill('alpha'));
  collector.append(Array(49_999).fill('missing'));
  assert.throws(() => collector.append(['beta', 'folder']), /100,000/);
  assert.equal(collector.append([]), first);
  assert.deepEqual(collector.append(['beta']).map(hit => hit.entryId), ['alpha', 'beta']);
  assert.throws(() => collector.append(['alpha']), /100,000/);
});

test('cumulative JSON budget includes ignored results and failed batches do not replace accepted hits', () => {
  const collector = createExplorerSearchResultAccumulator(entries);
  const first = collector.append([{ entryId: 'alpha', snippet: 'accepted' }]);
  const large = { entryId: 'missing', metadata: { text: 'x'.repeat(90_000) } };
  collector.append(Array(30).fill(large));
  assert.throws(() => collector.append(['beta', ...Array(30).fill(large)]), /maxLength|5,000,000/);
  assert.equal(collector.append([]), first);
  assert.deepEqual(collector.append(['folder']).map(hit => hit.entryId), ['alpha', 'folder']);
});
