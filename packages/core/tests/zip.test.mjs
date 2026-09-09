import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const result = await build({ entryPoints: [new URL('../src/zip.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const file = (path, content = new Blob(['data'])) => ({ path, content });
const hasPython = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
async function readZip(blob) {
  const result = spawnSync('python3', ['-c', `
import sys, io, zipfile, json, base64
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    assert archive.testzip() is None
    print(json.dumps([{'path': info.filename, 'method': info.compress_type,
        'crc': info.CRC, 'flags': info.flag_bits, 'directory': info.is_dir(),
        'data': base64.b64encode(archive.read(info)).decode('ascii')}
        for info in archive.infolist()]))
`], { input: Buffer.from(await blob.arrayBuffer()), maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  return JSON.parse(result.stdout.toString());
}

test('Unicode, binary entries, CRC32, empty directories and custom MIME work in an independent ZIP reader',
  { skip: !hasPython && 'python3 is required for ZIP compatibility verification' }, async () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 255]);
    const blob = await createZipArchive([
      { path: '資料📁', directory: true },
      { path: '資料📁/空/', directory: true },
      file('資料📁/binary.bin', new Blob([bytes])),
      file('checksum.txt', () => new Blob(['123456789'])),
    ], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const entries = await readZip(blob);
    assert.deepEqual(entries.map(entry => entry.path), ['資料📁/', '資料📁/空/', '資料📁/binary.bin', 'checksum.txt']);
    assert.ok(entries.every(entry => entry.method === 0 && (entry.flags & 0x0800)));
    assert.ok(entries.slice(0, 2).every(entry => entry.directory));
    assert.deepEqual(Buffer.from(entries[2].data, 'base64'), Buffer.from(bytes));
    assert.equal(entries[3].crc, 0xcbf43926);
  });

test('an empty archive and unspecified dates have deterministic classic ZIP headers', async () => {
  const empty = await createZipArchive([]);
  assert.equal(empty.size, 22); assert.equal(empty.type, 'application/zip');
  for (const updatedAt of [undefined, 'invalid', '1970-01-01T00:00:00Z']) {
    const bytes = new DataView(await (await createZipArchive([{ ...file('file'), updatedAt }])).arrayBuffer());
    assert.equal(bytes.getUint16(10, true), 0); assert.equal(bytes.getUint16(12, true), 0x21);
  }
  const future = new DataView(await (await createZipArchive([{ ...file('file'), updatedAt: '2200-01-01T00:00:00Z' }])).arrayBuffer());
  assert.equal(future.getUint16(10, true), 0xbf7d); assert.equal(future.getUint16(12, true), 0xff9f);
});

test('synchronous and asynchronous iterables validate their complete path list before reading file content', async () => {
  const events = [];
  async function* entries() {
    events.push('first'); yield file('one.txt', () => { events.push('read one'); return new Blob(['one']); });
    await Promise.resolve(); events.push('second'); yield file('two.txt', async () => { events.push('read two'); return new Blob(['two']); });
    events.push('done');
  }
  await createZipArchive(entries());
  assert.deepEqual(events, ['first', 'second', 'done', 'read one', 'read two']);
  let reads = 0;
  function* invalid() { yield file('valid.txt', () => { reads++; return new Blob(); }); yield file('../escape'); }
  await assert.rejects(createZipArchive(invalid()), /相対パス/);
  assert.equal(reads, 0);
});

test('unsafe and noncanonical paths are rejected before any lazy reader runs', async () => {
  let reads = 0;
  for (const path of ['', '/root.txt', '\\root.txt', 'C:/root.txt', '//server/file', 'a\\b',
    '../file', 'a/../file', '.. /file', 'a/.. ./file', './file', 'a/./file', 'a//file', 'file/', 'a\0b', 'file:stream', 'a\nb', 'bad\ud800']) {
    await assert.rejects(createZipArchive([file('good', () => { reads++; return new Blob(); }), file(path)]));
  }
  assert.equal(reads, 0);
});

test('duplicates and file/directory ancestor conflicts are rejected in either order', async () => {
  for (const entries of [[file('a'), file('a')], [{ path: 'a', directory: true }, { path: 'a/', directory: true }],
    [file('a'), { path: 'a/', directory: true }], [file('a'), file('a/b')], [file('a/b'), file('a')]])
    await assert.rejects(createZipArchive(entries), /重複|競合/);
  // An explicit directory may be listed after its implicit parent was used.
  await assert.doesNotReject(createZipArchive([file('a/b'), { path: 'a', directory: true }]));
});

test('entry count and encoded path limits are checked without reading a Blob', async () => {
  let reads = 0;
  const content = () => { reads++; return new Blob(); };
  await assert.rejects(createZipArchive(Array.from({ length: 0xffff }, (_, index) => file(`${index}`, content))), /65,534/);
  await assert.rejects(createZipArchive([file('あ'.repeat(21846), content)]), /階層が深すぎる/);
  assert.equal(reads, 0);
});

test('ZIP64 sentinel sizes, invalid sizes and total overflow fail before allocating content buffers', async () => {
  class OversizedBlob extends Blob {
    constructor(size) { super(); this.reportedSize = size; }
    get size() { return this.reportedSize; }
    arrayBuffer() { assert.fail('size validation must precede allocation'); }
  }
  for (const size of [-1, 0.5, NaN, Infinity, 0xffffffff, 0xffffffff - 80, Number.MAX_SAFE_INTEGER])
    await assert.rejects(createZipArchive([file('oversized', new OversizedBlob(size))]), /4 GiB/);
});

test('failed readers, non-Blobs and inconsistent byte lengths reject the entire archive', async () => {
  await assert.rejects(createZipArchive([file('one'), file('two', () => { throw new Error('storage failed'); })]), /two.*storage failed/);
  await assert.rejects(createZipArchive([file('bad', () => undefined)]), /内容が返されません/);
  await assert.rejects(createZipArchive([file('bad', { size: 0, arrayBuffer: async () => new ArrayBuffer(0) })]), /内容が返されません/);
  class WrongLengthBlob extends Blob { arrayBuffer() { return Promise.resolve(new ArrayBuffer(1)); } }
  await assert.rejects(createZipArchive([file('wrong', new WrongLengthBlob(['1234']))]), /サイズを確認/);
  await assert.rejects(createZipArchive([{ path: 'directory', directory: true, content: new Blob() }]), /フォルダ/);
  await assert.rejects(createZipArchive(null), /反復可能/);
});

test('aborting a lazy read preserves its startup order and prevents subsequent buffers or reads', async () => {
  const controller = new AbortController();
  let reads = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  class UnreadBlob extends Blob { arrayBuffer() { assert.fail('cancelled read must not allocate'); } }
  const archive = createZipArchive([
    { path: 'dir', directory: true },
    file('dir/one', () => { reads++; return pending; }),
    file('dir/two', () => { reads++; return new Blob(); }),
  ], { signal: controller.signal });
  assert.equal(reads, 1);
  const rejected = assert.rejects(archive, { name: 'AbortError' });
  controller.abort(); release(new UnreadBlob(['one']));
  await rejected; assert.equal(reads, 1);
  await assert.rejects(createZipArchive([file('never', () => { reads++; return new Blob(); })], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(reads, 1);
});

test('aborting an async path enumeration closes it without starting file reads', async () => {
  const controller = new AbortController(); let closed = false, reads = 0;
  async function* entries() {
    try {
      yield file('one', () => { reads++; return new Blob(); });
      controller.abort(); yield file('two');
    } finally { closed = true; }
  }
  await assert.rejects(createZipArchive(entries(), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(closed, true); assert.equal(reads, 0);
});

test('cancellation wins when the current Blob buffer fails after the signal was aborted', async () => {
  const controller = new AbortController();
  class CancelledBlob extends Blob {
    arrayBuffer() { controller.abort(); return Promise.reject(new Error('read interrupted')); }
  }
  await assert.rejects(createZipArchive([file('interrupted', new CancelledBlob(['body']))], { signal: controller.signal }), { name: 'AbortError' });
});
