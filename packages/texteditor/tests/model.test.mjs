import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/model-entry.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'core-source', setup(build) { build.onResolve({ filter: /^@likex\/core(?:\/.*)?$/ }, ({ path }) => ({ path: fileURLToPath(new URL(`../../core/src/${path === '@likex/core' ? 'index' : path.slice('@likex/core/'.length)}.ts`, import.meta.url)) })); } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { createTextEditorModel: create, executeTextEditorCommands: execute, normalizeTextEditorModel: normalize, serializeTextEditorModel: serialize, parseTextEditorModel: parse, findTextEditorMatches: find, importTextEditorText: importText, exportTextEditorText: exportText, TEXT_EDITOR_LIMITS: limits } = api;

test('native source import, mode switches and JSON roundtrips retain exact whitespace and stable IDs', () => {
  const source = '# 見出し\r\n\r\n  * 項目  \r\n<!-- literal -->\r\n';
  const initial = importText(source, { id: 'notes', title: 'Notes', mode: 'markdown' });
  assert.equal(exportText(initial), source);
  assert.equal(serialize(parse(serialize(initial))), serialize(initial));
  const next = execute(initial, { type: 'document.update', mode: 'text', title: 'Plain' });
  assert.equal(next.text, source); assert.equal(next.id, 'notes'); assert.equal(next.title, 'Plain');
  assert.equal(initial.title, 'Notes'); assert.ok(Object.isFrozen(initial));
  assert.equal(normalize(initial), initial);
});

test('range edits use UTF-16 offsets, insert at the end and keep input unchanged', () => {
  const initial = create({ text: 'A😀B\r\nC' });
  const next = execute(initial, [{ type: 'text.replaceRange', from: 1, to: 3, text: '日本' }, { type: 'text.insert', offset: 7, text: '!' }]);
  assert.equal(next.text, 'A日本B\r\nC!'); assert.equal(initial.text, 'A😀B\r\nC');
  assert.equal(execute(initial, { type: 'text.set', text: '' }).text, '');
});

test('multi-range edits share the original source positions and accept unsorted disjoint ranges', () => {
  const initial = create({ text: 'A😀B\r\nC' });
  const edits = [{ from: 7, to: 7, text: '!' }, { from: 1, to: 3, text: '日本語' }, { from: 6, to: 7, text: 'end' }];
  const next = execute(initial, { type: 'text.replaceRanges', edits });
  assert.equal(next.text, 'A日本語B\r\nend!');
  assert.equal(initial.text, 'A😀B\r\nC');
  assert.equal(edits[0].from, 7); // The caller's order is untouched.
  assert.equal(execute(initial, { type: 'text.replaceRanges', edits: [] }).text, initial.text);
  assert.equal(execute(create({ text: 'abc' }), { type: 'text.replaceRanges', edits: [{ from: 0, to: 1, text: 'A' }, { from: 1, to: 2, text: 'B' }] }).text, 'ABc');
});

test('multi-range edits reject ambiguous/hostile ranges and fail atomically', () => {
  const initial = create({ text: 'original' }), saved = serialize(initial);
  const badEdits = [
    [{ from: 0, to: 4, text: 'a' }, { from: 3, to: 5, text: 'b' }],
    [{ from: 0, to: 0, text: 'a' }, { from: 0, to: 0, text: 'b' }],
    [{ from: 0, to: 0, text: 'a' }, { from: 0, to: 2, text: 'b' }],
    [{ from: 0, to: 4, text: 'a' }, { from: 2, to: 2, text: 'b' }],
    [{ from: 5, to: 2, text: 'a' }], [{ from: 0, to: 99, text: 'a' }],
    [{ from: 0, to: 2, text: 'a', unknown: true }],
    new Array(1), Array.from({ length: limits.commands + 1 }, () => ({ from: 0, to: 0, text: '' })),
  ];
  for (const edits of badEdits) assert.throws(() => execute(initial, [{ type: 'document.update', title: 'partial' }, { type: 'text.replaceRanges', edits }]));
  let reads = 0;
  assert.throws(() => execute(initial, { type: 'text.replaceRanges', edits: [{ from: 0, to: 1, get text() { reads++; return 'bad'; } }] }), /getter/);
  assert.equal(reads, 0); assert.equal(serialize(initial), saved);
  const full = create({ text: 'x'.repeat(limits.textLength) });
  assert.throws(() => execute(full, { type: 'text.replaceRanges', edits: [{ from: 0, to: 0, text: 'x' }] }), /文字数上限/);
  // Validate the final size, allowing a later deletion to balance an insertion.
  assert.equal(execute(full, { type: 'text.replaceRanges', edits: [{ from: 0, to: 0, text: 'a' }, { from: 1, to: 2, text: '' }] }).text.length, limits.textLength);
});

