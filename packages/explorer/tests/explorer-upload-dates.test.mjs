import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { createSnapshot, addFilesWithResult, addFilesWithResultAsync, createExplorerUploadSession, getSavePayload } = await importTypeScript('../src/model/index.ts');
const at = '2026-10-01T03:00:00.000Z';
const file = (name, lastModified, path) => {
  const result = new File(['content'], name, { type: 'text/plain', lastModified });
  if (path) Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
};

test('file and folder uploads retain each source modification date, including epoch and pre-epoch dates', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(at) });
  const baseline = createSnapshot([]);
  const dates = [Date.parse('2021-06-02T12:34:56.789+09:00'), 0, -1000];
  const files = dates.map((date, index) => file(`${index}.txt`, date, index ? `Folder/${index}.txt` : ''));
  const { snapshot } = addFilesWithResult(baseline, files, 'root');
  const payload = getSavePayload(baseline, snapshot);
  for (const [index, source] of files.entries()) {
    const entry = snapshot.entries.find(item => item.name === source.name);
    assert.equal(entry.updatedAt, new Date(dates[index]).toISOString());
    assert.equal(entry.createdAt, at);
    assert.equal(entry.source.file, source);
    assert.equal(payload.entries.find(item => item.id === entry.id).updatedAt, entry.updatedAt);
    assert.equal(payload.changes.created.find(item => item.id === entry.id).updatedAt, entry.updatedAt);
  }
  const folder = snapshot.entries.find(item => item.kind === 'folder');
  assert.equal(folder.createdAt, at); assert.equal(folder.updatedAt, at);
  assert.deepEqual(baseline.entries, []);
});

test('unavailable modification dates use one stable import timestamp across preparation retries', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(at) });
  const files = [undefined, NaN, Infinity, 8640000000000001, '123'].map((value, index) => {
    const incoming = file(`${index}.txt`, 0);
    Object.defineProperty(incoming, 'lastModified', { value });
    return incoming;
  });
  const baseline = createSnapshot([]), session = createExplorerUploadSession();
  const first = addFilesWithResult(baseline, files, 'root', undefined, [], session);
  t.mock.timers.tick(60_000);
  const repeated = addFilesWithResult(baseline, files, 'root', undefined, [], session);
  assert.deepEqual(repeated.snapshot.entries, first.snapshot.entries);
  assert.ok(first.snapshot.entries.every(entry => entry.updatedAt === at && entry.createdAt === at));
});

test('overwrite inherits an older source timestamp while skip leaves the stored timestamp unchanged', () => {
  const incoming = file('report.txt', Date.parse('2019-02-03T04:05:06.789Z'));
  const baseline = createSnapshot([{ id: 'report', name: 'report.txt', parent: 'root', kind: 'file', size: 4, mime: 'text/plain',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: at, favorite: 1, source: { kind: 'existing', id: 'body' } }]);
  const decision = { fileIndex: 0, existing: baseline.entries[0], action: 'overwrite' };
  const overwritten = addFilesWithResult(baseline, [incoming], 'root', undefined, [decision]);
  const next = overwritten.snapshot.entries[0];
  assert.equal(next.id, 'report'); assert.equal(next.createdAt, baseline.entries[0].createdAt);
  assert.equal(next.favorite, 1); assert.equal(next.updatedAt, '2019-02-03T04:05:06.789Z');
  assert.equal(getSavePayload(baseline, overwritten.snapshot).changes.updated[0].updatedAt, next.updatedAt);
  assert.equal(addFilesWithResult(baseline, [incoming], 'root', undefined, [{ ...decision, action: 'skip' }]).snapshot, baseline);
  assert.equal(baseline.entries[0].updatedAt, at);
});

test('a changed source timestamp invalidates the upload session without applying a partial batch', () => {
  const incoming = file('report.txt', 1000), baseline = createSnapshot([]), session = createExplorerUploadSession();
  addFilesWithResult(baseline, [incoming], 'root', undefined, [], session);
  Object.defineProperty(incoming, 'lastModified', { value: 2000 });
  assert.throws(() => addFilesWithResult(baseline, [incoming], 'root', undefined, [], session), /対象が変わりました/);
  assert.deepEqual(baseline.entries, []);
});

test('asynchronous content inspection uses the same modification-date contract', async () => {
  const incoming = file('report.pdf', Date.parse('2022-05-06T07:08:09.123Z'));
  const baseline = createSnapshot([]);
  const { snapshot } = await addFilesWithResultAsync(baseline, [incoming], 'root', {
    contentLimitsByExtension: { '.pdf': { maxPages: 3 } }, inspectFile: async () => ({ kind: 'pdf', pages: 2 }),
  });
  assert.equal(snapshot.entries[0].updatedAt, '2022-05-06T07:08:09.123Z');
});
