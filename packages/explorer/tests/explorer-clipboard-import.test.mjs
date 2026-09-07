import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ absWorkingDir: packageRoot, entryPoints: ['src/state/clipboard-import.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false });
const { captureClipboardImport } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const file = (name, text = 'file') => new File([text], name, { type: 'text/plain', lastModified: 12345 });
const fileEntry = value => ({ isFile: true, isDirectory: false, name: value.name, file: resolve => resolve(value) });
function directory(name, children = [], chunkSize = 100) {
  const stats = { readers: 0, calls: 0 };
  return { name, isFile: false, isDirectory: true, stats, createReader() {
    stats.readers++; let offset = 0;
    return { readEntries(resolve) { stats.calls++; const next = children.slice(offset, offset + chunkSize); offset += chunkSize; resolve(next); } };
  } };
}
const item = value => ({ kind: 'file', webkitGetAsEntry: () => value, getAsFile: () => null });
const transfer = (roots, files = []) => ({ items: [...roots.map(item), ...files.map(value => ({ kind: 'file', getAsFile: () => value }))], files, types: ['Files'] });

function deferredDirectory(name = 'Delayed') {
  let resolve, reject;
  const entry = { name, isDirectory: true, isFile: false, createReader() {
    let started = false;
    return { readEntries(done, fail) { if (started) return done([]); started = true; resolve = done; reject = fail; } };
  } };
  return { entry, complete(children) { assert.ok(resolve); resolve(children); }, fail(error) { assert.ok(reject); reject(error); } };
}

test('non-file clipboard content has no import, while ordinary Files retain identity and avoid byte reads', async t => {
  assert.equal(captureClipboardImport({ files: [], items: [], types: ['text/plain'] }), null);
  const value = file('plain.txt');
  const spy = t.mock.method(value, 'arrayBuffer', () => { throw Error('Unexpected byte read'); });
  const job = captureClipboardImport(transfer([], [value]));
  assert.equal(job.hasDirectories, false); assert.equal(job.hasRootFiles, true);
  assert.deepEqual(job.files, [value]); assert.equal((await job.read())[0], value);
  assert.equal(spy.mock.callCount(), 0);
});

test('directory readers drain multiple 100-item batches and preserve normalized nested paths', async () => {
  const originals = Array.from({ length: 205 }, (_, i) => file(`file-${i}.txt`));
  const nested = directory(' Nested ', originals.map(fileEntry));
  const outer = directory(' Re\u0301ports ', [nested, directory('Empty')]);
  const job = captureClipboardImport(transfer([outer]));
  assert.equal(job.hasDirectories, true); assert.equal(job.hasRootFiles, false);
  const files = await job.read();
  assert.equal(files.length, 205); assert.equal(nested.stats.readers, 1); assert.equal(nested.stats.calls, 4);
  assert.equal(files[0].webkitRelativePath, 'Réports/Nested/file-0.txt');
  assert.equal(files.at(-1).webkitRelativePath, 'Réports/Nested/file-204.txt');
  assert.notEqual(files[0], originals[0]); assert.equal(originals[0].webkitRelativePath, undefined);
  assert.equal(files[0].type, originals[0].type); assert.equal(files[0].lastModified, originals[0].lastModified);
  assert.equal(await files[0].text(), await originals[0].text());
});

test('mixed root files and folders retain each location and empty-only trees yield no files', async () => {
  const direct = file('root.txt'), nested = file('inside.txt');
  const job = captureClipboardImport(transfer([directory('Batch', [fileEntry(nested)])], [direct]));
  assert.equal(job.hasDirectories, true); assert.equal(job.hasRootFiles, true);
  const files = await job.read();
  assert.equal(files.length, 2); assert.ok(files.includes(direct));
  assert.equal(files.find(value => value.name === 'inside.txt').webkitRelativePath, 'Batch/inside.txt');
  assert.deepEqual(await captureClipboardImport(transfer([directory('Empty', [directory('Nested')])])).read(), []);
});

test('DataTransfer and its items are captured synchronously before protected clipboard access disappears', async () => {
  const nested = file('content.txt'), root = directory('Batch', [fileEntry(nested)]);
  let accessible = true, entryCalls = 0;
  const data = { get items() { assert.ok(accessible); return [{ kind: 'file', webkitGetAsEntry() { assert.ok(accessible); entryCalls++; return root; }, getAsFile() { assert.ok(accessible); return null; } }]; },
    get files() { assert.ok(accessible); return []; }, get types() { assert.ok(accessible); return ['Files']; } };
  const job = captureClipboardImport(data); accessible = false;
  const files = await job.read();
  assert.equal(entryCalls, 1); assert.equal(files[0].webkitRelativePath, 'Batch/content.txt');
});

test('a nested file read failure rejects the complete import rather than returning earlier results', async () => {
  const broken = { name: 'blocked.txt', isFile: true, isDirectory: false, file(resolve, reject) { reject(Error('Permission denied')); } };
  const job = captureClipboardImport(transfer([directory('Batch', [fileEntry(file('good.txt')), broken])]));
  await assert.rejects(job.read(), /Permission denied/);
});

test('directory enumeration errors and invalid path segments reject the complete traversal', async () => {
  const broken = { name: 'Batch', isDirectory: true, isFile: false, createReader() { return { readEntries(resolve, reject) { reject(Error('Unreadable directory')); } }; } };
  await assert.rejects(captureClipboardImport(transfer([broken])).read(), /Unreadable directory/);
  await assert.rejects(async () => captureClipboardImport(transfer([directory('../Escape', [fileEntry(file('good.txt'))])])).read());
});

test('an already-aborted import does not open directory readers', async () => {
  const root = directory('Batch', [fileEntry(file('a.txt'))]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(captureClipboardImport(transfer([root])).read(controller.signal), error => error.name === 'AbortError');
  assert.equal(root.stats.readers, 0);
});

test('aborting during readEntries rejects promptly and late callbacks cannot restart traversal', async () => {
  const delayed = deferredDirectory(); const controller = new AbortController();
  const pending = captureClipboardImport(transfer([delayed.entry])).read(controller.signal);
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  controller.abort(); await rejected;
  const nested = directory('Late', [fileEntry(file('late.txt'))]);
  delayed.complete([nested]); await Promise.resolve();
  assert.equal(nested.stats.readers, 0);
});

test('capture accepts the unprefixed entry API and rejects unavailable items without returning a partial import', async () => {
  const root = directory('Batch', [fileEntry(file('inside.txt'))]);
  const job = captureClipboardImport({ files: [], items: [{ kind: 'file', getAsEntry: () => root }] });
  assert.equal((await job.read())[0].webkitRelativePath, 'Batch/inside.txt');
  assert.throws(() => captureClipboardImport({ files: [], items: [
    { kind: 'file', getAsFile: () => file('valid.txt') }, { kind: 'file', getAsFile: () => null },
  ] }));
  const fallback = file('listed.txt');
  assert.equal(captureClipboardImport({ files: [fallback], items: [{ kind: 'file', getAsFile: () => null }] }).files[0], fallback);
});

test('aborting an in-flight File callback preserves the abort reason and cannot yield partial files', async () => {
  let complete;
  const delayed = { name: 'late.txt', isFile: true, isDirectory: false, file(resolve) { complete = resolve; } };
  const job = captureClipboardImport(transfer([directory('Batch', [fileEntry(file('first.txt')), delayed])]));
  const controller = new AbortController(), reason = Error('Cancelled by the workspace');
  const pending = job.read(controller.signal);
  const rejected = assert.rejects(pending, error => error === reason);
  for (let i = 0; i < 10 && !complete; i++) await Promise.resolve();
  assert.equal(typeof complete, 'function');
  controller.abort(reason); await rejected;
  complete(file('late.txt')); await Promise.resolve();
});
