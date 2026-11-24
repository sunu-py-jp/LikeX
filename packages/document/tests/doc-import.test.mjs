import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { doc, docStreams, S, tableDefinition, cellShades, CELL, pictureData } from './doc-fixture.mjs';
import { createCompoundFile } from '../../core/tests/cfb-fixture.mjs';
import { artContainer, shapeHeader, pngBlip, jpegBlip, blip, blipEntry } from '../../core/tests/office-art-fixture.mjs';

const output = await build({ stdin: { contents: 'export * from "./src/io";', resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'doc-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importDocumentDoc, importDocumentWord, importDocumentDocx } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url));
// Real, decodable images: the document model validates embedded pictures.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=', 'base64');
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 10, 0, 20, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);

/** Compact view of the document tree: text with its mark names, blocks with their significant attributes. */
function outline(node) {
  if (node.type === 'text') {
    const marks = (node.marks ?? []).flatMap(mark => mark.type === 'text_style' ? Object.entries(mark.attrs).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}=${value}`)
      : mark.type === 'link' ? [`link=${mark.attrs.href}`] : [mark.type]);
    return marks.length ? `${node.text} [${marks.join(' ')}]` : node.text;
  }
  const keep = ['align', 'level', 'order', 'colspan', 'rowspan', 'backgroundColor'];
  const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key, value]) => keep.includes(key) && value !== null && !(key === 'align' && value === 'left') && !(['colspan', 'rowspan'].includes(key) && value === 1)));
  const head = Object.keys(attrs).length ? `${node.type} ${JSON.stringify(attrs)}` : node.type;
  return node.content?.length ? [head, ...node.content.map(outline)] : [head];
}
const blocks = result => result.document.content.content.map(outline);
const text = node => (node.text ?? '') + (node.content ?? []).map(text).join('');
const cellMark = '\u0007';
const cell = (value, sprms = []) => ({ text: value, mark: cellMark, sprms: [...S.inTable(), ...sprms] });
const rowEnd = (definition, extra = []) => ({ text: '', mark: cellMark, sprms: [...S.inTable(), ...S.rowEnd(), ...definition, ...extra] });

test('a document written by another producer imports with its text, formatting, table and page break', async () => {
  const result = await importDocumentDoc(await fixture('textutil-rich.doc'));
  const [title, body, , , , , right, table, before, pageBreak, after] = blocks(result);
  assert.deepEqual(title, ['paragraph {"align":"center"}', 'Quarterly report [strong fontFamily=Helvetica fontSize=20]']);
  assert.deepEqual(body.slice(1, 9), ['Plain  [fontFamily=Helvetica fontSize=12]', 'bold [strong fontFamily=Helvetica fontSize=12]', '  [fontFamily=Helvetica fontSize=12]',
    'italic [em fontFamily=Helvetica fontSize=12]', '  [fontFamily=Helvetica fontSize=12]', 'underline [underline fontFamily=Helvetica fontSize=12]', '  [fontFamily=Helvetica fontSize=12]',
    'struck [strike fontFamily=Helvetica fontSize=12]']);
  assert.ok(body.includes('red [fontFamily=Helvetica fontSize=12 color=#ff0000]'));
  assert.ok(body.includes('highlighted [fontFamily=Helvetica fontSize=12 backgroundColor=#ffff00]'));
  assert.ok(body.some(item => item.startsWith('big Times [fontFamily=Times New Roman fontSize=16')));
  assert.ok(body.some(item => item.startsWith('日本語の文書 [fontFamily=Hiragino Sans')));
  assert.equal(right[0], 'paragraph {"align":"right"}');
  assert.deepEqual(table.slice(1).map(row => row.slice(1).map(text => text[1][1].replace(/ \[.*/, ''))), [['Item', 'Amount'], ['Alpha', '1,200']]);
  assert.equal(before[1].startsWith('Before break'), true);
  assert.deepEqual(pageBreak, ['page_break']);
  assert.equal(after[1].startsWith('After break'), true);
  assert.deepEqual(result.warnings, ['表の独自の罫線は標準の罫線で表示します']);
});

test('character formatting, colours, fonts and toggles relative to the style are resolved', async () => {
  const styles = [{ builtin: 0, name: 'Normal', character: [...S.font(0), ...S.size(24)] }, { name: 'Emphasis body', base: 0, character: S.bold() }];
  const result = await importDocumentDoc(doc({ fonts: ['Century', 'MS 明朝'], styles, paragraphs: [
    { runs: [{ text: 'plain ' }, { text: 'bold', sprms: S.bold() }, { text: ' sized', sprms: S.size(36) }, { text: ' blue', sprms: S.colorIndex(2) }, { text: ' rgb', sprms: S.color(0x12, 0x34, 0x56) },
      { text: ' auto', sprms: S.color(0, 0, 0, 0xff) }, { text: ' mark', sprms: S.highlight(7) }, { text: ' shade', sprms: S.shade([0xff, 0, 0, 0xff], [0xcc, 0xee, 0xff, 0], 0) }, { text: ' 明朝', sprms: S.font(1) }] },
    { style: 1, runs: [{ text: 'style bold' }, { text: ' off', sprms: S.bold(0) }, { text: ' same', sprms: S.bold(0x80) }, { text: ' inverted', sprms: S.bold(0x81) }, { text: ' italic', sprms: S.italic(0x81) }] },
  ] }));
  const base = 'fontFamily=Century fontSize=12';
  assert.deepEqual(blocks(result), [
    ['paragraph', `plain  [${base}]`, `bold [strong ${base}]`, ' sized [fontFamily=Century fontSize=18]', ` blue [${base} color=#0000ff]`, ` rgb [${base} color=#123456]`, ` auto [${base}]`,
      ` mark [${base} backgroundColor=#ffff00]`, ` shade [${base} backgroundColor=#cceeff]`, ' 明朝 [fontFamily=MS 明朝 fontSize=12]'],
    ['paragraph', `style bold [strong ${base}]`, ` off [${base}]`, ` same [strong ${base}]`, ` inverted [${base}]`, ` italic [strong em ${base}]`],
  ]);
  assert.deepEqual(result.warnings, []);
});