test('Markdown model commands use discoverable rich positions for formatting and tasks', () => {
  const initial = create({ mode: 'markdown', text: '# Title\n\nAlpha beta\n\n- [ ] Pending\n- [x] Done' });
  const blocks = api.getTextEditorMarkdownBlocks(initial);
  const title = blocks.find(block => block.type === 'heading');
  const paragraph = blocks.find(block => block.type === 'paragraph' && block.text === 'Alpha beta');
  const task = blocks.find(block => block.checked === false);
  assert.equal(title.level, 1); assert.ok(Object.isFrozen(blocks)); assert.ok(Object.isFrozen(task));
  assert.equal(api.parseMarkdownDocument(initial.text).nodeAt(task.position).type.name, 'list_item');
  const next = execute(initial, [
    { type: 'markdown.format', selection: { from: paragraph.from, to: paragraph.from + 5 }, action: 'markdown.bold' },
    { type: 'markdown.toggleTask', position: task.position },
  ]);
  assert.match(next.text, /\*\*Alpha\*\* beta/);
  assert.match(next.text, /\[x\] Pending/);
  assert.match(initial.text, /\[ \] Pending/);
  const linked = execute(create({ mode: 'markdown', text: 'Link' }), { type: 'markdown.format', selection: { from: 1, to: 5 }, action: 'markdown.link', options: { href: 'https://example.com', title: 'Example' } });
  assert.equal(linked.text, '[Link](https://example.com "Example")');
  assert.equal(execute(linked, { type: 'markdown.format', selection: { from: 1, to: 5 }, action: 'markdown.link', options: { href: '' } }).text, 'Link');
});

test('explicit Markdown commands interpret source independently of the preferred display mode', () => {
  const initial = create({ mode: 'text', text: 'Heading\n\n- [ ] Pending' });
  const blocks = api.getTextEditorMarkdownBlocks(initial);
  const paragraph = blocks.find(block => block.type === 'paragraph' && block.text === 'Heading');
  const task = blocks.find(block => block.checked === false);
  assert.deepEqual(blocks, api.getTextEditorMarkdownBlocks(initial.text));
  const next = execute(initial, [
    { type: 'markdown.format', selection: { from: paragraph.from, to: paragraph.to }, action: 'markdown.heading2' },
    { type: 'markdown.toggleTask', position: task.position },
  ]);
  assert.equal(next.text, '## Heading\n\n* [x] Pending');
  assert.equal(next.mode, 'text');
  assert.equal(initial.text, 'Heading\n\n- [ ] Pending');
  assert.equal(initial.mode, 'text');
});

test('Markdown command validation protects unsupported source and batch atomicity', () => {
  const initial = create({ mode: 'markdown', text: '##   Title\n' });
  const command = { type: 'markdown.format', selection: { from: 1, to: 1 }, action: 'markdown.heading2' };
  assert.equal(execute(initial, command).text, initial.text);
  assert.throws(() => execute(initial, { ...command, action: 'markdown.bad' }), /未対応/);
  assert.throws(() => execute(initial, { ...command, options: { href: 'https://example.com' } }), /リンク操作/);
  assert.throws(() => execute(initial, { type: 'markdown.toggleTask', position: -1 }), /文字位置/);
  assert.throws(() => execute(initial, { type: 'markdown.toggleTask', position: 0 }), /チェックリスト/);
  const saved = serialize(initial);
  assert.throws(() => execute(initial, [{ type: 'text.set', text: 'temporary' }, { ...command, selection: { from: 1, to: 100 } }]), /文字位置/);
  assert.equal(serialize(initial), saved);
  const unsupported = create({ mode: 'markdown', text: '<div>literal</div>' });
  assert.throws(() => execute(unsupported, command), /ソースモード/);
  assert.throws(() => execute(unsupported, { type: 'markdown.toggleTask', position: 1 }), /ソースモード/);
  assert.throws(() => api.getTextEditorMarkdownBlocks(unsupported), /ソースモード/);
});

