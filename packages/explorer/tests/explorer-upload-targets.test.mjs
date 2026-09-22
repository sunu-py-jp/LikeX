import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { createSnapshot, addFilesWithResult, addFilesWithResultAsync, getPreparedUploadTargets } = await importTypeScript('../src/model/draft.ts');
const original = file => createSnapshot([{
  id: 'existing', parent: 'root', name: file.name, kind: 'file', size: file.size, mime: file.type,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', favorite: 0,
  source: { kind: 'local', file },
}]);

test('exact accepted target retains identical overwrite when the same File is later quota-rejected', () => {
  const file = new File(['same'], 'file.txt', { type: 'text/plain' });
  const snapshot = original(file);
  const decisions = [0, 1].map(fileIndex => ({ fileIndex, action: 'overwrite', existing: snapshot.entries[0] }));
  const candidate = addFilesWithResult(snapshot, [file, file], 'root', {
    maxFilesPerUpload: 1, invalidFileBehavior: 'skip',
  }, decisions);
  assert.equal(candidate.snapshot, snapshot, 'an identical accepted overwrite is still a permission target');
  assert.equal(candidate.result.overwrittenCount, 1);
  assert.equal(candidate.result.rejections[0].file, file);
  assert.deepEqual(getPreparedUploadTargets(candidate.result), ['existing']);
  assert.ok(Object.isFrozen(getPreparedUploadTargets(candidate.result)));
  assert.deepEqual(Object.keys(candidate.result).sort(), ['addedCount', 'attemptedCount', 'overwrittenCount', 'rejections', 'skippedCount']);
});

test('only accepted writes contribute targets, excluding explicit skips and quota rejections', () => {
  const file = new File(['same'], 'file.txt', { type: 'text/plain' });
  const added = new File(['new'], 'new.txt', { type: 'text/plain' });
  const snapshot = original(file);
  const skipped = addFilesWithResult(snapshot, [file, added], 'root', undefined, [
    { fileIndex: 0, action: 'skip', existing: snapshot.entries[0] },
  ]);
  const newEntry = skipped.snapshot.entries.find(entry => entry.name === 'new.txt');
  assert.deepEqual(getPreparedUploadTargets(skipped.result), [newEntry.id]);
  const rejected = addFilesWithResult(snapshot, [file], 'root', {
    maxFilesPerUpload: 0, invalidFileBehavior: 'skip',
  }, [{ fileIndex: 0, action: 'overwrite', existing: snapshot.entries[0] }]);
  assert.deepEqual(getPreparedUploadTargets(rejected.result), []);
  assert.deepEqual(getPreparedUploadTargets({ ...skipped.result }), [], 'metadata belongs to the prepared result identity');
});

test('async preparation retains exact targets and repeated accepted writes are deduplicated', async () => {
  const file = new File(['same'], 'file.txt', { type: 'text/plain' });
  const snapshot = original(file);
  const decisions = [0, 1].map(fileIndex => ({ fileIndex, action: 'overwrite', existing: snapshot.entries[0] }));
  const candidate = await addFilesWithResultAsync(snapshot, [file, file], 'root', undefined, decisions);
  assert.equal(candidate.result.overwrittenCount, 2);
  assert.deepEqual(getPreparedUploadTargets(candidate.result), ['existing']);
});