test('character styles apply between the paragraph style and the run', async () => {
  const styles = [{ builtin: 0, name: 'Normal', character: S.size(20) }, { kind: 2, name: 'Strong', character: [...S.bold(), ...S.colorIndex(6)] }, { kind: 2, base: 1, name: 'Strong big', character: S.size(40) }];
  const result = await importDocumentDoc(doc({ styles, paragraphs: [{ runs: [{ text: 'a', sprms: S.characterStyle(1) }, { text: 'b', sprms: [...S.characterStyle(2), ...S.colorIndex(2)] }, { text: 'c' }] }] }));
  assert.deepEqual(blocks(result)[0].slice(1), ['a [strong fontFamily=Times New Roman fontSize=10 color=#ff0000]', 'b [strong fontFamily=Times New Roman fontSize=20 color=#0000ff]', 'c [fontFamily=Times New Roman fontSize=10]']);
});

test('alignment, headings from built-in styles and outline levels, and page breaks before a paragraph', async () => {
  const styles = [{ builtin: 0, name: 'Normal' }, { builtin: 1, base: 0, name: 'heading 1', character: S.bold() }, { builtin: 3, base: 0, name: 'heading 3' }, { builtin: 8, base: 0, name: 'heading 8' }];
  const result = await importDocumentDoc(doc({ styles, paragraphs: [{ text: 'Title', style: 1 }, { text: 'Sub', style: 2, sprms: S.align(1) }, { text: 'Deep', style: 3 }, { text: 'Outline', sprms: S.outline(1) },
    { text: 'Right', sprms: S.align(2) }, { text: 'Both', sprms: S.align(3) }, { text: 'New page', sprms: S.pageBreakBefore() }] }));
  assert.deepEqual(blocks(result).map(block => block[0]), ['heading {"level":1}', 'heading {"align":"center","level":3}', 'paragraph', 'heading {"level":2}', 'paragraph {"align":"right"}',
    'paragraph {"align":"justify"}', 'page_break', 'paragraph']);
});

test('special characters become tabs, line breaks and page breaks; unusable control characters are dropped', async () => {
  const result = await importDocumentDoc(doc({ paragraphs: [{ text: 'a\tb\u000bc\u001ed\u001fe\u0003f' }, { text: 'before\u000cafter' }] }));
  const [first, , pageBreak, last] = result.document.content.content;
  assert.deepEqual(first.content.map(node => node.type === 'text' ? node.text : node.type), ['a\tb', 'hard_break', 'c‑def']);
  assert.equal(pageBreak.type, 'page_break');
  assert.equal(text(last), 'after');
});