test('Markdown serialization expansion respects the same source size bound', () => {
  const initial = create({ mode: 'markdown', text: 'a'.repeat(limits.textLength) });
  assert.throws(() => execute(initial, { type: 'markdown.format', selection: { from: 1, to: 2 }, action: 'markdown.bold' }), /10,000,000文字/);
  assert.equal(initial.text.length, limits.textLength);
  assert.equal(initial.text[0], 'a');
});

test('invalid batches are atomic, including an invalid later range or replacement expansion', () => {
  const initial = create({ text: 'original' });
  const saved = serialize(initial);
  assert.throws(() => execute(initial, [{ type: 'text.set', text: 'partial' }, { type: 'text.replaceRange', from: 6, to: 2, text: 'bad' }]), /開始位置/);
  assert.throws(() => execute(initial, [{ type: 'document.update', title: 'changed' }, { type: 'text.insert', offset: -1, text: 'bad' }]), /文字位置/);
  const full = create({ text: 'x'.repeat(limits.textLength) });
  assert.throws(() => execute(full, { type: 'text.insert', offset: 0, text: 'x' }), /文字数上限/);
  assert.throws(() => execute(create({ text: 'aa' }), { type: 'text.replaceAll', query: 'a', replacement: 'x'.repeat(limits.textLength) }), /文字数上限/);
  assert.equal(serialize(initial), saved); assert.equal(full.text.length, limits.textLength);
});

test('literal search retains Unicode offsets, escapes syntax and supports exact case and whole words', () => {
  assert.deepEqual(find('😀 A+B a+b', { query: 'a+b' }), [{ from: 3, to: 6 }, { from: 7, to: 10 }]);
  assert.deepEqual(find('😀 A+B a+b', { query: 'a+b', caseSensitive: true }), [{ from: 7, to: 10 }]);
  assert.deepEqual(find('猫 猫目 x猫 猫_ 😀猫', { query: '猫', wholeWord: true }), [{ from: 0, to: 1 }, { from: 13, to: 14 }]);
  assert.deepEqual(find('k K', { query: 'k' }), [{ from: 0, to: 1 }, { from: 2, to: 3 }]);
  assert.deepEqual(find('x\u0301 x', { query: 'x', wholeWord: true }), [{ from: 3, to: 4 }]);
  assert.deepEqual(find('𐐀x x', { query: 'x', wholeWord: true }), [{ from: 4, to: 5 }]);
});

test('RE2 search and replacement support multiline and zero-width Unicode positions safely', () => {
  assert.deepEqual(find('😀\r\nsecond\nthird', { query: '(?m)^second$', regex: true }), [{ from: 4, to: 10 }]);
  assert.deepEqual(find('😀', { query: '^|$', regex: true }), [{ from: 0, to: 0 }, { from: 2, to: 2 }]);
  assert.equal(execute(create({ text: '😀' }), { type: 'text.replaceAll', query: '^|$', regex: true, replacement: '-' }).text, '-😀-');
  assert.equal(execute(create({ text: 'aa' }), { type: 'text.replaceAll', query: '(a)', regex: true, replacement: '$1$&' }).text, '$1$&$1$&');
  assert.throws(() => find('aaa', { query: '(?<=a)a', regex: true }), /RE2/);
  assert.throws(() => find('aaa', { query: '(a)\\1', regex: true }), /RE2/);
  assert.throws(() => find('aaa', { query: '(?:a{1000}){1000}', regex: true }), /正規表現/);
});

test('whole word replacement skips adjacent identifiers and preserves separators', () => {
  const initial = create({ text: 'foo foo foobar foo_ FOO' });
  assert.equal(execute(initial, { type: 'text.replaceAll', query: 'foo', replacement: 'bar', wholeWord: true }).text, 'bar bar foobar foo_ bar');
  assert.equal(execute(initial, { type: 'text.replaceAll', query: 'f.o', replacement: 'bar', wholeWord: true, regex: true, caseSensitive: true }).text, 'bar bar foobar foo_ FOO');
  assert.equal(execute(initial, { type: 'text.replaceAll', query: '', replacement: 'x' }).text, initial.text);
});

test('search results have an explicit count limit while replaceAll streams all results', () => {
  const initial = create({ text: 'a '.repeat(limits.matches + 1) });
  assert.throws(() => find(initial, { query: 'a' }), /一致件数/);
  assert.equal(find(initial, { query: 'a' }, limits.matches + 1).length, limits.matches + 1);
  assert.equal(execute(initial, { type: 'text.replaceAll', query: 'a', replacement: 'b', wholeWord: true }).text, 'b '.repeat(limits.matches + 1));
  assert.deepEqual(find('abc', { query: '' }, 0), []);
  assert.throws(() => find('abc', { query: 'a' }, -1), /上限/);
});

