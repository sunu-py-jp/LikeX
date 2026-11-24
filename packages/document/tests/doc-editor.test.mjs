import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { doc, S } from './doc-fixture.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const shared = { name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } };
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
export { useDocumentEditor } from './src/state/use-document-editor.ts';
export { createDocument, getDocumentText } from './src/model/index.ts';
export { WORD_IMPORT_ACCEPT, WORD_IMPORT_FILE_MESSAGE, isWordImportFileName, guessWordImportFormat } from './src/io/import-word.ts';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [shared] });
const { useDocumentEditor, createDocument, getDocumentText, WORD_IMPORT_ACCEPT, isWordImportFileName, guessWordImportFormat } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const base = () => createDocument({ id: 'document', title: 'Original', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'paragraph' }, content: [{ type: 'text', text: 'Alpha beta' }] }] } });
const legacy = () => doc({ paragraphs: [{ runs: [{ text: '旧形式 ' }, { text: 'の文書', sprms: S.bold() }] }, { text: 'second\u000cpage' }] });
const modern = () => readFile(new URL('./fixtures/word-basic.docx', import.meta.url));
async function mount(t, supplied = {}) {
  let editor, renderer;
  const props = { initialDocument: base(), onSave() {}, ...supplied };
  function Probe() { editor = useDocumentEditor(props); return null; }
  await change(() => { renderer = create(h(Probe)); });
  t.after(() => change(() => renderer.unmount()));
  return { get editor() { return editor; } };
}
const imports = events => events.filter(event => event.type === 'import').map(event => event.format);

test('the handle imports a .doc document as one undoable edit and reports its format', async t => {
  const events = [], ref = { current: null }, app = await mount(t, { ref, onEvent: event => events.push(event) }), before = app.editor.document;
  await change(() => ref.current.importDoc(legacy()));
  assert.equal(getDocumentText(app.editor.document).replace(/\s+/g, ' ').trim(), '旧形式 の文書 second page');
  assert.deepEqual(imports(events), ['doc']);
  await change(() => ref.current.undo());
  assert.equal(app.editor.document, before);
});

test('the handle can open the page of a .doc document that a caller asks for', async t => {
  const ref = { current: null }, app = await mount(t, { ref });
  await change(() => ref.current.importDoc(legacy(), { pageNumber: 2 }));
  assert.ok(ref.current.getSelection().from > 1);
  const kept = app.editor.document;
  await change(() => ref.current.importDoc(legacy(), { pageNumber: 9 }));
  assert.equal(app.editor.document, kept, 'a page that does not exist keeps the draft');
});

test('importDocx stays a DOCX-only entry, and a failed .doc import keeps the draft', async t => {
  const events = [], ref = { current: null }, app = await mount(t, { ref, onEvent: event => events.push(event) }), before = app.editor.document;
  await change(() => ref.current.importDocx(legacy()));
  assert.equal(app.editor.document, before);
  assert.match(app.editor.notice.text, /暗号化されていないOOXMLファイルを指定してください/);
  await change(() => ref.current.importDoc(legacy().subarray(0, 700)));
  assert.equal(app.editor.document, before);
  assert.match(app.editor.notice.text, /Word文書を読み込めません/);
  assert.deepEqual(imports(events), []);
});

test('the file picker entry routes by content and labels each import with its format', async t => {
  const events = [], app = await mount(t, { onEvent: event => events.push(event) });
  await change(() => app.editor.importFile(new File([legacy()], 'memo.doc'), 'word'));
  assert.ok(getDocumentText(app.editor.document).includes('旧形式'));
  const docx = new File([await modern()], 'memo.docx');
  await change(() => app.editor.importFile(docx, 'word'));
  await change(() => app.editor.importFile(legacy(), 'word'));
  assert.deepEqual(imports(events), ['doc', 'docx', 'doc']);
});

test('the file picker offers both Word formats and refuses other names before reading', async t => {
  assert.equal(WORD_IMPORT_ACCEPT, '.docx,.doc');
  assert.deepEqual(['a.docx', 'b.DOC', 'c.dotx', 'd.txt', 'doc'].map(isWordImportFileName), [true, true, false, false, false]);
  assert.deepEqual([guessWordImportFormat(new File([], 'a.doc')), guessWordImportFormat(new File([], 'a.docx')), guessWordImportFormat(legacy()), guessWordImportFormat(new Uint8Array(8))], ['doc', 'docx', 'doc', 'docx']);
  const events = [], app = await mount(t, { onEvent: event => events.push(event) }), before = app.editor.document;
  await change(() => app.editor.importFile(new File([legacy()], 'memo.txt'), 'word'));
  assert.equal(app.editor.document, before);
  assert.match(app.editor.notice.text, /\.docx または \.doc 形式のWord文書を選択してください/);
  assert.deepEqual(imports(events), []);
});
