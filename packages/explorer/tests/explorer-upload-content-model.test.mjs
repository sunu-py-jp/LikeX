import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const {
  createDraftSnapshot, addFiles, addFilesAsync, addFilesWithResult, addFilesWithResultAsync,
  prepareFilesWithProgressAsync, createExplorerUploadSession, getSavePayload,
  ExplorerUploadConflictError, ExplorerUploadValidationError, ExplorerUploadInspectionRequiredError,
  EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS,
} = await importTypeScript('../src/model-entry.ts');

const file = (name, relativePath = '', body = 'metadata inspected by the host') => {
  const value = new File([body], name, { type: 'application/octet-stream' });
  if (relativePath) Object.defineProperty(value, 'webkitRelativePath', { value: relativePath });
  return value;
};
const saved = (id, name) => ({ id, name, parent: 'root', kind: 'file', size: 5, mime: 'application/octet-stream',
  source: { kind: 'existing', id: `body-${id}` }, favorite: 1,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function rejected(operation, Type = ExplorerUploadValidationError) {
  let error;
  await assert.rejects(operation, caught => { error = caught; return caught instanceof Type; });
  return error;
}

test('the public asynchronous model enforces the default four-hour video limit and accepts equality', async () => {
  assert.equal(EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS, 14_400);
  const baseline = createDraftSnapshot([]), exact = file('Exact.MP4'), over = file('Over.mp4');
  const inspected = [];
  const options = { inspectFile(request) {
    inspected.push(request);
    return { kind: 'video', durationSeconds: request.file === exact ? 14_400 : 14_400.01 };
  } };
  const added = await addFilesAsync(baseline, [exact], 'root', options);
  assert.equal(added.entries[0].source.file, exact);
  const error = await rejected(() => addFilesWithResultAsync(baseline, [over], 'root', options));
  assert.equal(error.rejections[0].reasons[0].code, 'duration-exceeded');
  assert.equal(error.rejections[0].reasons[0].maxDurationSeconds, 14_400);
  assert.equal(inspected[0].extension, '.mp4');
  assert.equal(inspected[0].kind, 'video');
  assert.ok(inspected.every(request => request.signal instanceof AbortSignal));
  assert.deepEqual(baseline.entries, []);
});

for (const example of [
  { name: 'sound.mp3', limit: { maxDurationSeconds: 30.5 }, kind: 'audio', metric: 'durationSeconds', value: 30.5, reason: 'duration-exceeded' },
  { name: 'paper.pdf', limit: { maxPages: 2 }, kind: 'pdf', metric: 'pages', value: 2, reason: 'page-count-exceeded' },
  { name: 'deck.pptx', limit: { maxSlides: 3 }, kind: 'presentation', metric: 'slides', value: 3, reason: 'slide-count-exceeded' },
]) test(`the public asynchronous model checks typed limits for ${example.kind}`, async () => {
  const baseline = createDraftSnapshot([]), incoming = file(example.name);
  const suffix = `.${example.name.split('.').at(-1)}`;
  const options = { contentLimitsByExtension: { [suffix]: example.limit },
    inspectFile: request => ({ kind: request.kind, [example.metric]: example.value }) };
  const result = await addFilesWithResultAsync(baseline, [incoming], 'root', options);
  assert.equal(result.result.addedCount, 1);
  assert.equal(result.snapshot.entries[0].source.file, incoming);
  const error = await rejected(() => addFilesWithResultAsync(baseline, [incoming], 'root', {
    ...options, inspectFile: () => ({ kind: example.kind, [example.metric]: example.value + 1 }),
  }));
  assert.equal(error.rejections[0].reasons[0].code, example.reason);
  assert.deepEqual(baseline.entries, []);
});

test('false disables a video rule while unconfigured audio, documents and unrelated suffixes stay metadata-only', async () => {
  const baseline = createDraftSnapshot([]);
  const files = [file('clip.mp4'), file('sound.mp3'), file('paper.pdf'), file('deck.pptx'), file('clip.mp42')];
  const options = { contentLimitsByExtension: { '.mp4': false }, inspectFile() { assert.fail('disabled or absent rules must not inspect bytes'); } };
  for (const incoming of files) incoming.arrayBuffer = () => { assert.fail('metadata-only staging must not read bytes'); };
  assert.equal(addFilesWithResult(baseline, files, 'root', options).result.addedCount, 5);
  assert.equal((await addFilesWithResultAsync(baseline, files, 'root', options)).result.addedCount, 5);
});

test('content rules select the staged basename from a directory path', async () => {
  const baseline = createDraftSnapshot([]), incoming = file('opaque.bin', 'Videos/Actual.MP4');
  const inspected = [];
  const result = await addFilesWithResultAsync(baseline, [incoming], 'root', {
    inspectFile(request) { inspected.push(request); return { kind: 'video', durationSeconds: 30 }; },
  });
  assert.equal(inspected.length, 1);
  assert.equal(inspected[0].extension, '.mp4');
  assert.equal(result.snapshot.entries.find(entry => entry.kind === 'file').name, 'Actual.MP4');
});

test('extension and byte rejections bypass content readers while accepted bytes are inspected once', async () => {
  const baseline = createDraftSnapshot([]);
  const forbidden = file('Forbidden.mp4'), oversized = file('Large.webm', '', '12345'), accepted = file('Small.webm', '', '1234');
  const inspected = [];
  const result = await addFilesWithResultAsync(baseline, [forbidden, oversized, accepted], 'root', {
    allowedExtensions: ['.webm'], maxFileSizeBytes: 4, invalidFileBehavior: 'skip',
    inspectFile({ file }) { inspected.push(file); return { kind: 'video', durationSeconds: 1 }; },
  });
  assert.deepEqual(inspected, [accepted]);
  assert.equal(result.result.addedCount, 1);
  assert.deepEqual(result.result.rejections.map(item => item.name), ['Forbidden.mp4', 'Large.webm']);
  assert.equal(result.result.rejections[0].reasons[0].code, 'extension-not-allowed');
  assert.equal(result.result.rejections[1].reasons[0].code, 'file-too-large');
});

test('a content rejection rejects the whole batch without changing saved entries or retaining accepted folders', async () => {
  const baseline = createDraftSnapshot([saved('old', 'Old.txt')]), before = structuredClone(baseline.entries);
  const good = file('Good.mp4', 'Good/Good.mp4'), bad = file('Bad.mp4', 'Bad/Bad.mp4');
  const error = await rejected(() => addFilesWithResultAsync(baseline, [good, bad], 'root', {
    inspectFile: ({ file }) => ({ kind: 'video', durationSeconds: file === good ? 1 : 20_000 }),
  }));
  assert.equal(error.rejections[0].file, bad);
  assert.deepEqual(baseline.entries, before);
  assert.equal(baseline.entries.length, 1);
});

test('skip preserves original conflict indexes and gives quota slots only to accepted and approved writes', async () => {
  const baseline = createDraftSnapshot([saved('old', 'Old.mp4')]), session = createExplorerUploadSession();
  const bad = file('Bad.mp4', 'Rejected/Bad.mp4'), conflict = file('Old.mp4'), accepted = file('New.mp4', 'Accepted/New.mp4'), excess = file('Excess.mp4', 'Excess/Excess.mp4');
  const files = [bad, conflict, accepted, excess], reads = new Map();
  const options = { maxFilesPerUpload: 1, maxTotalFiles: 2, invalidFileBehavior: 'skip', inspectFile({ file }) {
    reads.set(file, (reads.get(file) ?? 0) + 1);
    return { kind: 'video', durationSeconds: file === bad ? 20_000 : 20 };
  } };
  const error = await rejected(() => addFilesWithResultAsync(baseline, files, 'root', options, [], session), ExplorerUploadConflictError);
  assert.equal(error.conflict.fileIndex, 1);
  const result = await addFilesWithResultAsync(baseline, files, 'root', options, [{
    fileIndex: error.conflict.fileIndex, existing: error.conflict.existing, action: 'skip',
  }], session);
  assert.equal(result.result.addedCount, 1);
  assert.equal(result.result.overwrittenCount, 0);
  assert.equal(result.result.skippedCount, 1);
  assert.deepEqual(result.result.rejections.map(item => item.file), [bad, excess]);
  assert.equal(result.result.rejections[1].reasons[0].code, 'upload-file-count-exceeded');
  assert.deepEqual(result.snapshot.entries.filter(item => item.kind === 'folder').map(item => item.name), ['Accepted']);
  assert.equal(result.snapshot.entries.find(item => item.id === 'old').source.kind, 'existing');
  assert.ok([...reads.values()].every(count => count === 1));
});

test('approved overwrites retain IDs and timestamps and reuse content facts while storing the original File', async () => {
  const baseline = createDraftSnapshot([saved('old', 'Old.mp4')]), incoming = file('Old.mp4'), session = createExplorerUploadSession();
  let reads = 0;
  const options = { inspectFile() { reads++; return { kind: 'video', durationSeconds: 20 }; } };
  const error = await rejected(() => addFilesWithResultAsync(baseline, [incoming], 'root', options, [], session), ExplorerUploadConflictError);
  const decision = { fileIndex: 0, existing: error.conflict.existing, action: 'overwrite' };
  const result = await addFilesWithResultAsync(baseline, [incoming], 'root', options, [decision], session);
  const repeated = addFilesWithResult(baseline, [incoming], 'root', options, [decision], session);
  assert.equal(reads, 1);
  assert.equal(result.result.overwrittenCount, 1);
  assert.equal(result.snapshot.entries[0].id, 'old');
  assert.equal(result.snapshot.entries[0].createdAt, baseline.entries[0].createdAt);
  assert.equal(result.snapshot.entries[0].updatedAt, baseline.entries[0].updatedAt);
  assert.equal(result.snapshot.entries[0].source.file, incoming);
  assert.deepEqual(repeated.snapshot.entries, result.snapshot.entries);
  assert.equal(getSavePayload(baseline, result.snapshot).changes.updated[0].id, 'old');
  assert.equal(baseline.entries[0].source.kind, 'existing');
});

test('cached page counts are compared against the latest limit and never reused for a different inspector', async () => {
  const baseline = createDraftSnapshot([]), incoming = file('Paper.pdf'), session = createExplorerUploadSession();
  let originalReads = 0, replacementReads = 0;
  const inspectFile = () => { originalReads++; return { kind: 'pdf', pages: 8 }; };
  const options = { contentLimitsByExtension: { '.pdf': { maxPages: 10 } }, inspectFile };
  await addFilesWithResultAsync(baseline, [incoming], 'root', options, [], session);
  const tightened = { ...options, contentLimitsByExtension: { '.pdf': { maxPages: 3 } } };
  const error = await rejected(() => addFilesWithResultAsync(baseline, [incoming], 'root', tightened, [], session));
  assert.equal(error.rejections[0].reasons[0].maxPages, 3);
  assert.equal(originalReads, 1);
  assert.throws(() => addFilesWithResult(baseline, [incoming], 'root', tightened, [], session), ExplorerUploadValidationError);
  const replaced = { ...tightened, inspectFile: () => { replacementReads++; return { kind: 'pdf', pages: 1 }; } };
  assert.throws(() => addFilesWithResult(baseline, [incoming], 'root', replaced, [], session), ExplorerUploadInspectionRequiredError);
  assert.equal((await addFilesWithResultAsync(baseline, [incoming], 'root', replaced, [], session)).result.addedCount, 1);
  assert.equal(replacementReads, 1);
});

test('synchronous public imports fail explicitly until the same session has inspected the actual file', async () => {
  const baseline = createDraftSnapshot([]), incoming = file('Video.mp4'), session = createExplorerUploadSession();
  const options = { inspectFile: () => ({ kind: 'video', durationSeconds: 1 }) };
  assert.throws(() => addFiles(baseline, [incoming], 'root', options), ExplorerUploadInspectionRequiredError);
  await addFilesWithResultAsync(baseline, [incoming], 'root', options, [], session);
  assert.equal(addFilesWithResult(baseline, [incoming], 'root', options, [], session).result.addedCount, 1);
  assert.throws(() => addFilesWithResult(baseline, [incoming], 'root', options, [], createExplorerUploadSession()), ExplorerUploadInspectionRequiredError);
  assert.throws(() => addFilesWithResult(baseline, [incoming], 'root', options, [], {}), /セッション/);
  await assert.rejects(() => addFilesWithResultAsync(baseline, [file('Video.mp4')], 'root', options, [], session), /対象が変わりました/);
  Object.defineProperty(incoming, 'size', { value: incoming.size + 1 });
  await assert.rejects(() => addFilesWithResultAsync(baseline, [incoming], 'root', options, [], session), /対象が変わりました/);
  assert.deepEqual(baseline.entries, []);
});

test('asynchronous input and nested policy copies cannot be changed while the inspector is pending', async () => {
  const baseline = createDraftSnapshot([]), incoming = file('Paper.pdf'), substituted = file('Other.pdf');
  const files = [incoming], session = createExplorerUploadSession(), started = deferred(), metadata = deferred();
  const options = { contentLimitsByExtension: { '.pdf': { maxPages: 10 } }, inspectFile() { started.resolve(); return metadata.promise; } };
  const pending = addFilesWithResultAsync(baseline, files, 'root', options, [], session);
  await started.promise;
  files[0] = substituted;
  options.contentLimitsByExtension['.pdf'].maxPages = 0;
  metadata.resolve({ kind: 'pdf', pages: 8 });
  const result = await pending;
  assert.equal(result.result.addedCount, 1);
  assert.equal(result.snapshot.entries[0].source.file, incoming);
  const error = await rejected(() => addFilesWithResultAsync(baseline, [incoming], 'root', options, [], session));
  assert.equal(error.rejections[0].reasons[0].maxPages, 0);
});

test('aborting during normalization stops before inspecting bytes or staging any files', async () => {
  const baseline = createDraftSnapshot([]), controller = new AbortController();
  const operation = prepareFilesWithProgressAsync(baseline, [file('Video.mp4')], 'root', {
    inspectFile() { assert.fail('aborted normalization cannot inspect bytes'); },
  }, [], undefined, { signal: controller.signal });
  assert.deepEqual((await operation.next()).value, { phase: 'checking', completed: 0, total: 1 });
  controller.abort();
  await assert.rejects(() => operation.next(), { name: 'AbortError' });
  assert.deepEqual(baseline.entries, []);
});

test('aborting a noncooperative inspector stops promptly and its late metadata cannot become cached evidence', async () => {
  const baseline = createDraftSnapshot([]), incoming = file('Video.mp4'), session = createExplorerUploadSession();
  const controller = new AbortController(), started = deferred(), metadata = deferred();
  let reads = 0;
  const options = { inspectFile() { reads++; if (reads === 1) { started.resolve(); return metadata.promise; } return { kind: 'video', durationSeconds: 1 }; } };
  const pending = addFilesWithResultAsync(baseline, [incoming], 'root', options, [], session, { signal: controller.signal })
    .then(result => ({ result }), error => ({ error }));
  await started.promise;
  controller.abort();
  assert.equal((await pending).error.name, 'AbortError');
  metadata.resolve({ kind: 'video', durationSeconds: 1 });
  await Promise.resolve();
  assert.throws(() => addFilesWithResult(baseline, [incoming], 'root', options, [], session), ExplorerUploadInspectionRequiredError);
  assert.equal((await addFilesWithResultAsync(baseline, [incoming], 'root', options, [], session)).result.addedCount, 1);
  assert.equal(reads, 2);
  assert.deepEqual(baseline.entries, []);
});

test('failed content inspections remain rejected on retries and never turn into unchecked skip imports', async () => {
  const baseline = createDraftSnapshot([]), incoming = file('Video.mp4'), session = createExplorerUploadSession();
  let reads = 0;
  const options = { invalidFileBehavior: 'skip', inspectFile() { reads++; throw new Error('cannot read metadata'); } };
  const first = await addFilesWithResultAsync(baseline, [incoming], 'root', options, [], session);
  const repeated = addFilesWithResult(baseline, [incoming], 'root', options, [], session);
  assert.equal(first.snapshot, baseline);
  assert.equal(repeated.snapshot, baseline);
  assert.equal(repeated.result.addedCount, 0);
  assert.equal(repeated.result.rejections[0].reasons[0].code, 'content-inspection-failed');
  assert.equal(reads, 1);
});
