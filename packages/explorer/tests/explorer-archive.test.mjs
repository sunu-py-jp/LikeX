import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { importTypeScript } from './import-typescript.mjs';

const { createFolderArchive } = await importTypeScript('../src/model/archive.ts');
const stamp = '2026-09-06T03:04:06.000Z';
const folder = (id, name, parent = 'root') => ({
  id, name, parent, kind: 'folder', source: null, size: 0, mime: '',
  favorite: 0, createdAt: stamp, updatedAt: stamp,
});
const file = (id, name, parent, source = { kind: 'existing', id: `stored-${id}` }) => ({
  ...folder(id, name, parent), kind: 'file', source, size: 999, mime: 'application/octet-stream',
});
const hasPython = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

async function readZip(blob) {
  // Python's standard ZIP reader independently checks the central directory,
  // local header offsets, UTF-8 names and CRCs; it shares no writer code.
  const result = spawnSync('python3', ['-c', `
import sys, io, zipfile, json, base64
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    assert archive.testzip() is None
    print(json.dumps([{
        'name': info.filename, 'directory': info.is_dir(), 'crc': info.CRC,
        'method': info.compress_type, 'flags': info.flag_bits,
        'attributes': info.external_attr, 'size': info.file_size,
        'data': base64.b64encode(archive.read(info)).decode('ascii')
    } for info in archive.infolist()]))
`], { input: Buffer.from(await blob.arrayBuffer()), maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  return JSON.parse(result.stdout.toString());
}

test('STORE ZIP is readable by the standard ZIP reader with Unicode, binary content and empty directories', { skip: !hasPython && 'python3 is required for the independent compatibility check' }, async () => {
  const binary = new Uint8Array([0, 1, 2, 128, 254, 255]);
  const local = new File([binary], 'old-name.bin');
  const entries = [
    folder('top', '資料📁'), folder('empty', '空のフォルダ', 'top'),
    folder('nested', '改名した階層', 'top'),
    file('local', '現在の名前.bin', 'nested', { kind: 'local', file: local }),
    file('remote', 'checksum.txt', 'top'), file('outside', 'outside.txt', 'root'),
  ];
  for (const entry of entries) { if (entry.source) Object.freeze(entry.source); Object.freeze(entry); }
  Object.freeze(entries);
  const reads = [];
  const archive = await createFolderArchive(entries, 'top', async id => {
    reads.push(id); return new Blob(['123456789']);
  });
  assert.equal(archive.type, 'application/zip');
  assert.deepEqual(reads, ['stored-remote']);
  const files = await readZip(archive);
  assert.deepEqual(files.map(item => item.name), [
    '資料📁/', '資料📁/空のフォルダ/', '資料📁/改名した階層/',
    '資料📁/改名した階層/現在の名前.bin', '資料📁/checksum.txt',
  ]);
  assert.ok(files.every(item => item.method === 0 && (item.flags & 0x0800)));
  assert.ok(files.filter(item => item.directory).every(item => (item.attributes & 0x10) && item.size === 0));
  const zippedBinary = files.find(item => item.name.endsWith('.bin'));
  assert.deepEqual(Buffer.from(zippedBinary.data, 'base64'), Buffer.from(binary));
  assert.equal(zippedBinary.size, binary.length, 'actual content determines size, not stale metadata');
  assert.equal(files.at(-1).crc, 0xcbf43926, 'standard CRC32 check vector');
});

test('an entirely empty folder remains present in the ZIP without a content reader', { skip: !hasPython && 'python3 is required for the independent compatibility check' }, async () => {
  const files = await readZip(await createFolderArchive([folder('empty', 'Empty')], 'empty'));
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'Empty/');
  assert.equal(files[0].directory, true);
  assert.equal(files[0].crc, 0);
});

test('archive paths and content references are captured before asynchronous reads', { skip: !hasPython && 'python3 is required for the independent compatibility check' }, async () => {
  const entries = [folder('top', 'Original'), file('one', 'One.txt', 'top'), file('two', 'Two.txt', 'top')];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const reads = [];
  const archive = createFolderArchive(entries, 'top', id => {
    reads.push(id);
    return id === 'stored-one' ? pending : Promise.resolve(new Blob(['two']));
  });
  entries[0].name = 'Later'; entries[2].name = 'Later.txt'; entries[2].source.id = 'changed-content';
  release(new Blob(['one']));
  const files = await readZip(await archive);
  assert.deepEqual(files.map(item => item.name), ['Original/', 'Original/One.txt', 'Original/Two.txt']);
  assert.deepEqual(reads, ['stored-one', 'stored-two']);
});

test('a failed or missing file read rejects the whole archive and never creates a download URL', async t => {
  const objectURL = t.mock.method(URL, 'createObjectURL', () => { throw Error('Unexpected URL'); });
  const entries = [folder('top', 'Top'), file('one', 'One.txt', 'top'), file('two', 'Two.txt', 'top')];
  const reads = [];
  await assert.rejects(createFolderArchive(entries, 'top', async id => {
    reads.push(id);
    if (id === 'stored-two') throw Error('Storage unavailable');
    return new Blob(['one']);
  }), /Top\/Two\.txt.*Storage unavailable/);
  assert.deepEqual(reads, ['stored-one', 'stored-two']);
  await assert.rejects(createFolderArchive(entries, 'top'), /読み込み方法/);
  await assert.rejects(createFolderArchive(entries, 'top', async () => undefined), /内容が返されません/);
  assert.equal(objectURL.mock.callCount(), 0);
});

test('cancelled archives stop before reading another file or allocating its byte buffer', async () => {
  const entries = [folder('top', 'Top'), file('one', 'One.txt', 'top'), file('two', 'Two.txt', 'top')];
  const aborted = new AbortController();
  aborted.abort();
  let reads = 0;
  await assert.rejects(createFolderArchive(entries, 'top', async () => { reads++; return new Blob(); }, aborted.signal),
    { name: 'AbortError' });
  assert.equal(reads, 0);
  const controller = new AbortController();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const archive = createFolderArchive(entries, 'top', () => { reads++; return pending; }, controller.signal);
  const rejected = assert.rejects(archive, { name: 'AbortError' });
  controller.abort();
  class UnreadBlob extends Blob {
    arrayBuffer() { assert.fail('a cancelled read must not allocate a buffer or calculate its CRC'); }
  }
  release(new UnreadBlob(['cancelled']));
  await rejected;
  assert.equal(reads, 1);
});

test('cancellation during arrayBuffer stops ZIP assembly before the next content read', async () => {
  const entries = [folder('top', 'Top'), file('one', 'One.txt', 'top'), file('two', 'Two.txt', 'top')];
  const controller = new AbortController();
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const reading = new Promise(resolve => { started = resolve; });
  class PendingBlob extends Blob {
    arrayBuffer() { started(); return pending; }
  }
  const reads = [];
  const archive = createFolderArchive(entries, 'top', async id => { reads.push(id); return new PendingBlob(['body']); }, controller.signal);
  const rejected = assert.rejects(archive, { name: 'AbortError' });
  await reading;
  controller.abort();
  release(new ArrayBuffer(4));
  await rejected;
  assert.deepEqual(reads, ['stored-one']);
});

test('invalid trees and non-folder targets are rejected before reading any content', async () => {
  let reads = 0;
  const readFile = async () => { reads++; return new Blob(); };
  await assert.rejects(createFolderArchive([file('file', 'File.txt', 'root')], 'file', readFile), /フォルダ/);
  await assert.rejects(createFolderArchive([folder('top', 'Top')], 'missing', readFile), /フォルダ/);
  await assert.rejects(createFolderArchive([folder('top', '../escape')], 'top', readFile), /名前/);
  await assert.rejects(createFolderArchive([folder('top', 'Broken\ud800')], 'top', readFile), /Unicode/);
  await assert.rejects(createFolderArchive([folder('top', 'Top', 'child'), folder('child', 'Child', 'top')], 'top', readFile), /循環/);
  assert.equal(reads, 0);
});

test('ZIP64 sizes and total-size overflow are rejected before allocating large buffers', async () => {
  class OversizedBlob extends Blob {
    constructor(size) { super(); this.reportedSize = size; }
    get size() { return this.reportedSize; }
    arrayBuffer() { assert.fail('size validation must precede allocation'); }
  }
  const entries = [folder('top', 'Top'), file('file', 'File.txt', 'top')];
  for (const size of [0xffffffff, 0xffffffff - 100, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(createFolderArchive(entries, 'top', async () => new OversizedBlob(size)), /4 GiB/);
  }
});

test('classic ZIP entry-count and UTF-8 path limits fail before any file is read', async () => {
  let reads = 0;
  const readFile = async () => { reads++; return new Blob(); };
  const entries = [folder('top', 'Top'), ...Array.from({ length: 0xfffe }, (_, i) => file(`f${i}`, `${i}.txt`, 'top'))];
  await assert.rejects(createFolderArchive(entries, 'top', readFile), /65,534/);
  const deep = [folder('top', 'Top')];
  for (let index = 0; index < 130; index++) deep.push(folder(`d${index}`, 'あ'.repeat(180), index ? `d${index - 1}` : 'top'));
  await assert.rejects(createFolderArchive(deep, 'top', readFile), /階層が深すぎる/);
  assert.equal(reads, 0);
});
