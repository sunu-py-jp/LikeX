import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';
import { build } from './helpers/build.mjs';

const built = await build({ entryPoints: [fileURLToPath(new URL('../src/model-entry.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'core-source', setup(build) { build.onResolve({ filter: /^@likex\/core(?:\/.*)?$/ }, ({ path }) => ({ path: fileURLToPath(new URL(`../../core/src/${path === '@likex/core' ? 'index' : path.slice('@likex/core/'.length)}.ts`, import.meta.url)) })); } }],
});
const { formatTextEditorSource: format, validateTextEditorSource: validate, createTextEditorModel: create,
  executeTextEditorCommands: execute, serializeTextEditorModel: serialize, TEXT_EDITOR_LIMITS: limits } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

test('JSON formatting keeps numeric lexemes, duplicate properties, order and string escapes', () => {
  const source = '{"large":9007199254740993123456789,"n":1.2300e+4,"n":-0,"s":"\\u0041\\/\\n"}';
  const expected = '{\n  "large": 9007199254740993123456789,\n  "n": 1.2300e+4,\n  "n": -0,\n  "s": "\\u0041\\/\\n"\n}';
  assert.deepEqual(format(source, { mode: 'json' }), { text: expected, changed: true, mode: 'json' });
  assert.equal(format(expected, { mode: 'json' }).changed, false);
  assert.deepEqual(validate(source, { mode: 'json' }), []);
  assert.equal(format('{"x":[1,{}]}', { fileName: 'data.JSON', mode: 'auto', indent: 4 }).text, '{\n    "x": [\n        1,\n        {}\n    ]\n}');
  assert.equal(format('{"x":1}\r\n', { mimeType: 'application/problem+json' }).text, '{\r\n  "x": 1\r\n}\r\n');
});

test('strict JSON diagnostics keep incomplete/invalid original source', () => {
  for (const source of ['', '{', '{"x":1,}', '[1,]', '{/*comment*/"x":1}', '{"x":NaN}', '{"x":01}', '{"x":"\\q"}', '{"x":1} false']) {
    const errors = validate(source, { mode: 'json' });
    assert.ok(errors.length, source); assert.match(errors[0].message, /JSON/);
    assert.deepEqual(format(source, { mode: 'json' }), { text: source, changed: false, mode: 'json' });
  }
  const source = '{\r\n "😀": 1 "x": 2\r\n}';
  const diagnostic = validate(source, { mode: 'json' })[0];
  assert.equal(diagnostic.from, source.indexOf('"x"'));
  assert.equal(diagnostic.line, 2); assert.equal(diagnostic.column, 10);
  assert.match(diagnostic.message, /カンマ/);
});

test('XML formatting preserves attributes, entities, mixed content, CDATA and xml:space subtrees', () => {
  const source = '<?xml version="1.0"?><root a=\'&quot;\'><empty /><child><v/></child><p> hello\n <b>world</b> ! </p><pre xml:space="preserve"><x>  </x><y/></pre><data><![CDATA[ x\n y ]]></data></root>';
  const result = format(source, { fileName: 'config.xml' });
  assert.equal(result.changed, true); assert.deepEqual(validate(result.text, { mode: 'xml' }), []);
  assert.ok(result.text.includes('<root a=\'&quot;\'>\n  <empty />\n  <child>\n    <v/>\n  </child>'));
  for (const unchanged of ['<p> hello\n <b>world</b> ! </p>', '<pre xml:space="preserve"><x>  </x><y/></pre>', '<data><![CDATA[ x\n y ]]></data>']) assert.ok(result.text.includes(unchanged), unchanged);
  assert.equal(format(result.text, { mode: 'xml' }).changed, false);
  const dtd = '<!DOCTYPE root [<!ENTITY hello "ignored">]><root><p>&hello;</p><x/></root>';
  assert.deepEqual(validate(dtd, { mode: 'xml' }), []);
  assert.match(format(dtd, { mode: 'xml' }).text, /<!DOCTYPE root \[<!ENTITY hello "ignored">\]>\n<root>/);
  const external = '<!DOCTYPE root SYSTEM "https://invalid.test/not-loaded.dtd"><root><x/></root>';
  assert.deepEqual(validate(external, { mode: 'xml' }), []);
  const encodedPreserve = '<root><pre xml:space="&#112;reserve"><a/><b/></pre></root>';
  assert.ok(format(encodedPreserve, { mode: 'xml' }).text.includes('<pre xml:space="&#112;reserve"><a/><b/></pre>'));
});

test('XML diagnostics cover common malformed constructs without repairing source', () => {
  for (const source of ['<a><b></a>', '<a>', '<a/><b/>', '<a x="1" x="2"/>', '<a x="missing/>', '<a x=foo/>', '<1root/>', '<a>&</a>', '<a>&unknown;</a>', '<a>&#0;</a>', '<a><!-- invalid -- comment --></a>', '<a x="<"/>', '<a x="<!DOCTYPE x>"/>', '<!doctype a><a/>', '<a/>outside', '<a/><!DOCTYPE a>', '<a/> <?xml version="1.0"?>', '<?xml version="1.0"?><?xml version="1.0"?><a/>']) {
    const errors = validate(source, { mode: 'xml' });
    assert.ok(errors.length, source); assert.match(errors[0].message, /XML/);
    assert.equal(format(source, { mode: 'xml' }).text, source);
  }
  const source = '<root>\r\n  <p>😀</p><x a="1" a="2"/>\r\n</root>';
  const diagnostic = validate(source, { mode: 'xml' })[0];
  assert.equal(diagnostic.from, source.indexOf('a="2"')); assert.equal(diagnostic.line, 2);
  assert.equal(diagnostic.column, diagnostic.from - source.indexOf('\n') );
});

test('YAML block indentation preserves comments, tags, aliases, numbers and document boundaries', () => {
  const source = '%TAG !e! tag:example.com,2024:\n---\n# header\na: &base\n    x: 99999999999999999999999 # keep\n    y: 1.2300e+4\nb: *base\nc: !e!example {one: 1,two: 2}\n...\n---\nroot:\n    list:\n        - name: abc\n          nested:\n              x: 1\n        - name: xyz\n';
  const result = format(source, { fileName: 'data.yml' });
  assert.equal(result.changed, true); assert.deepEqual(validate(result.text, { mode: 'yaml' }), []);
  for (const literal of ['%TAG !e! tag:example.com,2024:', '# header', '&base', '99999999999999999999999 # keep', '1.2300e+4', '*base', '!e!example {one: 1,two: 2}', '...\n---']) assert.ok(result.text.includes(literal), literal);
  assert.match(result.text, /a: &base\n  x:/);
  assert.match(result.text, /root:\n  list:\n    - name: abc\n      nested:\n        x: 1/);
  assert.equal(format(result.text, { mode: 'yaml' }).changed, false);
});

test('YAML scalar values survive indentation changes including explicit block indicators and folded strings', () => {
  const source = 'root:\r\n    literal: |2-\r\n      hello\r\n        world\r\n    folded: >-\r\n      first\r\n      second\r\n    quoted: "a\r\n      b"\r\n    plain: some\r\n      words\r\n';
  const result = format(source, { mode: 'yaml' });
  assert.equal(result.changed, true);
  assert.ok(result.text.includes('  literal: |2-\r\n    hello\r\n      world'));
  assert.deepEqual(parseAllDocuments(result.text).map(doc => doc.toJS()), parseAllDocuments(source).map(doc => doc.toJS()));
  assert.equal(result.text.replaceAll('\r\n', '').includes('\n'), false);
  const complex = '? [a, b]\n: {c: d}\n';
  assert.equal(format(complex, { mode: 'yaml' }).text, complex);
});

test('YAML invalid indentation, malformed flow and duplicate scalar keys report positions', () => {
  for (const source of ['x:\n\tbad: 1', 'a: [1, 2', 'a:\n  b: 1\n c: 2\n', 'a: 1\na: 2\n']) {
    const errors = validate(source, { mode: 'yaml' }); assert.ok(errors.length, source);
    assert.equal(format(source, { mode: 'yaml' }).text, source);
  }
  const source = 'ok: 😀\r\nlist: [1, 2';
  const diagnostic = validate(source, { mode: 'yaml' })[0];
  assert.equal(diagnostic.line, 2); assert.equal(diagnostic.column, diagnostic.from - source.indexOf('\n'));
});

test('auto formatting shares mode priority and keeps plain/Markdown source unchanged', () => {
  const source = '{"x":1}';
  assert.equal(format(source, { mode: 'text', fileName: 'x.json' }).changed, false);
  assert.equal(format(source, { fileName: 'x.txt', mimeType: 'application/json' }).mode, 'json');
  assert.equal(format(source, { fallbackMode: 'json' }).changed, true);
  for (const mode of ['text', 'markdown']) { assert.deepEqual(validate(source, { mode }), []); assert.equal(format(source, { mode }).text, source); }
  for (const indent of [0, 9, 1.5, null, '2']) assert.throws(() => format(source, { mode: 'json', indent }), /インデント/);
  assert.throws(() => format(source, { get indent() { throw new Error('must not execute'); } }), /getter/);
});

test('text.format uses model mode, preserves identity and mode, and rolls back invalid batches', () => {
  const initial = create({ id: 'format-command', mode: 'json', text: '{"x":1}' });
  const saved = serialize(initial), next = execute(initial, { type: 'text.format', indent: 4 });
  assert.equal(next.text, '{\n    "x": 1\n}'); assert.equal(next.mode, 'json'); assert.equal(next.id, initial.id);
  assert.equal(execute(next, { type: 'text.format', indent: 4 }), next);
  assert.equal(serialize(initial), saved);
  const plain = create({ mode: 'text', text: initial.text });
  assert.equal(execute(plain, { type: 'text.format', mode: 'json' }).mode, 'text');
  assert.throws(() => execute(initial, [{ type: 'text.set', text: '{"x":}' }, { type: 'text.format' }]), /JSON構文エラー/);
  assert.equal(serialize(initial), saved);
  assert.throws(() => execute(initial, { type: 'text.format', mode: 'auto' }), /整形モード/);
});

test('formatting guards excessive depth and output growth without lowering the input-size limit', () => {
  for (const [mode, source] of [['json', '['.repeat(300) + '0' + ']'.repeat(300)], ['xml', '<a>'.repeat(300) + '</a>'.repeat(300)], ['yaml', '['.repeat(300) + '0' + ']'.repeat(300)]]) {
    assert.match(validate(source, { mode })[0].message, /深すぎ/);
    assert.equal(format(source, { mode }).text, source);
  }
  const large = '"' + 'x'.repeat(limits.textLength - 2) + '"';
  assert.equal(format(large, { mode: 'json' }).text.length, limits.textLength);
  const nearLimit = '{"x":"' + 'x'.repeat(limits.textLength - 8) + '"}';
  assert.equal(nearLimit.length, limits.textLength);
  assert.throws(() => format(nearLimit, { mode: 'json' }), /文字数上限/);
});