test('unknown formats, keys, NULs, oversized data and malformed commands are rejected', () => {
  const initial = create();
  assert.throws(() => normalize({ ...initial, version: 2 }), /version 1/);
  assert.throws(() => normalize({ ...initial, format: 'other' }), /version 1/);
  assert.throws(() => normalize({ ...initial, extra: true }), /未対応/);
  assert.throws(() => create({ mode: null }), /モード/);
  assert.throws(() => create({ text: 'a\0b' }), /NUL/);
  assert.throws(() => create({ text: 'a'.repeat(limits.textLength + 1) }), /文字列/);
  assert.throws(() => execute(initial, [{ type: 'text.set', text: 'a' }, , { type: 'text.set', text: 'b' }]), /空要素/);
  assert.throws(() => execute(initial, Array.from({ length: limits.commands + 1 }, () => ({ type: 'text.set', text: 'x' }))), /コマンド/);
  assert.throws(() => execute(initial, { type: 'text.set', text: 'a', arbitrary: true }), /未対応/);
  assert.throws(() => execute(initial, { type: 'made.up' }), /未対応/);
  assert.throws(() => find('text', { query: 't', regex: 'yes' }), /boolean/);
});

test('accessor-backed and symbol-keyed inputs are rejected without invoking getters', () => {
  let reads = 0;
  const hostile = { get text() { reads++; return 'hidden'; } };
  assert.throws(() => create(hostile), /getter/);
  const command = { type: 'text.set', get text() { reads++; return 'hidden'; } };
  assert.throws(() => execute(create(), command), /getter/);
  const list = []; Object.defineProperty(list, '0', { get() { reads++; return command; } });
  assert.throws(() => execute(create(), list), /データ/);
  assert.throws(() => create({ [Symbol('payload')]: 'ignored' }), /未対応/);
  assert.equal(reads, 0);
});

test('document replacement validates and detaches caller-owned data', () => {
  const raw = { format: 'likex.texteditor', version: 1, id: 'new', title: 'Imported', mode: 'markdown', text: '**hello**' };
  const next = execute(create({ id: 'old' }), { type: 'document.replace', document: raw });
  raw.text = 'changed'; assert.equal(next.text, '**hello**'); assert.equal(next.id, 'new');
  assert.equal(exportText(next), '**hello**'); assert.ok(Object.isFrozen(next));
});

test('byte decoding handles UTF-8, UTF-16 BOMs and Shift_JIS without DOM or whitespace changes', () => {
  const source = '日本\r\n文字\n';
  assert.equal(api.decodeTextEditorBytes(new TextEncoder().encode(source)), source);
  assert.equal(api.decodeTextEditorBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(source)])), source);
  assert.equal(api.decodeTextEditorBytes(new Uint8Array([0xff, 0xfe, 0xe5, 0x65, 0x2c, 0x67]).buffer), '日本');
  assert.equal(api.decodeTextEditorBytes(new Uint8Array([0xfe, 0xff, 0x65, 0xe5, 0x67, 0x2c])), '日本');
  assert.equal(api.decodeTextEditorBytes(new Uint8Array([0x93, 0xfa, 0x96, 0x7b])), '日本');
  assert.equal(api.decodeTextEditorBytes(new Uint8Array([0, 0x61, 0x62, 0]).subarray(1, 3)), 'ab');
  assert.equal(api.decodeTextEditorBytes(new ArrayBuffer(0)), '');
});

test('byte decoding respects explicit BOMs and rejects corruption, binary data and size excess', () => {
  assert.throws(() => api.decodeTextEditorBytes(new Uint8Array([0xff, 0xfe, 0x61])), TypeError);
  assert.throws(() => api.decodeTextEditorBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x93, 0xfa])), TypeError);
  assert.throws(() => api.decodeTextEditorBytes(new Uint8Array([0x81])), TypeError);
  assert.throws(() => api.decodeTextEditorBytes(new Uint8Array([0x61, 0, 0x62])), /NUL/);
  assert.throws(() => api.decodeTextEditorBytes(new Uint8Array(limits.fileBytes + 1)), /サイズ/);
  assert.throws(() => api.decodeTextEditorBytes(new TextEncoder().encode('a'.repeat(limits.textLength + 1))), /文字列/);
  assert.throws(() => api.decodeTextEditorBytes('not bytes'), /Uint8Array/);
});
