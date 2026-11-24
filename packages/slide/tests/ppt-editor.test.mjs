import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { ppt, shape, textRecords, masterStyle, schemeColor, DEFAULT_SCHEME } from './ppt-fixture.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const shared = { name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } };
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useSlideEditor } from './src/state/use-slide-editor.ts';
  export { createSlideDeck } from './src/model/index.ts';
  export { POWERPOINT_IMPORT_ACCEPT, isPowerPointImportFileName, guessPowerPointImportFormat } from './src/import/import-powerpoint.ts';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [shared] });
const { useSlideEditor, createSlideDeck, POWERPOINT_IMPORT_ACCEPT, isPowerPointImportFileName, guessPowerPointImportFormat } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const UNFILLED = 0x00100000, UNLINED = 0x00080000;
const legacy = () => ppt({ masters: [{ id: 0x80000000, kind: 'main', scheme: DEFAULT_SCHEME, styles: [masterStyle(0, [{ paragraph: {}, character: { size: 40, color: schemeColor(1) } }])], shapes: [] }],
  slides: ['表紙', '本文'].map((label, index) => ({ id: 256 + index, masterId: 0x80000000, shapes: [shape({ id: 1030, type: 202, anchor: [0, 0, 600, 3000], properties: [[0x01bf, UNFILLED], [0x01ff, UNLINED]], text: textRecords(4, label) })] })) });
const modern = () => readFile(new URL('./fixtures/powerpoint-basic.pptx', import.meta.url));
async function mount(t, supplied = {}) {
  let editor, renderer;
  const props = { initialDeck: createSlideDeck({ title: 'Original' }), onSave() {}, ...supplied };
  function Probe() { editor = useSlideEditor(props); return null; }
  await change(() => { renderer = create(h(Probe)); });
  t.after(() => change(() => renderer.unmount()));
  return { get editor() { return editor; } };
}
const texts = deck => deck.slides.map(slide => slide.elements.map(element => element.text).join('|'));

test('the handle imports a .ppt presentation as one undoable edit and can open a requested page', async t => {
  const events = [], ref = { current: null }, app = await mount(t, { ref, onEvent: event => events.push(event) }), before = app.editor.deck;
  await change(() => ref.current.importPpt(legacy(), { pageNumber: 2 }));
  assert.deepEqual(texts(app.editor.deck), ['表紙', '本文']);
  assert.equal(ref.current.getPageNumber(), 2);
  assert.deepEqual(events.filter(event => event.type === 'import').length, 1);
  await change(() => ref.current.undo());
  assert.equal(app.editor.deck, before);
});

test('importPptx stays a PPTX-only entry, and a failed .ppt import keeps the draft', async t => {
  const ref = { current: null }, app = await mount(t, { ref }), before = app.editor.deck;
  await change(() => ref.current.importPptx(legacy()));
  assert.equal(app.editor.deck, before);
  assert.equal(app.editor.notice.kind, 'error');
  await change(() => ref.current.importPpt(legacy().subarray(0, 900)));
  assert.equal(app.editor.deck, before);
  assert.match(app.editor.notice.text, /PowerPointを読み込めません/);
});

test('the file picker entry routes by content and refuses other file names before reading', async t => {
  assert.equal(POWERPOINT_IMPORT_ACCEPT, '.pptx,.ppt');
  assert.deepEqual(['a.pptx', 'b.PPT', 'c.potx', 'd.pps', 'ppt'].map(isPowerPointImportFileName), [true, true, false, false, false]);
  assert.deepEqual([guessPowerPointImportFormat(new File([], 'a.ppt')), guessPowerPointImportFormat(new File([], 'a.pptx')), guessPowerPointImportFormat(legacy())], ['ppt', 'pptx', 'ppt']);
  const app = await mount(t);
  await change(() => app.editor.importPowerPoint(new File([legacy()], 'deck.ppt')));
  assert.deepEqual(texts(app.editor.deck), ['表紙', '本文']);
  const pptx = new File([await modern()], 'deck.pptx');
  await change(() => app.editor.importPowerPoint(pptx));
  assert.ok(app.editor.deck.slides.length >= 1 && !texts(app.editor.deck).includes('表紙'));
  const kept = app.editor.deck;
  await change(() => app.editor.importPowerPoint(new File([legacy()], 'deck.key')));
  assert.equal(app.editor.deck, kept);
  assert.match(app.editor.notice.text, /\.pptx または \.ppt 形式のPowerPointファイルを選択してください/);
});
