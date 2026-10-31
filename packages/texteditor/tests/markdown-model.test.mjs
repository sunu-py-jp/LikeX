import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers/build.mjs';
const output = await build({ entryPoints: [new URL('../src/markdown/index.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { parseMarkdownDocument: parse, serializeMarkdownDocument: serialize, applyMarkdownCommand: apply, getMarkdownCompatibilityWarnings: warnings, markdownSchema: schema, isSafeMarkdownUrl } = api;

test('CommonMark parsing and serializing are available without a browser', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const doc = parse('# Heading\n\nA **bold** and *italic* note.\n\n> quote\n\n```ts\nconst a = 1;\n```');
  assert.equal(doc.child(0).type.name, 'heading');
  assert.equal(doc.child(1).textContent, 'A bold and italic note.');
  assert.match(serialize(doc), /\*\*bold\*\*/);
  assert.deepEqual(parse(serialize(doc)).toJSON(), doc.toJSON());
});

test('headless formatting uses rich positions and leaves its source immutable', () => {
  const source = 'Alpha beta';
  assert.equal(apply(source, { from: 1, to: 6 }, 'markdown.bold').text, '**Alpha** beta');
  assert.equal(apply(source, { from: 1, to: 1 }, 'markdown.heading2').text, '## Alpha beta');
  assert.equal(apply(source, { from: 1, to: 6 }, 'markdown.code').text, '`Alpha` beta');
  assert.equal(source, 'Alpha beta');
  assert.throws(() => apply(source, { from: -1, to: 3 }, 'markdown.bold'), /位置/);
  assert.throws(() => apply(source, { from: 8, to: 3 }, 'markdown.bold'), /位置/);
});

test('no-op formatting does not normalize the original Markdown', () => {
  const source = '##   Heading\n';
  const result = apply(source, { from: 1, to: 1 }, 'markdown.heading2');
  assert.equal(result.changed, false);
  assert.equal(result.text, source);
});

test('list, quote and code-block commands operate on the same model', () => {
  const source = 'First\n\nSecond', selection = { from: 1, to: 13 };
  assert.equal(parse(apply(source, selection, 'markdown.bulletList').text).firstChild.type.name, 'bullet_list');
  assert.equal(parse(apply(source, selection, 'markdown.orderedList').text).firstChild.type.name, 'ordered_list');
  assert.equal(parse(apply(source, selection, 'markdown.quote').text).firstChild.type.name, 'blockquote');
  assert.equal(parse(apply('const a = 1', { from: 1, to: 4 }, 'markdown.codeBlock').text).firstChild.type.name, 'code_block');
  const divider = parse(apply('Text', { from: 1, to: 1 }, 'markdown.divider').text);
  assert.ok(divider.content.content.some(node => node.type.name === 'horizontal_rule'));
});

test('task lists round trip checked state and preserve escaped literal task markers', () => {
  const doc = parse('- [ ] Pending\n- [x] Done\n- plain\n- \\[ ] literal');
  assert.equal(doc.firstChild.child(0).attrs.checked, false);
  assert.equal(doc.firstChild.child(1).attrs.checked, true);
  assert.equal(doc.firstChild.child(2).attrs.checked, null);
  assert.equal(doc.firstChild.child(3).attrs.checked, null);
  assert.equal(doc.firstChild.child(0).textContent, 'Pending');
  assert.equal(doc.firstChild.child(3).textContent, '[ ] literal');
  assert.deepEqual(parse(serialize(doc)).toJSON(), doc.toJSON());
  assert.deepEqual(warnings('- [ ] Pending\n- [x] Done'), []);
});

test('task-list command marks selected list items without modifying other text', () => {
  const result = apply('First\n\nSecond', { from: 1, to: 13 }, 'markdown.taskList');
  const doc = parse(result.text);
  assert.equal(doc.firstChild.type.name, 'bullet_list');
  assert.equal(doc.firstChild.child(0).attrs.checked, false);
  assert.equal(doc.firstChild.child(1).attrs.checked, false);
  assert.equal(doc.textContent, 'FirstSecond');
  const fromHeading = parse(apply('# Heading', { from: 1, to: 1 }, 'markdown.taskList').text);
  assert.equal(fromHeading.firstChild.firstChild.firstChild.type.name, 'paragraph');
  assert.equal(fromHeading.firstChild.firstChild.attrs.checked, false);
  assert.equal(fromHeading.textContent, 'Heading');
  const toHeading = parse(apply('- [x] Done', { from: 3, to: 3 }, 'markdown.heading2').text);
  assert.equal(toHeading.firstChild.firstChild.firstChild.type.name, 'heading');
  assert.equal(toHeading.firstChild.firstChild.attrs.checked, null);
  assert.equal(toHeading.textContent, 'Done');
});

test('unsafe link and image protocols never become executable DOM attributes', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>', 'vbscript:alert(1)', '//evil.example', '\\evil.example']) assert.equal(isSafeMarkdownUrl(url), false, url);
  for (const url of ['https://example.com/a', 'http://example.com', 'mailto:hello@example.com', '#part', './page']) assert.equal(isSafeMarkdownUrl(url), true, url);
  assert.throws(() => apply('Link', { from: 1, to: 5 }, 'markdown.link', { href: 'javascript:alert(1)' }), /リンク/);
  const link = schema.marks.link.create({ href: 'javascript:alert(1)' });
  assert.deepEqual(link.type.spec.toDOM(link), ['span', 0]);
  const image = schema.nodes.image.create({ src: 'data:image/svg+xml,<svg onload=alert(1)>', alt: 'Unsafe' });
  assert.equal(image.type.spec.toDOM(image)[0], 'span');
  const parsed = parse('[Bad](javascript:alert(1))\n\n<script>alert(1)</script>');
  assert.ok(!JSON.stringify(parsed.toJSON()).includes('"type":"link"'));
});

test('links can be added and removed through the pure command', () => {
  const linked = apply('Example', { from: 1, to: 8 }, 'markdown.link', { href: 'https://example.com' });
  assert.equal(linked.text, '[Example](https://example.com)');
  assert.equal(apply(linked.text, { from: 1, to: 8 }, 'markdown.link', { href: '' }).text, 'Example');
});

test('public Markdown commands reject unknown actions, unsafe options and accessor-backed inputs', () => {
  let reads = 0;
  assert.throws(() => apply('text', { from: 1, to: 2 }, 'markdown.unknown'), /未対応/);
  assert.throws(() => apply('text', null, 'markdown.bold'), /オブジェクト/);
  assert.throws(() => apply('text', { from: 1, to: 2, extra: 1 }, 'markdown.bold'), /未対応/);
  assert.throws(() => apply('text', { from: 1, to: 2 }, 'markdown.bold', { href: 'https://example.com' }), /リンク操作/);
  assert.throws(() => apply('text', { from: 1, to: 2 }, 'markdown.link', { href: 'https://example.com', title: 42 }), /文字列/);
  assert.throws(() => apply('text', { from: 1, to: 2 }, 'markdown.link', { href: 'https://example.com', extra: true }), /未対応/);
  assert.throws(() => apply('text', { get from() { reads++; return 1; }, to: 2 }, 'markdown.bold'), /getter/);
  assert.throws(() => apply('text', { from: 1, to: 2 }, 'markdown.link', { get href() { reads++; return 'https://example.com'; } }), /getter/);
  assert.equal(reads, 0);
});

test('task toggle has a validated DOM-free source API', () => {
  const source = '- [ ] Pending\n- [x] Done';
  const result = api.applyMarkdownTaskCommand(source, 1);
  assert.equal(result.changed, true);
  assert.equal(parse(result.text).firstChild.firstChild.attrs.checked, true);
  assert.equal(parse(source).firstChild.firstChild.attrs.checked, false);
  assert.throws(() => api.applyMarkdownTaskCommand(source, 3), /チェックリスト/);
  assert.throws(() => api.applyMarkdownTaskCommand(source, NaN), /文字位置/);
  assert.throws(() => api.applyMarkdownTaskCommand(source, 999), /文字位置/);
});

test('unsupported extensions select a lossless source path, excluding fenced/inline code', () => {
  assert.ok(warnings('| Name | Value |\n| --- | --- |\n| A | B |').includes('表'));
  assert.ok(warnings('<div>custom</div>').includes('HTML'));
  assert.ok(warnings('~~removed~~').includes('取り消し線'));
  assert.deepEqual(warnings('```html\n<div>custom</div>\n| A | B |\n| --- | --- |\n```\n\n`~~literal~~`'), []);
  assert.deepEqual(warnings('\\<div>literal\\</div> and \\~\\~literal\\~\\~'), []);
  assert.deepEqual(warnings('<https://example.com> and <hello@example.com>'), []);
  assert.throws(() => apply('| A | B |\n| --- | --- |\n| 1 | 2 |', { from: 1, to: 1 }, 'markdown.heading1'), /ソースモード/);
});
