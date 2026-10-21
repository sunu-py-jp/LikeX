import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { resolveDir: new URL('../src', import.meta.url).pathname, contents: `
  export { parseXmlStream } from './ooxml/xml-stream.ts';
  export { parseXml } from './ooxml/xml.ts';
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { parseXmlStream, parseXml } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const utf8 = value => new TextEncoder().encode(value);
async function* chunks(bytes, size = 7) {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
}
const parse = (value, options, size) => parseXmlStream(chunks(utf8(value), size), options);
const invalid = /XMLが不正|読み込み上限/;

test('streamed XML agrees with the existing parser across every UTF-8 token boundary', async () => {
  const xml = '<?xml version="1.0"?>\r\n<root xmlns:x="urn:test" label="日&amp;本&#x1f600;">\r\n' +
    '<!--comment--><x:c id=\'quoted > value\'>日&#13;&#10;&lt;&gt;&quot;&apos;😀</x:c>\r' +
    '<![CDATA[raw <x> & 日本\r\n]]><?next value?><empty /> tail</root>\r\n';
  const bytes = utf8(xml), expected = parseXml(bytes);
  for (const size of [1, 2, 3, 4, 7, 17, 65_536]) {
    assert.deepEqual(await parseXmlStream(chunks(bytes, size)), expected, `chunk size ${size}`);
  }
});

test('UTF-8 and UTF-16 BOMs, code units, and CRLF can all span chunks', async () => {
  const source = '<?xml version="1.0"?><root a="日本">\r\n😀\rあ\r\n</root>';
  const littleEndian = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, 'utf16le')]);
  const bigEndian = Buffer.from(littleEndian);
  bigEndian.swap16();
  const bom8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(source)]);
  for (const bytes of [littleEndian, bigEndian, bom8]) {
    for (const size of [1, 3, 11]) assert.deepEqual(await parseXmlStream(chunks(bytes, size)), parseXml(bytes));
  }
});

test('completed subtrees can be discarded within a separate live-tree budget', async () => {
  const source = '<worksheet><sheetData>' + '<row><c><v>123</v></c></row>'.repeat(2000) + '</sheetData><keep/></worksheet>';
  let cells = 0, rows = 0;
  const root = await parse(source, {
    limits: { xmlNodes: 7000, retainedNodes: 6 },
    onElement(node, parent, ancestors) {
      if (node.name === 'c') {
        assert.equal(node.children[0].text, '123');
        assert.equal(parent.name, 'row');
        assert.deepEqual(ancestors.map(item => item.name), ['worksheet', 'sheetData', 'row']);
        cells++;
        return false;
      }
      if (node.name === 'row') { assert.equal(node.children.length, 0); rows++; return false; }
    },
  }, 1024);
  assert.equal(cells, 2000); assert.equal(rows, 2000);
  assert.deepEqual(root.children.map(node => node.name), ['sheetData', 'keep']);
  assert.equal(root.children[0].children.length, 0);
});

test('consumers can normalize attributes before retaining or discarding siblings', async () => {
  let column = 0;
  const root = await parse('<root><row><c/><c/></row></root>', {
    limits: { xmlText: 0 },
    onElement(node, parent) {
      if (node.name !== 'c') return;
      parent.attributes.r = '1';
      node.attributes.r = `${++column}1`;
      if (column === 1) return false;
    },
  });
  assert.equal(root.children[0].attributes.r, '1');
  assert.equal(root.children[0].children.length, 1);
  assert.equal(root.children[0].children[0].attributes.r, '21');
});

test('discarding elements does not bypass byte, text, visited-node, depth, or token budgets', async () => {
  const skip = { onElement: node => node.name === 'root' ? undefined : false };
  await assert.rejects(parse('<root><drop/><drop/></root>', { ...skip, limits: { xmlNodes: 2 } }), invalid);
  await assert.rejects(parse('<root><drop>abcdef</drop></root>', { ...skip, limits: { xmlText: 5 } }), invalid);
  await assert.rejects(parse('<root><drop><nested/></drop></root>', { ...skip, limits: { xmlDepth: 2 } }), invalid);
  await assert.rejects(parse('<root><drop/></root>', { ...skip, limits: { xmlBytes: 8 } }), invalid);
  await assert.rejects(parse('<root><!--xxxxxxxx--></root>', { ...skip, limits: { tokenCharacters: 12 } }), invalid);
  await assert.rejects(parse('<root><keep/><keep/></root>', { limits: { retainedNodes: 2 } }), invalid);
  await assert.rejects(parse('<root/>', { limits: { xmlNodes: Infinity } }), invalid);
  await assert.rejects(parse('<root/>', { limits: { xmlBytes: -1 } }), invalid);
  await assert.rejects(parse('<root/>', { onElement: () => false }), invalid);
});

test('skipped subtrees still reject malformed markup, entities, DTDs, and illegal characters', async () => {
  const bodies = [
    '<drop><x></drop>', '<drop a="1" a="2"/>', '<drop a="&unknown;"/>', '<drop>&#0;</drop>',
    '<drop>&#xD800;</drop>', '<drop>&#x110000;</drop>', '<drop>&unfinished</drop>',
    '<drop><![CDATA[unfinished</drop>', '<drop><!--bad--comment--></drop>', '<drop>]]></drop>',
    '<drop><!DOCTYPE x></drop>', '<drop a="<"/>', '<drop a="value"b="other"/>', '<drop>\u0001</drop>',
    '<drop><?xml version="1.0"?></drop>', '<drop></drop extra>', '<drop/ extra>',
  ];
  for (const body of bodies) {
    await assert.rejects(parse(`<root>${body}</root>`, { onElement: node => node.name === 'drop' ? false : undefined }, 1), invalid, body);
  }
  for (const source of ['', '<root>', '<root/><extra/>', 'outside<root/>', '<!DOCTYPE root><root/>', '<root/>outside']) {
    await assert.rejects(parse(source, undefined, 1), invalid, source);
  }
  await assert.rejects(parseXmlStream(chunks(new Uint8Array([60, 114, 62, 0xff, 60, 47, 114, 62]), 1)), invalid);
  await assert.rejects(parseXmlStream(chunks(new Uint8Array([0xff, 0xfe, 60]), 1)), invalid);
});

test('attribute limit remains bounded on streamed XML', async () => {
  const attributes = Array.from({ length: 101 }, (_, index) => `a${index}="value"`).join(' ');
  await assert.rejects(parse(`<root ${attributes}/>`, undefined, 3), invalid);
});

test('abort interrupts a stalled producer and observes its later rejection', async () => {
  const controller = new AbortController();
  let started, rejectPending, returned = false;
  const ready = new Promise(resolve => { started = resolve; });
  const stream = {
    [Symbol.asyncIterator]() { return this; },
    next() { started(); return new Promise((_resolve, reject) => { rejectPending = reject; }); },
    return() { returned = true; return Promise.resolve({ done: true }); },
  };
  const operation = parseXmlStream(stream, { signal: controller.signal });
  await ready;
  const rejected = assert.rejects(operation, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(returned, true);
  rejectPending(new Error('late producer failure'));
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('large single chunks yield to the event loop and can be cancelled before completion', async () => {
  const controller = new AbortController();
  let count = 0;
  const source = utf8('<root>' + '<drop/>'.repeat(200_000) + '</root>');
  const operation = parseXmlStream(chunks(source, source.length), {
    signal: controller.signal,
    onElement(node) { if (node.name === 'drop') { count++; return false; } },
  });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(operation, { name: 'AbortError' });
  assert.ok(count > 0 && count < 200_000, `processed ${count} elements`);
});

test('callback errors close the source and are not rewritten as syntax errors', async () => {
  let closed = false;
  async function* source() {
    try { yield utf8('<root><drop/></root>'); }
    finally { closed = true; }
  }
  await assert.rejects(parseXmlStream(source(), { onElement() { throw new Error('consumer failed'); } }), /consumer failed/);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(closed, true);
});
