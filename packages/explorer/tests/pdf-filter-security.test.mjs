import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { packageRoot } from './test-paths.mjs';

const bundle = await build({ absWorkingDir: packageRoot, stdin: { resolveDir: packageRoot, contents: `
  export { decodePdfStream } from './src/inspection/pdf-filters.ts';
  export { PdfBudget } from './src/inspection/pdf-budget.ts';
  export { EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS } from './src/model/pdf-inspection-limits.ts';
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { decodePdfStream, PdfBudget, EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS: defaults } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const smallLimits = { streamBytes: 4096, decodedBytes: 16384 };
const name = value => ({ kind: 'name', value });
const params = value => new Map(Object.entries(value));
const dictionary = (filter, options) => new Map([
  ...(filter === undefined ? [] : [['Filter', Array.isArray(filter) ? filter.map(name) : name(filter)]]),
  ...(options === undefined ? [] : [['DecodeParms', Array.isArray(options) ? options.map(x => x && params(x)) : params(options)]]),
]);
const bytes = value => new TextEncoder().encode(value);
const budget = (signal, limits) => new PdfBudget(signal ?? new AbortController().signal, limits);
const decode = (data, filter, options, resource = budget()) => decodePdfStream(data, dictionary(filter, options), resource);

function codeBits(codes, widths = codes.map(() => 9)) {
  let value = 0, held = 0;
  const result = [];
  for (let i = 0; i < codes.length; i++) {
    value = value * 2 ** widths[i] + codes[i]; held += widths[i];
    while (held >= 8) { held -= 8; result.push(Math.floor(value / 2 ** held) & 255); }
    value &= (1 << held) - 1;
  }
  if (held) result.push(value << (8 - held));
  return Uint8Array.from(result);
}

test('PDF metadata filters decode common forms and chains', async () => {
  assert.deepEqual(await decode(bytes('plain')), bytes('plain'));
  assert.deepEqual(await decode(deflateSync(bytes('hello')), 'FlateDecode'), bytes('hello'));
  assert.deepEqual(await decode(bytes('61 62\n6>'), 'ASCIIHexDecode'), bytes('ab`'));
  assert.deepEqual(await decode(bytes('87cURD_*#TDfTZ)+T~>'), 'ASCII85Decode'), bytes('Hello, world!'));
  assert.deepEqual(await decode(bytes('z~>'), 'ASCII85Decode'), new Uint8Array(4));
  assert.deepEqual(await decode(Uint8Array.of(2, 65, 66, 67, 254, 90, 128), 'RunLengthDecode'), bytes('ABCZZZ'));
  assert.deepEqual(await decode(codeBits([256, 65, 66, 67, 257]), 'LZWDecode'), bytes('ABC'));
  assert.deepEqual(await decode(codeBits([256, 65, 258, 257]), 'LZWDecode'), bytes('AAA'));
  const compressed = deflateSync(bytes('chained'));
  assert.deepEqual(await decode(bytes(Buffer.from(compressed).toString('hex') + '>'), ['ASCIIHexDecode', 'FlateDecode']), bytes('chained'));
});

test('LZW switches code widths with both EarlyChange settings and resets its dictionary', async () => {
  for (const early of [0, 1]) {
    // Clear + 300 literal bytes: code widths change before literal index 254
    // for EarlyChange=1 and before index 255 for EarlyChange=0.
    const values = Array.from({ length: 300 }, (_, i) => i % 256);
    const widths = [9, ...values.map((_, i) => i < 255 - early ? 9 : 10), 10, 9, 9];
    const encoded = codeBits([256, ...values, 256, 90, 257], widths);
    assert.deepEqual(await decode(encoded, 'LZWDecode', { EarlyChange: early }), Uint8Array.from([...values, 90]));
  }
});

test('PNG predictors handle None, Sub, Up, Average and Paeth over multiple rows', async () => {
  const encoded = Uint8Array.of(
    0, 10, 20, 30,
    1, 10, 10, 10,
    2, 1, 2, 3,
    3, 15, 9, 9,
    4, 1, 2, 3,
  );
  assert.deepEqual(await decode(deflateSync(encoded), 'FlateDecode', { Predictor: 15, Columns: 3 }),
    Uint8Array.of(10, 20, 30, 10, 20, 30, 11, 22, 33, 20, 30, 40, 21, 32, 43));
  const rgb = Uint8Array.of(1, 10, 20, 30, 1, 2, 3);
  assert.deepEqual(await decode(deflateSync(rgb), 'FlateDecode', { Predictor: 11, Colors: 3, Columns: 2 }),
    Uint8Array.of(10, 20, 30, 11, 22, 33));
});

test('TIFF predictor supports packed samples and 16-bit channels', async () => {
  for (const [encoded, options, expected] of [
    [[10, 10, 10], { Columns: 3 }, [10, 20, 30]],
    [[0xd0], { Columns: 4, BitsPerComponent: 1 }, [0x90]],
    [[0x12, 0x22, 0x22], { Columns: 3, Colors: 2, BitsPerComponent: 4 }, [0x12, 0x34, 0x56]],
    [[0, 255, 0, 2, 255, 255], { Columns: 3, BitsPerComponent: 16 }, [0, 255, 1, 1, 1, 0]],
  ]) {
    assert.deepEqual(await decode(deflateSync(Uint8Array.from(encoded)), 'FlateDecode', { Predictor: 2, ...options }), Uint8Array.from(expected));
  }
});

test('PDF filters reject truncated, malformed and unsupported encodings', async () => {
  const compressed = deflateSync(bytes('checksum'));
  const corrupt = Uint8Array.from(compressed); corrupt[corrupt.length - 1] ^= 1;
  for (const [value, filter, options] of [
    [compressed.subarray(0, compressed.length - 1), 'FlateDecode'],
    [corrupt, 'FlateDecode'], [Buffer.concat([compressed, Buffer.from([0])]), 'FlateDecode'],
    [bytes('ab'), 'ASCIIHexDecode'], [bytes('gh>'), 'ASCIIHexDecode'], [bytes('61>x'), 'ASCIIHexDecode'],
    [bytes('!~>'), 'ASCII85Decode'], [bytes('uuuuu~>'), 'ASCII85Decode'], [bytes('!z~>'), 'ASCII85Decode'],
    [bytes('87cUR'), 'ASCII85Decode'], [bytes('~x'), 'ASCII85Decode'],
    [Uint8Array.of(3, 65), 'RunLengthDecode'], [Uint8Array.of(129), 'RunLengthDecode'],
    [Uint8Array.of(0, 65), 'RunLengthDecode'],
    [codeBits([256, 65]), 'LZWDecode'], [codeBits([256, 300, 257]), 'LZWDecode'],
    [codeBits([256, 65, 257]), 'LZWDecode', { EarlyChange: 2 }],
    [bytes('x'), 'Crypt'],
    [deflateSync(Uint8Array.of(5, 1)), 'FlateDecode', { Predictor: 15 }],
    [deflateSync(Uint8Array.of(0, 1)), 'FlateDecode', { Predictor: 15, Columns: 2 }],
    [compressed, 'FlateDecode', { Predictor: 3 }],
    [compressed, 'FlateDecode', { Predictor: 2, BitsPerComponent: 3 }],
    [compressed, 'FlateDecode', { Predictor: 2, Colors: 0 }],
    [compressed, 'FlateDecode', { Predictor: 2, Colors: 16_000_000, Columns: 16_000_000 }],
  ]) await assert.rejects(decode(value, filter, options), /PDF/);
});

test('filter chains validate arity and bound every intermediate expansion', async () => {
  await assert.rejects(decode(bytes('61>'), ['ASCIIHexDecode'], [{}, {}]), /PDF/);
  await assert.rejects(decode(bytes('61>'), ['ASCIIHexDecode'], {}), /PDF/);
  await assert.rejects(decode(bytes('61>'), Array(defaults.filters + 1).fill('ASCIIHexDecode')), /PDF/);
  // Its final ASCIIHex output would fit, but the preceding Flate result does not.
  const bomb = deflateSync(Buffer.alloc(smallLimits.streamBytes + 1024, 65));
  await assert.rejects(decode(bomb, ['FlateDecode', 'ASCIIHexDecode'], undefined, budget(undefined, smallLimits)), /上限/);
});

test('unfiltered metadata and aggregate decoded bytes are bounded', async () => {
  await assert.rejects(decode(new Uint8Array(smallLimits.streamBytes + 1), undefined, undefined, budget(undefined, smallLimits)), /上限/);
  const resource = budget(undefined, smallLimits), chunk = new Uint8Array(smallLimits.streamBytes);
  for (let i = 0; i < 4; i++) assert.equal(await decode(chunk, undefined, undefined, resource), chunk);
  await assert.rejects(decode(Uint8Array.of(1), undefined, undefined, resource), /上限/);
});

test('budget rejection occurs before retaining a decompressed chunk', async () => {
  class RejectingBudget extends PdfBudget {
    decodedBytes(size) { if (size) throw new Error('stop-before-retention'); }
  }
  await assert.rejects(decode(deflateSync(Buffer.alloc(1024)), 'FlateDecode', undefined, new RejectingBudget(new AbortController().signal)), /stop-before-retention/);
});

test('predictor output and all filter-chain stages consume the shared decoded budget', async () => {
  class RecordingBudget extends PdfBudget {
    amounts = [];
    decodedBytes(size) { super.decodedBytes(size); if (size) this.amounts.push(size); }
  }
  const resource = new RecordingBudget(new AbortController().signal);
  const compressed = deflateSync(Uint8Array.of(0, 10, 20, 30));
  await decode(bytes(Buffer.from(compressed).toString('hex') + '>'), ['ASCIIHexDecode', 'FlateDecode'],
    [null, { Predictor: 15, Columns: 3 }], resource);
  assert.deepEqual(resource.amounts, [compressed.length, 4, 3]);
});

test('RunLength expansion rejects before exceeding the metadata stream cap', async () => {
  const encoded = new Uint8Array((smallLimits.streamBytes / 128 + 1) * 2 + 1);
  for (let i = 0; i < encoded.length - 1; i += 2) { encoded[i] = 129; encoded[i + 1] = 65; }
  encoded[encoded.length - 1] = 128;
  await assert.rejects(decode(encoded, 'RunLengthDecode', undefined, budget(undefined, smallLimits)), /上限/);
});

test('large expansion yields to and obeys cancellation', async () => {
  const controller = new AbortController();
  const compressed = deflateSync(Buffer.alloc(4 * 1024 * 1024));
  setTimeout(() => controller.abort(new Error('cancelled-filter')), 0);
  await assert.rejects(decode(compressed, 'FlateDecode', undefined, budget(controller.signal)), /cancelled-filter/);
  const already = new AbortController(); already.abort();
  await assert.rejects(decode(bytes('plain'), undefined, undefined, budget(already.signal)), { name: 'AbortError' });
});