test('the delete character, which the document model does not accept, is dropped like other control characters', async () => {
  const result = await importDocumentDoc(doc({ paragraphs: [{ text: 'a\u007fb' }] }));
  assert.deepEqual(blocks(result).map(block => block[1].split(' [')[0]), ['ab']);
});

test('compressed text is read as Windows-1252 at half the stated offset', async () => {
  const result = await importDocumentDoc(doc({ compressed: true, paragraphs: [{ runs: [{ text: 'Café ' }, { text: 'bold\u0093', sprms: S.bold() }] }] }));
  assert.deepEqual(blocks(result)[0].slice(1).map(item => item.replace(/ \[.*/, '')), ['Café ', 'bold“']);
});

test('lists keep their numbering definition, level and start value', async () => {
  const lists = [{ id: 1001, levels: [{ format: 0, start: 3, text: '\u0000.' }, { format: 4, text: '\u0001)' }, ...Array.from({ length: 7 }, () => ({ format: 0, text: '' }))] }, { id: 1002, levels: [{ format: 23, text: '•' }] }];
  const result = await importDocumentDoc(doc({ lists, listOverrides: [1002, 1001], paragraphs: [{ text: 'bullet one', sprms: S.list(1) }, { text: 'bullet two', sprms: S.list(1) }, { text: 'between' },
    { text: 'third', sprms: S.list(2) }, { text: 'nested', sprms: S.list(2, 1) }, { text: 'fourth', sprms: S.list(2) }, { text: 'unknown list', sprms: S.list(9) }] }));
  const [bullets, between, numbers, unknown] = blocks(result);
  assert.deepEqual(bullets.map(item => Array.isArray(item) ? item[1][1].replace(/ \[.*/, '') : item), ['bullet_list', 'bullet one', 'bullet two']);
  assert.equal(between[0], 'paragraph');
  assert.equal(numbers[0], 'ordered_list {"order":3}');
  assert.equal(numbers.length, 3);
  assert.equal(numbers[1][2][0], 'ordered_list {"order":1}', 'the nested level is a list inside the first item');
  assert.equal(unknown[0], 'paragraph');
  assert.deepEqual(result.warnings, ['独自の番号書式は連番に変換しました', '番号・箇条書きの記号や接頭辞・区切りを標準表示へ変換しました']);
});

test('tables keep column widths, merged cells, shading and header rows', async () => {
  const wide = tableDefinition([0, 1500, 3000, 4500]), merged = tableDefinition([0, 1500, 3000, 4500], [{ flags: CELL.firstMerged }, { flags: CELL.merged }, {}]);
  const vertical = (first, rest) => tableDefinition([0, 1500, 3000, 4500], [{ flags: first }, {}, {}].map((item, index) => index ? rest : item));
  const result = await importDocumentDoc(doc({ paragraphs: [
    cell('H1'), cell('H2'), cell('H3'), rowEnd(wide, [...S.tableHeader(), ...cellShades([0xdd, 0xee, 0xff], null, [0xff, 0xff, 0x00])]),
    cell('wide'), cell(''), cell('c'), rowEnd(merged),
    cell('tall'), cell('x'), cell('y'), rowEnd(vertical(CELL.verticalRestart, {})), cell(''), cell('p'), cell('q'), rowEnd(vertical(CELL.verticalContinue, {})),
    { text: 'after' },
  ] }));
  const [table, after] = blocks(result), rows = table.slice(1);
  assert.deepEqual(rows[0].map(item => Array.isArray(item) ? item[0] : item), ['table_row', 'table_header {"backgroundColor":"#ddeeff"}', 'table_header', 'table_header {"backgroundColor":"#ffff00"}']);
  assert.deepEqual(rows[1].slice(1).map(item => item[0]), ['table_cell {"colspan":2}', 'table_cell']);
  assert.deepEqual(rows[2].slice(1).map(item => item[0]), ['table_cell {"rowspan":2}', 'table_cell', 'table_cell']);
  assert.deepEqual(rows[3].slice(1).map(item => item[0]), ['table_cell', 'table_cell']);
  assert.deepEqual(result.document.content.content[0].content[0].content.map(node => node.attrs.colwidth), [[100], [100], [100]]);
  assert.equal(after[0], 'paragraph');
  assert.deepEqual(result.warnings, []);
});

test('horizontal merge flags are read under either published convention', async () => {
  // First cell then member: 1 then 2 in older references, 2 (or 3) then 1 in the format specification.
  for (const [first, member] of [[1, 2], [2, 1], [3, 1], [3, 2]]) {
    const edges = [0, 1000, 2000, 3000, 4000, 5000], definition = tableDefinition(edges, [{ flags: first }, { flags: member }, {}, { flags: first }, { flags: member }]);
    const result = await importDocumentDoc(doc({ paragraphs: [...'12345'].map(value => cell(value)).concat(rowEnd(tableDefinition(edges)), cell('a'), cell(''), cell('b'), cell('c'), cell(''), rowEnd(definition)) }));
    const [plain, merged] = result.document.content.content[0].content.map(row => row.content.map(node => [text(node), node.attrs.colspan]));
    assert.deepEqual([plain.length, merged], [5, [['a', 2], ['b', 1], ['c', 2]]], `${first}/${member}`);
  }
});

test('a cell may hold several paragraphs, and rows with different cell edges share one grid', async () => {
  const result = await importDocumentDoc(doc({ paragraphs: [
    { text: 'first line', sprms: S.inTable() }, cell('second line'), cell('b'), rowEnd(tableDefinition([0, 3000, 6000])),
    cell('x'), cell('y'), cell('z'), rowEnd(tableDefinition([0, 2000, 4000, 6000])),
  ] }));
  const table = result.document.content.content[0];
  assert.deepEqual(table.content[0].content.map(node => [node.attrs.colspan, node.content.length]), [[2, 2], [2, 1]]);
  assert.deepEqual(table.content[1].content.map(node => node.attrs.colspan), [1, 2, 1]);
  assert.deepEqual(result.warnings, []);
});

test('rows whose cell edges disagree still form one rectangular table that keeps all text', async () => {
  const table = async paragraphs => (await importDocumentDoc(doc({ paragraphs }))).document.content.content[0];
  const widths = node => node.content.map(row => row.content.reduce((total, item) => total + item.attrs.colspan, 0));
  const texts = node => node.content.map(row => row.content.map(text));
  // An indented row starts further right and ends further left than the others.
  const indented = await table([cell('a'), cell('b'), rowEnd(tableDefinition([0, 3000, 6000])), cell('c'), cell('d'), rowEnd(tableDefinition([500, 3000, 5500]))]);
  assert.deepEqual([new Set(widths(indented)).size, texts(indented)], [1, [['a', 'b'], ['c', 'd']]]);
  // Edges that run backwards and a cell without width: the text of such a cell joins its neighbour.
  const damaged = await table([cell('a'), cell('b'), cell('c'), rowEnd(tableDefinition([0, 3000, 1000, 6000])), cell('d'), cell('e'), cell('f'), rowEnd(tableDefinition([0, 2000, 2000, 6000]))]);
  assert.deepEqual([new Set(widths(damaged)).size, damaged.content.map(row => row.content.map(text).join(''))], [1, ['abc', 'def']]);
  // Fewer and more cells than the row describes, and a row that describes nothing.
  const ragged = await table([cell('a'), cell('b'), rowEnd(tableDefinition([0, 3000, 6000])), cell('c'), rowEnd(tableDefinition([0, 3000, 6000])),
    cell('d'), cell('e'), cell('f'), rowEnd(tableDefinition([0, 3000, 6000])), cell('g'), cell('h'), cell('i'), rowEnd([]), cell('j'), rowEnd([])]);
  assert.deepEqual([new Set(widths(ragged)).size, ragged.content.map(row => row.content.map(text).join(''))], [1, ['ab', 'c', 'def', 'ghi', 'j']]);
  // No row describes its cells: the widest row sets the grid.
  const plain = await table([cell('a'), cell('b'), cell('c'), rowEnd([]), cell('d'), rowEnd([])]);
  assert.deepEqual([widths(plain), texts(plain)], [[3, 3], [['a', 'b', 'c'], ['d']]]);
});

test('a table nested in a cell becomes a nested table', async () => {
  const inner = sprms => [...S.inTable(), ...S.depth(2), ...sprms];
  const result = await importDocumentDoc(doc({ paragraphs: [
    { text: 'intro', sprms: S.inTable() },
    { text: 'i1', sprms: inner(S.innerCellEnd()) }, { text: 'i2', sprms: inner(S.innerCellEnd()) }, { text: '', sprms: inner([...S.innerRowEnd(), ...tableDefinition([0, 1000, 2000])]) },
    cell('outer end'), cell('second'), rowEnd(tableDefinition([0, 4000, 8000])),
  ] }));
  const outerCell = result.document.content.content[0].content[0].content[0];
  assert.deepEqual(outerCell.content.map(node => node.type), ['paragraph', 'table', 'paragraph']);
  assert.deepEqual(outerCell.content[1].content[0].content.map(text), ['i1', 'i2']);
  assert.equal(text(result.document.content.content[0].content[0].content[1]), 'second');
});

test('table borders that differ from the default are reported like their DOCX counterparts', async () => {
  const dashed = tableDefinition([0, 2000], [{ border: [12, 7, 6, 0] }]), none = tableDefinition([0, 2000], [{ border: [0, 0, 0, 0] }]);
  for (const definition of [dashed, none])
    assert.deepEqual((await importDocumentDoc(doc({ paragraphs: [cell('a'), rowEnd(definition)] }))).warnings, ['表の独自の罫線は標準の罫線で表示します']);
});

test('hyperlink fields become links; other fields keep their displayed result', async () => {
  const field = (instruction, result) => `\u0013${instruction}\u0014${result}\u0015`;
  const result = await importDocumentDoc(doc({ paragraphs: [
    { runs: [{ text: `see ${field(' HYPERLINK "https://example.com/a?b=1&c=2" ', 'the site')} and ${field('HYPERLINK \\l "Chapter1"', 'chapter one')}` }] },
    { runs: [{ text: `page ${field(' PAGE ', '7')} of ${field(' NUMPAGES ', '9')}; ${'\u0013 XE "index" \u0015'}end` }] },
    { runs: [{ text: `${field('HYPERLINK "javascript:alert(1)"', 'unsafe')} ${field('HYPERLINK "mailto:a@example.com" \\o "tip"', 'mail')}` }] },
  ] }));
  const strip = items => items.map(item => item.replace(/fontSize=\d+ ?/, '').replace(/ \[\]$/, ''));
  assert.deepEqual(strip(blocks(result)[0].slice(1)), ['see ', 'the site [link=https://example.com/a?b=1&c=2]', ' and ', 'chapter one [link=#Chapter1]']);
  assert.equal(text(result.document.content.content[1]), 'page 7 of 9; end');
  assert.deepEqual(strip(blocks(result)[2].slice(1)), ['unsafe ', 'mail [link=mailto:a@example.com]']);
  assert.deepEqual(result.warnings.sort(), ['フィールドは計算せず、保存されている表示文字列を読み込みました', '安全なURLでないリンクを本文だけに変換しました'].sort());
});

test('a hyperlink field inside another keeps the outer link for all of the text', async () => {
  // Also what remains of a document in which a hyperlink field never ends.
  const result = await importDocumentDoc(doc({ paragraphs: [
    { text: '\u0013HYPERLINK "https://example.com/outer"\u0014outer \u0013HYPERLINK "https://example.com/inner"\u0014inner\u0015 tail\u0015 after' },
    { text: '\u0013HYPERLINK "https://example.com/open"\u0014never closed' }, { text: '\u0013HYPERLINK "https://example.com/next"\u0014next\u0015' },
  ] }));
  const linked = block => block.content.map(node => [node.text, node.marks?.find(mark => mark.type === 'link')?.attrs.href]);
  const [first, second, third] = result.document.content.content.map(linked);
  assert.deepEqual([first.filter(([, href]) => href).map(([value]) => value).join(''), new Set(first.map(([, href]) => href)), first.at(-1)], ['outer inner tail', new Set(['https://example.com/outer', undefined]), [' after', undefined]]);
  assert.deepEqual([second, third], [[['never closed', 'https://example.com/open']], [['next', 'https://example.com/open']]]);
});

test('a link that spans paragraphs is applied in each of them', async () => {
  const result = await importDocumentDoc(doc({ paragraphs: [{ text: 'a \u0013HYPERLINK "https://example.com/"\u0014first' }, { text: 'second\u0015 b' }] }));
  const links = result.document.content.content.map(block => block.content.filter(node => node.marks?.some(mark => mark.type === 'link')).map(node => node.text));
  assert.deepEqual(links, [['first'], ['second']]);
});

test('sections set the page size and margins, and a section mark ends its paragraph with a page break', async () => {
  const landscape = [...S.pageWidth(16838), ...S.pageHeight(11906), ...S.marginLeft(1134), ...S.marginRight(1134), ...S.marginTop(1701), ...S.marginBottom(567)];
  const result = await importDocumentDoc(doc({ sections: [{ sprms: [...S.pageWidth(11906), ...S.pageHeight(16838)] }, { sprms: landscape }], paragraphs: [{ text: 'first section', mark: '\f' }, { text: 'second section' }] }));
  assert.deepEqual(result.document.content.content.map(node => node.type), ['paragraph', 'page_break', 'paragraph']);
  const { page } = result.document;
  assert.deepEqual([Math.round(page.width), Math.round(page.height)], [297, 210]);
  assert.deepEqual(Object.values(page.margins).map(value => Math.round(value)), [30, 20, 10, 20]);
  assert.deepEqual(result.warnings, ['複数セクションの用紙設定は最後のセクションに統一しました']);
});

test('a page or list start the document model cannot hold falls back to the default instead of failing', async () => {
  const page = async sprms => (await importDocumentDoc(doc({ sections: [{ sprms }], paragraphs: [{ text: 'kept' }] }))).document.page;
  const letter = [216, 279, 25, 32, 25, 32];
  const rounded = value => [value.width, value.height, value.margins.top, value.margins.right, value.margins.bottom, value.margins.left].map(Math.round);
  // No width, margins wider than the paper, and a margin beyond the largest the model accepts.
  for (const sprms of [S.pageWidth(0), [...S.marginLeft(8000), ...S.marginRight(8000)], [...S.pageWidth(60_000), ...S.pageHeight(60_000), ...S.marginRight(30_000)]])
    assert.deepEqual(rounded(await page(sprms)), letter);
  // The paper size is kept when only it is stated and it fits.
  assert.deepEqual(rounded(await page([...S.pageWidth(11906), ...S.pageHeight(16838)])).slice(0, 2), [210, 297]);
  const numbered = await importDocumentDoc(doc({ lists: [{ id: 1001, levels: [{ format: 0, start: 2_000_000_000, text: '\u0000.' }] }], listOverrides: [1001], paragraphs: [{ text: 'item', sprms: S.list(1) }] }));
  assert.equal(blocks(numbered)[0][0], 'ordered_list {"order":1000000}');
});

test('continuous sections and columns follow the DOCX rules', async () => {
  const result = await importDocumentDoc(doc({ sections: [{}, { sprms: [...S.sectionStart(0), ...S.columns(2)] }], paragraphs: [{ text: 'one', mark: '\f' }, { text: 'two' }] }));
  assert.deepEqual(result.document.content.content.map(node => node.type), ['paragraph', 'paragraph']);
  assert.ok(result.warnings.includes('段組みは1段に変換しました'));
});

test('a document without section properties uses the Word default page', async () => {
  const { page } = (await importDocumentDoc(doc({ paragraphs: [{ text: 'x' }] }))).document;
  assert.deepEqual([Math.round(page.width * 10), Math.round(page.height * 10)], [2159, 2794]);
});

test('inline PNG and JPEG pictures are embedded with their displayed size', async () => {
  const shape = artContainer(0xf004, shapeHeader(1, 75));
  const data = Uint8Array.from([...new Uint8Array(16), ...pictureData([shape, blipEntry({ embedded: pngBlip(PNG) })], { width: 1440, height: 720, scaleX: 500, scaleY: 1000 }),
    ...pictureData([shape, jpegBlip(JPEG)], { width: 3000, height: 1500 })]);
  const second = 16 + pictureData([shape, blipEntry({ embedded: pngBlip(PNG) })]).length;
  const result = await importDocumentDoc(doc({ data, paragraphs: [{ runs: [{ text: 'before ' }, { text: '\u0001', sprms: [...S.special(), ...S.pictureOffset(16)] }, { text: ' after' }] },
    { runs: [{ text: '\u0001', sprms: [...S.special(), ...S.pictureOffset(second)] }] }] }));
  const images = result.document.content.content.filter(node => node.type === 'image');
  assert.equal(images.length, 2);
  assert.ok(images[0].attrs.src.startsWith('data:image/png;base64,'));
  assert.deepEqual([images[0].attrs.width, images[0].attrs.height], [48, 48]);
  assert.ok(images[1].attrs.src.startsWith('data:image/jpeg;base64,'));
  assert.deepEqual([images[1].attrs.width, images[1].attrs.height], [200, 100]);
  assert.deepEqual(result.warnings, []);
});

test('pictures in other formats, drawn objects and embedded objects are omitted with the DOCX wording', async () => {
  const metafile = pictureData([artContainer(0xf004, shapeHeader(1, 75)), blip(0xf01a, 0x3d4, new Array(40).fill(0))]);
  const picture = offset => ({ text: '\u0001', sprms: [...S.special(), ...S.pictureOffset(offset)] });
  const result = await importDocumentDoc(doc({ data: metafile, paragraphs: [{ runs: [picture(0), picture(9999), { text: '\u0008', sprms: S.special() }, { text: '\u0001', sprms: [...S.special(), ...S.pictureOffset(0), ...S.embedded()] }, { text: 'text' }] }] }));
  assert.equal(text(result.document.content), 'text');
  // The DOCX reader reports an unusable picture twice: by its format and as an unsupported drawing.
  assert.deepEqual(result.warnings.sort(), ['PNG・JPEG以外の画像を省略しました', '旧形式の図形・埋め込みオブジェクトを省略しました', '未対応の図形・グラフ・SmartArtなどの描画要素を省略しました'].sort());
});

test('tracked changes, notes, comments, symbols and super/subscript follow the DOCX rules', async () => {
  const result = await importDocumentDoc(doc({ paragraphs: [{ runs: [{ text: 'kept ' }, { text: 'removed', sprms: S.deleted() }, { text: 'added', sprms: S.inserted() }, { text: '\u0002', sprms: S.special() },
    { text: '\u0005', sprms: S.special() }, { text: '(', sprms: [...S.special(), ...S.symbol()] }, { text: 'up', sprms: S.position(1) }] }] }));
  assert.equal(text(result.document.content), 'kept addedup');
  assert.deepEqual(result.warnings.sort(), ['変更履歴は承認後の本文として読み込みました', '脚注・文末脚注・コメントを省略しました', '専用フォントによる記号を省略しました', '上付き・下付き文字を通常の文字として読み込みました'].sort());
});

test('headers and footers are reported; footnote text after the main text is not imported', async () => {
  const result = await importDocumentDoc(doc({ paragraphs: [{ text: 'body' }], extraText: 'header text\r', headerPositions: [0, 0, 0, 0, 0, 0, 0, 0, 12, 12] }));
  assert.equal(text(result.document.content), 'body');
  assert.deepEqual(result.warnings, ['ヘッダー・フッターを省略しました']);
});

test('the title comes from the summary stream, and macros are never loaded', async () => {
  const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
  const title = [...'Plan'].map(character => character.charCodeAt(0));
  const set = [...u32(32 + 8 + title.length + 1 + 3), ...u32(2), ...u32(1), ...u32(24), ...u32(2), ...u32(32), ...u32(2), ...u32(1252), ...u32(0x1e), ...u32(title.length + 1), ...title, 0, 0, 0, 0];
  const summary = Uint8Array.from([0xfe, 0xff, 0, 0, ...u32(0x00020006), ...new Array(16).fill(0), ...u32(1), ...new Array(16).fill(0xab), ...u32(48), ...set]);
  const result = await importDocumentDoc(doc({ paragraphs: [{ text: 'x' }] }, { extraStreams: [{ path: '\u0005SummaryInformation', content: summary }, { path: 'Macros/VBA/dir', content: new Uint8Array(8) }] }));
  assert.equal(result.document.title, 'Plan');
  assert.deepEqual(result.warnings, ['マクロを読み込まずに省略しました']);
});

test('files that are not readable Word 97–2003 documents are rejected with a reason', async () => {
  const reject = (input, pattern) => assert.rejects(importDocumentDoc(input), pattern);
  await reject(new Uint8Array([0x50, 0x4b, 3, 4, ...new Uint8Array(600)]), /Word文書を読み込めません: \.doc形式（Word 97–2003）の文書ではありません/);
  await reject(createCompoundFile([{ path: 'Workbook', content: new Uint8Array(600) }]), /\.doc形式（Word 97–2003）の文書ではありません/);
  await reject(doc({ paragraphs: [{ text: 'x' }], version: 0x0065 }), /Word 95以前の形式には対応していません/);
  await reject(doc({ paragraphs: [{ text: 'x' }], encrypted: true }), /パスワードで保護または暗号化された文書には対応していません/);
  await reject(createCompoundFile([{ path: 'EncryptedPackage', content: new Uint8Array(64) }]), /パスワードで保護または暗号化された文書には対応していません/);
  await reject(doc({ paragraphs: [{ text: 'x' }] }, { tableName: '0Table' }), /文書の構造が不正です/);
  const { main, table } = docStreams({ paragraphs: [{ text: 'x' }] });
  const broken = main.slice(); new DataView(broken.buffer).setUint32(154 + 33 * 8 + 4, 0, true);
  await reject(createCompoundFile([{ path: 'WordDocument', content: broken }, { path: '1Table', content: table }]), /本文の位置情報がありません/);
  const controller = new AbortController(); controller.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(importDocumentDoc(doc({ paragraphs: [{ text: 'x' }] }), { signal: controller.signal }), { name: 'AbortError' });
});

test('more block elements than the DOCX reader accepts are refused with its wording', async () => {
  const paragraphs = count => Array.from({ length: count }, () => ({ text: 'x' }));
  await assert.rejects(importDocumentDoc(doc({ paragraphs: paragraphs(20_001) })), /^Error: Word文書を読み込めません: 文書の要素数が読み込み上限を超えています$/);
  assert.equal((await importDocumentDoc(doc({ paragraphs: paragraphs(19_000) }))).document.content.content.length, 19_000);
});

test('damaged optional tables lose formatting, not text', async () => {
  const { main, table } = docStreams({ styles: [{ builtin: 0, name: 'Normal', character: S.bold() }], lists: [{ id: 1, levels: [{ format: 0, text: '\u0000.' }] }], listOverrides: [1],
    paragraphs: [{ text: 'still here', sprms: S.list(1) }] });
  const view = new DataView(main.buffer);
  for (const index of [1, 15, 73]) view.setUint32(154 + index * 8 + 4, 3, true);
  const result = await importDocumentDoc(createCompoundFile([{ path: 'WordDocument', content: main }, { path: '1Table', content: table }]));
  assert.equal(text(result.document.content), 'still here');
});

test('importDocumentWord routes by content and keeps the DOCX path for everything else', async () => {
  const legacy = doc({ paragraphs: [{ text: '旧形式の文書' }] }), modern = await fixture('word-basic.docx');
  for (const input of [legacy, legacy.buffer.slice(0), new Blob([legacy]), new File([legacy], 'memo.doc'), new File([legacy], 'memo.bin')])
    assert.equal(text((await importDocumentWord(input)).document.content), '旧形式の文書');
  const expected = text((await importDocumentDocx(modern)).document.content);
  for (const input of [modern, new Blob([modern]), new File([modern], 'memo.docx'), new File([modern], 'renamed.doc')])
    assert.equal(text((await importDocumentWord(input)).document.content), expected);
  await assert.rejects(importDocumentWord(new TextEncoder().encode('plain text, not a document')), /Officeファイルを読み込めません: 暗号化されていないOOXMLファイルを指定してください/);
  await assert.rejects(importDocumentWord(new File([legacy], 'locked.docx')), /Officeファイルを読み込めません: 暗号化されていないOOXMLファイルを指定してください/);
});

test('a bundle that only re-exports from the model entry works without anything being loaded first', async () => {
  // Loading a reader on demand would defer the set-up of every module it shares with the model.
  const reexport = await build({ stdin: { contents: `export { createDocument } from './src/model-entry';`, resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'reexport-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
  const { createDocument } = await import(`data:text/javascript;base64,${Buffer.from(reexport.outputFiles[0].text).toString('base64')}`);
  assert.equal(createDocument().content.type, 'doc');
});
