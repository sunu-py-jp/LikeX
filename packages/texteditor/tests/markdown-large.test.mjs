import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers/build.mjs';

// The reference is prosemirror-markdown's own whole-document serializer with the same task-item rule.
// The editor serializes block by block, so every result is compared against it.
const output = await build({ stdin: { contents: `export * from './src/markdown/index';
export { serializeMarkdownBlocks } from './src/markdown/serializer';
export { EditorState, TextSelection } from 'prosemirror-state';
import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown';
export const reference = new MarkdownSerializer({ ...defaultMarkdownSerializer.nodes,
  list_item(state, node) { if (node.attrs.checked !== null) state.write(node.attrs.checked ? '[x] ' : '[ ] '); state.renderContent(node); },
}, defaultMarkdownSerializer.marks);`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { parseMarkdownDocument: parse, serializeMarkdownDocument: serialize, serializeMarkdownBlocks, getMarkdownCompatibilityWarnings: warnings,
  markdownSelectionAfterReplace, markdownSchema: schema, reference, EditorState, TextSelection } = api;
const { nodes, marks } = schema;

function random(seed) {
  return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const texts = ['plain text', 'two words', '*star*', '# hash', '- dash', '+ plus', '1. one', '12. twelve', '> quote', '`tick`', '``` fence', '[link]', '!', '  lead', 'trail  ',
  'a_b_c', '_under_', '~~strike~~', '<b>tag</b>', '| A | B |', '| --- | --- |', 'line\nbreak', 'end\n', '日本語の文章です。', '\\ backslash', '---', '***', '[x] done', '[ ] todo'];
function inline(next, code = false, breaks = true) {
  const content = [], pick = list => list[Math.floor(next() * list.length)];
  for (let count = Math.floor(next() * 5); count > 0; count--) {
    const kind = next();
    if (!code && breaks && kind < .08) { content.push(nodes.hard_break.create()); continue; }
    if (!code && kind < .13) { content.push(nodes.image.create({ src: 'https://example.com/a(b).png', alt: pick(texts), title: next() < .5 ? 'A "title"' : null })); continue; }
    let set = [];
    if (!code) {
      if (next() < .25) set = marks.strong.create().addToSet(set);
      if (next() < .25) set = marks.em.create().addToSet(set);
      if (next() < .15) set = marks.code.create().addToSet(set);
      if (next() < .15) set = marks.link.create({ href: pick(['https://example.com/a', 'docs/page (1).md', 'mailto:a@example.com']), title: next() < .3 ? 'title' : null }).addToSet(set);
    }
    content.push(schema.text(pick(texts), set));
  }
  return content;
}
function block(next, depth) {
  const kind = next(), children = () => Array.from({ length: 1 + Math.floor(next() * 3) }, () => block(next, depth + 1));
  if (kind < .4 || depth > 2) return nodes.paragraph.create(null, inline(next));
  if (kind < .5) return nodes.heading.create({ level: 1 + Math.floor(next() * 6) }, inline(next, false, false));
  if (kind < .6) {
    const text = [...inline(next, true)].map(node => node.text).join(next() < .5 ? '\n' : '```');
    return nodes.code_block.create({ params: next() < .5 ? 'ts' : '' }, text ? schema.text(text) : null);
  }
  if (kind < .65) return nodes.horizontal_rule.create();
  if (kind < .75) return nodes.blockquote.create(null, children());
  const ordered = next() < .5, tight = next() < .5, count = 1 + Math.floor(next() * (next() < .2 ? 14 : 4));
  const items = Array.from({ length: count }, () => nodes.list_item.create({ checked: next() < .3 ? next() < .5 : null },
    [nodes.paragraph.create(null, inline(next)), ...(next() < .35 ? children() : [])]));
  return ordered ? nodes.ordered_list.create({ order: next() < .5 ? 1 : 1 + Math.floor(next() * 120), tight }, items) : nodes.bullet_list.create({ tight }, items);
}
const documentOf = blocks => nodes.doc.create(null, blocks);
const paragraph = text => nodes.paragraph.create(null, text ? schema.text(text) : null);
const bullets = (tight, ...items) => nodes.bullet_list.create({ tight }, items.map(text => nodes.list_item.create(null, paragraph(text))));
const numbers = (order, tight, ...items) => nodes.ordered_list.create({ order, tight }, items.map(text => nodes.list_item.create(null, paragraph(text))));
function large(blocks) {
  const parts = [];
  for (let index = 0; index < blocks; index++) {
    if (index % 10 === 0) parts.push(`## 見出し ${index}`);
    else if (index % 10 === 5) parts.push(`- item one ${index}\n- item **two** with [link](https://example.com/${index})\n- item three`);
    else if (index % 10 === 7) parts.push('```js\nconst a = ' + index + ';\nif (a < 3) console.log(a | 1);\n```');
    else parts.push(`これは段落 ${index} です。Lorem ipsum dolor sit amet, consectetur adipiscing elit. *Emphasis* and \`code\` here.`);
  }
  return parts.join('\n\n') + '\n';
}

test('block-by-block serialization writes exactly what the whole-document serializer writes', () => {
  const cases = [
    [paragraph('')], [paragraph(''), paragraph('after an empty first block')], [paragraph('a'), paragraph(''), paragraph(''), paragraph('b')],
    [paragraph('before'), paragraph('')], [paragraph('ends with newline\n'), paragraph('next')],
    [bullets(true, 'a', 'b'), bullets(true, 'c')], [bullets(false, 'a', 'b'), bullets(true, 'c'), numbers(1, true, 'd')],
    [numbers(1, true, 'a'), numbers(1, false, 'b', 'c')], [bullets(true, 'a'), paragraph(''), bullets(true, 'b')],
    [paragraph(''), bullets(true, 'only')], [numbers(8, true, 'eight', 'nine', 'ten', 'eleven')], [numbers(99, false, 'ninety-nine', 'hundred')],
    [numbers(1, true, ...Array.from({ length: 12 }, (_, index) => `item ${index}`))],
    [nodes.bullet_list.create({ tight: true }, [nodes.list_item.create({ checked: true }, [paragraph('done'), bullets(true, 'nested', 'tight')]), nodes.list_item.create({ checked: false }, [paragraph('todo\n'), nodes.code_block.create(null, schema.text('a\n\nb'))])])],
    [nodes.bullet_list.create({ tight: false }, [nodes.list_item.create(null, [paragraph(''), paragraph('second')]), nodes.list_item.create(null, [nodes.blockquote.create(null, paragraph('quoted')), numbers(3, true, 'x', 'y')])])],
    [nodes.code_block.create(), paragraph('after empty code')], [nodes.horizontal_rule.create(), nodes.horizontal_rule.create()],
    [nodes.paragraph.create(null, [schema.text('!'), schema.text('link', [marks.link.create({ href: 'https://example.com' })])]), paragraph('next')],
    [paragraph('!'), nodes.paragraph.create(null, schema.text('link', [marks.link.create({ href: 'https://example.com' })]))],
  ];
  for (const blocks of cases) {
    const document = documentOf(blocks);
    assert.equal(serialize(document), reference.serialize(document), JSON.stringify(document.toJSON()));
  }
  const next = random(20261122);
  for (let run = 0; run < 400; run++) {
    const document = documentOf(Array.from({ length: 1 + Math.floor(next() * 8) }, () => block(next, 0)));
    document.check();
    assert.equal(serialize(document), reference.serialize(document), `random document ${run}: ${JSON.stringify(document.toJSON())}`);
  }
});

test('a multi-megabyte document serializes in time proportional to its size', () => {
  const source = large(20000), document = parse(source);
  assert.ok(source.length > 1_500_000);
  const started = performance.now(), text = serialize(document), elapsed = performance.now() - started;
  // Whole-document string building took several seconds here and grew with the square of the size.
  assert.ok(elapsed < 2000, `serializing ${source.length} characters took ${Math.round(elapsed)}ms`);
  assert.deepEqual(parse(text).toJSON(), document.toJSON());
  const small = parse(large(300));
  assert.equal(serialize(small), reference.serialize(small));
});

test('editing one block of a large document re-serializes to the same Markdown as a fresh pass', () => {
  let state = EditorState.create({ doc: parse(large(400)) });
  serialize(state.doc);
  const edits = [
    tr => tr.insertText('先頭に追加 ', 1), tr => tr.insertText(' <b>tail</b>', tr.doc.content.size - 1),
    tr => tr.delete(tr.doc.child(0).nodeSize, tr.doc.child(0).nodeSize + tr.doc.child(1).nodeSize),
    tr => tr.insert(0, [bullets(true, 'new', 'list'), bullets(true, 'adjacent')]),
    tr => tr.split(tr.doc.child(0).nodeSize + tr.doc.child(1).nodeSize + 4),
    tr => tr.setNodeMarkup(0, null, { tight: false }),
  ];
  for (const edit of edits) {
    state = state.apply(edit(state.tr));
    assert.equal(serialize(state.doc), reference.serialize(state.doc));
    assert.equal(serializeMarkdownBlocks(state.doc, true).text, reference.serialize(state.doc));
  }
});

test('warnings collected block by block match the check of the serialized source', () => {
  const next = random(7);
  for (let run = 0; run < 200; run++) {
    const document = documentOf(Array.from({ length: 1 + Math.floor(next() * 6) }, () => block(next, 0)));
    const result = serializeMarkdownBlocks(document, true);
    assert.deepEqual([...result.warnings].sort(), [...warnings(result.text)].sort(), `random document ${run}: ${JSON.stringify(result.text)}`);
  }
  assert.deepEqual(serializeMarkdownBlocks(parse('plain\n\n- item'), true).warnings, []);
  // Typed tildes are escaped on output, so only the raw tag is reported.
  assert.deepEqual(serializeMarkdownBlocks(documentOf([paragraph('a'), bullets(true, '~~y~~', '<b>x</b>')]), true).warnings, ['HTML']);
});

test('compatibility warnings stay exact for sources that need no tokenizing', () => {
  assert.deepEqual(warnings('# Title\n\nplain *text* and `code`\n\n- a\n- b'), []);
  assert.deepEqual(warnings('a ~ b ~ c'), []);
  assert.deepEqual(warnings('a < b'), []);
  assert.deepEqual(warnings('pipe | only'), []);
  assert.deepEqual(warnings('x <b>y</b>'), ['HTML']);
  assert.deepEqual(warnings('x ~~y~~'), ['取り消し線']);
  assert.deepEqual(warnings('| A | B |\n| --- | --- |\n| 1 | 2 |'), ['表']);
  assert.throws(() => warnings('a\u0000b'));
});

test('replacing the document keeps unchanged leading and trailing blocks as the same nodes', () => {
  const source = large(60), before = parse(source), state = EditorState.create({ doc: before, selection: TextSelection.create(before, 3) });
  const changed = source.replace('これは段落 31 です。', '変更した段落です。');
  const transaction = markdownSelectionAfterReplace(state, parse(changed)), after = transaction.doc;
  assert.deepEqual(after.toJSON(), parse(changed).toJSON());
  assert.equal(after.childCount, before.childCount);
  let reused = 0;
  after.forEach((node, _offset, index) => { if (node === before.child(index)) reused++; });
  assert.equal(reused, before.childCount - 1, 'only the edited block is a new node');
  assert.equal(transaction.selection.from, 3);

  const same = markdownSelectionAfterReplace(state, parse(source));
  assert.equal(same.docChanged, false);
  const removed = markdownSelectionAfterReplace(state, parse(large(20)));
  assert.deepEqual(removed.doc.toJSON(), parse(large(20)).toJSON());
  const added = markdownSelectionAfterReplace(EditorState.create({ doc: parse('one\n\none') }), parse('one\n\none\n\none'));
  assert.deepEqual(added.doc.toJSON(), parse('one\n\none\n\none').toJSON());
  const end = EditorState.create({ doc: before, selection: TextSelection.create(before, before.content.size - 1) });
  const shorter = markdownSelectionAfterReplace(end, parse('short'));
  assert.equal(shorter.selection.to <= shorter.doc.content.size, true);
});
