import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

const bundle = await build({ stdin: { contents: `
  export * from './src/model-entry';
  export {openOfficePackage} from './src/ooxml';
  export {createZipArchive} from './src/core';
  export {useSlideEditor} from './src/state/use-slide-editor';
  export {SlideConversionReport} from './src/ui/slide-conversion-report';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=pptx-diagnostics-bundle.js').toString('base64')}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const change = async callback => act(async () => { await callback(); });
function deck() {
  return m.createSlideDeck({ slides: ['A', 'B'].map((name, index) => ({ id: `page-${index}`, name, background: '#ffffff', notes: '',
    elements: [m.createSlideElement({ id: `box-${index}`, name: `Box ${name}`, type: 'shape', x: 20 })],
    animations: [{ id: 'move', animation: { type: 'tween', elementId: `box-${index}`, durationMs: 500, easing: 'spring', to: { x: 200 } } }],
  })) });
}

test('export diagnostics distinguish page/element while the legacy warning stays deduplicated', async () => {
  const warnings = [], diagnostics = [], source = deck(), before = JSON.stringify(source);
  await m.exportSlidePptx(source, { onWarning: warning => warnings.push(warning), onDiagnostic: value => diagnostics.push(value) });
  const spring = diagnostics.filter(item => item.code === 'animation-approximated' && /spring/.test(item.message));
  assert.equal(spring.length, 2);
  assert.deepEqual(spring.map(item => [item.slideIndex, item.slideId, item.slideName, item.elementId, item.elementName, item.animationId]),
    [[0, 'page-0', 'A', 'box-0', 'Box A', 'move'], [1, 'page-1', 'B', 'box-1', 'Box B', 'move']]);
  assert.ok(spring.every(item => item.phase === 'export' && item.action === 'approximation' && item.severity === 'warning'));
  assert.equal(warnings.filter(item => /spring/.test(item)).length, 1);
  assert.ok(diagnostics.every(Object.isFrozen));
  assert.equal(JSON.stringify(source), before);
  await assert.rejects(m.exportSlidePptx(source, { onDiagnostic() { throw new Error('host requires a lossless conversion'); } }), /lossless/);
  assert.equal(JSON.stringify(source), before);
});

async function unsupportedPptx() {
  const archive = await m.openOfficePackage(await m.exportSlidePptx(m.getDeck(deck()))), entries = [];
  const timing = '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:childTnLst><p:anim from="0" to="1" calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="4" dur="100" fill="hold"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl><p:attrNameLst><p:attrName>unsupported.property</p:attrName></p:attrNameLst></p:cBhvr></p:anim></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';
  for (const path of archive.paths) {
    let content = await archive.read(path);
    if (path === 'ppt/slides/slide1.xml') content = new TextEncoder().encode(new TextDecoder().decode(content).replace('</p:sld>', `${timing}</p:sld>`));
    entries.push({ path, content: new Blob([content]) });
  }
  return m.createZipArchive(entries);
}

test('import returns typed source locations and calls diagnostics after validation', async () => {
  const file = await unsupportedPptx(), received = [];
  const result = await m.importSlidePptx(file, { onDiagnostic: item => received.push(item) });
  assert.deepEqual(received, result.diagnostics);
  const issue = result.diagnostics.find(item => item.property === 'unsupported.property');
  assert.ok(issue);
  assert.equal(issue.phase, 'import'); assert.equal(issue.code, 'unsupported-animation');
  assert.equal(issue.slideIndex, 0); assert.equal(issue.slideId, result.deck.slides[0].id);
  assert.equal(issue.elementId, result.deck.slides[0].elements[0].id);
  assert.equal(issue.timingId, '4'); assert.equal(issue.sourcePart, 'ppt/slides/slide1.xml');
  assert.ok(result.warnings.some(message => message.includes('unsupported.property')));
  await assert.rejects(m.importSlidePptx(file, { onDiagnostic() { throw new Error('host refused'); } }), /host refused/);
});

async function mount(t) {
  let editor, renderer; const ref = createRef(), events = [];
  function Probe() { editor = m.useSlideEditor({ ref, initialDeck: deck(), onSave() {}, onEvent: event => events.push(event) }); return null; }
  await change(() => { renderer = create(h(Probe)); });
  t.after(() => change(() => renderer.unmount()));
  return { ref, events, get editor() { return editor; } };
}

test('UI ref exposes isolated latest diagnostics and emits compact conversion results', async t => {
  const app = await mount(t), received = [];
  assert.deepEqual(app.ref.current.getPptxDiagnostics(), []);
  await change(() => app.ref.current.exportPptx({ onDiagnostic: issue => received.push(issue) }));
  assert.equal(app.editor.conversionReport.phase, 'export');
  assert.deepEqual(app.ref.current.getPptxDiagnostics(), received);
  const result = app.events.find(event => event.type === 'conversion');
  assert.equal(result.phase, 'export'); assert.deepEqual(result.diagnostics, received);
  assert.ok(app.editor.notice.text.length < 100);
  const copy = app.ref.current.getPptxDiagnostics(); copy[0].message = 'changed by host';
  assert.notEqual(app.ref.current.getPptxDiagnostics()[0].message, 'changed by host');
  assert.equal(app.editor.dirty, false);
  const file = await unsupportedPptx();
  await change(() => app.ref.current.importPptx(file));
  assert.equal(app.editor.conversionReport.phase, 'import');
  const imported = app.events.find(event => event.type === 'import');
  assert.ok(imported.diagnostics.some(item => item.property === 'unsupported.property'));
  assert.equal(app.editor.canUndo, true);
});

test('conversion report groups by page and selects the reported element without editing data', async t => {
  const app = await mount(t);
  await change(() => app.ref.current.exportPptx());
  let renderer; await change(() => { renderer = create(h(m.SlideConversionReport, { editor: app.editor, onClose() {} })); });
  t.after(() => change(() => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('h3').length, 2);
  const buttons = renderer.root.findAllByType('button').filter(button => button.props.title === '対象を選択');
  await change(() => buttons.at(-1).props.onClick());
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'page-1', elementIds: ['box-1'] });
  assert.equal(app.editor.dirty, false);
  let stopped = false;
  renderer.root.findByType('aside').props.onKeyDown({ key: 'ArrowDown', stopPropagation() { stopped = true; } });
  assert.equal(stopped, true, 'scrolling a report must not move the selected canvas element');
});

test('cancelled ref PPTX export does not publish a partial conversion report or retain the busy state', async t => {
  const app = await mount(t), controller = new AbortController();
  await change(async () => {
    await assert.rejects(app.ref.current.exportPptx({ signal: controller.signal, onDiagnostic() { controller.abort(); } }), { name: 'AbortError' });
  });
  assert.deepEqual(app.ref.current.getPptxDiagnostics(), []);
  assert.equal(app.events.some(event => event.type === 'conversion'), false);
  assert.equal(app.editor.busy, null);
  assert.equal(app.editor.dirty, false);
  await change(() => app.ref.current.exportPptx());
  assert.ok(app.ref.current.getPptxDiagnostics().length);
});
