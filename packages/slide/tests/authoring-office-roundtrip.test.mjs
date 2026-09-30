import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url).pathname;
const bundle = await build({ stdin: { contents: `export * from './src/model-entry';`, resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const samples = [
  { kind: 'hero', title: '止まる前に気づくERPへ', subtitle: '例外業務コックピット', highlights: ['受注', '調達', '会計'] },
  { kind: 'comparison', title: '例外対応を一つの流れに', before: { title: '現在', body: '個別のメールで確認する' }, after: { title: '提案', body: '案件単位で根拠と期限を共有する' } },
  { kind: 'features', title: '判断に必要な情報を集約', items: [{ title: '検知', body: '重要な例外を見つける' }, { title: '根拠', body: '関連伝票を確認する' }, { title: '承認', body: '担当者が判断する' }] },
  { kind: 'flow', title: '発見から承認までつなぐ', steps: [{ title: '検知', body: '納期の遅れを検知' }, { title: '確認', body: '担当者が影響を確認' }, { title: '承認', body: '権限者が対応を承認' }] },
  { kind: 'architecture', title: '既存ERPに連携する', columns: [{ title: '業務', nodes: [{ id: 'erp', title: '既存ERP', body: '受注・在庫・会計' }] }, { title: '連携', nodes: [{ id: 'cases', title: '案件管理', body: 'イベントを集約' }] }, { title: '利用', nodes: [{ id: 'cockpit', title: '担当者画面', body: '確認と承認' }] }], connections: [{ from: 'erp', to: 'cases' }, { from: 'cases', to: 'cockpit' }] },
  { kind: 'closing', title: 'まずは小さく検証する', action: '2部門・3業務から始める', details: '効果を測定し、展開範囲を判断する' },
];

test('semantic layouts remain editable native content through JSON and PPTX roundtrips', async () => {
  let deck = api.createSlideDeck({ slides: samples.map((sample, index) => ({ id: `page-${index}`, name: sample.kind, background: '#fff', notes: '', elements: [] })) });
  deck = api.applySlideCommands(deck, samples.map((composition, index) => ({ type: 'slide.compose', slideId: `page-${index}`, composition, preset: 'executive', notes: `発表者ノート ${index + 1}` }))).deck;
  assert.deepEqual(api.parseSlideDeck(api.serializeSlideDeck(deck)), deck);
  const file = await api.exportSlidePptx(deck);
  const imported = await api.importSlidePptx(file);
  assert.deepEqual(imported.warnings, []);
  assert.equal(imported.deck.slides.length, samples.length);
  for (let index = 0; index < samples.length; index++) {
    const original = deck.slides[index], roundtrip = imported.deck.slides[index];
    const texts = slide => slide.elements.filter(element => element.type !== 'image' && element.text).map(element => element.text).sort();
    assert.deepEqual(texts(roundtrip), texts(original));
    assert.equal(roundtrip.notes.trim(), original.notes);
    assert.equal(roundtrip.elements.length, original.elements.length);
    for (const line of roundtrip.elements.filter(element => element.type === 'shape' && element.line)) {
      for (const point of [line.line.start, line.line.end]) assert.ok(roundtrip.elements.some(element => element.id === point.binding?.targetId));
    }
  }
});

test('composed master-backed pages retain their layout, inherited art and title binding in PowerPoint', async () => {
  const template = new Uint8Array(await readFile(new URL('fixtures/powerpoint-masters.potx', import.meta.url)));
  const library = (await api.importSlidePptxMasters(template)).library;
  let deck = api.createSlideDeck();
  deck = api.applySlideCommands(deck, { type: 'masters.import', library }).deck;
  const layout = deck.layouts.find(item => item.name === 'Title Only');
  assert.ok(layout);
  const slideId = deck.slides[0].id;
  deck = api.applySlideCommands(deck, [{ type: 'slide.applyLayout', slideId, layoutId: layout.id }, { type: 'slide.compose', slideId, composition: samples[4], preset: 'editorial' }]).deck;
  assert.equal(deck.slides[0].layoutId, layout.id);
  assert.ok(deck.slides[0].elements.some(element => element.layoutPlaceholderId));
  const originalAppearance = api.resolveSlideAppearance(deck, deck.slides[0]);
  const imported = await api.importSlidePptx(await api.exportSlidePptx(deck));
  assert.deepEqual(imported.warnings, []);
  assert.equal(imported.deck.masters.length, deck.masters.length);
  assert.equal(imported.deck.layouts.length, deck.layouts.length);
  const importedAppearance = api.resolveSlideAppearance(imported.deck, imported.deck.slides[0]);
  assert.equal(importedAppearance.background, originalAppearance.background);
  assert.equal(importedAppearance.inheritedElements.length, originalAppearance.inheritedElements.length);
  assert.ok(imported.deck.slides[0].elements.some(element => element.layoutPlaceholderId && element.text === samples[4].title));
  assert.deepEqual(importedAppearance.inheritedElements.map(element => element.fill), originalAppearance.inheritedElements.map(element => element.fill));
});
