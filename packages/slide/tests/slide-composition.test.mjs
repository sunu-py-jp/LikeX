import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/model-entry.ts';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createSlideDeck, createSlideElement, applySlideCommands, composeSlideContent, getSlideCompositionPresets, getSlideCompositionLayouts,
  serializeSlideDeck, parseSlideDeck, getSlideLayoutDiagnostics, resolveSlideAppearance, createSlideSession } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const page = (id, elements = [], extra = {}) => ({ id, name: id, background: '#ffffff', notes: 'Keep these notes', elements, ...extra });
const deck = (extra = {}) => createSlideDeck({ slides: [page('first'), page('second')], ...extra });
const measure = (value, style) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)).reduce((width, { segment }) => width + (/^[\x20-\x7f]+$/.test(segment) ? .60 : 1) * style.fontSize, 0);
const examples = [
  { kind: 'hero', title: '止まる前に気づくERPへ', eyebrow: 'ERP / 2026', subtitle: '受注・調達・在庫を、ひとつの判断につなぐ', highlights: ['例外の発見', '根拠の確認', '人による承認'], footer: '提案コンセプト' },
  { kind: 'comparison', title: '例外処理を、一本道へ', before: { title: '現在', body: '情報がメールとExcelに分散。\n担当者ごとに対応が異なる。' }, after: { title: '導入後', body: '案件と担当者を一画面で確認。\n根拠と承認履歴を残す。' } },
  { kind: 'features', title: '現場で使える、三つの価値', items: [{ title: '検知する', body: '例外をまとめて確認する。' }, { title: '根拠を添える', body: '関連する情報を提示する。' }, { title: '承認する', body: '責任者が判断して実行する。' }] },
  { kind: 'flow', title: '判断の流れを見える化', steps: [{ title: '検知', body: '異常を見つける。' }, { title: '確認', body: '影響を整理する。' }, { title: '提案', body: '対応案を選ぶ。' }, { title: '承認', body: '人が判断する。' }, { title: '実行', body: '結果を記録する。' }] },
  { kind: 'architecture', title: '既存ERPを活かす構成', columns: [{ title: 'データ', nodes: [{ id: 'erp', title: 'ERP', body: '受注・調達・会計' }, { id: 'crm', title: 'CRM', body: '顧客と商談' }] }, { title: '業務基盤', nodes: [{ id: 'api', title: '連携API', body: 'イベントを集約' }, { id: 'rule', title: 'ルール', body: '例外を検知' }] }, { title: '利用者', nodes: [{ id: 'screen', title: '業務画面', body: '確認・承認・監査' }] }], connections: [{ from: 'erp', to: 'api', label: '連携' }, { from: 'crm', to: 'rule' }, { from: 'api', to: 'screen' }] },
  { kind: 'closing', title: 'まずは、2部門・3業務から', action: '次の2週間で、対象業務を決める。', details: '現場の責任者と課題を整理し、効果の仮説を検証します。', footer: '提案コンセプト / 2026.09' },
];

test('catalogs publish frozen preset/layout limits and six distinct recipes', () => {
  assert.deepEqual(getSlideCompositionPresets().map(item => item.id), ['executive', 'editorial', 'contrast']);
  assert.deepEqual(getSlideCompositionLayouts().map(item => item.kind), examples.map(item => item.kind));
  assert.throws(() => { getSlideCompositionPresets()[0].name = 'changed'; }, TypeError);
  assert.throws(() => { getSlideCompositionLayouts()[0].textLimits.title = 0; }, TypeError);
  assert.equal(getSlideCompositionLayouts().find(item => item.kind === 'architecture').maxConnections, 8);
});

test('six compositions are deterministic, idempotent, editable and keep other pages', () => {
  for (const composition of examples) for (const { id: preset } of getSlideCompositionPresets()) {
    const source = deck(), before = serializeSlideDeck(source), replacement = composeSlideContent(source, 'first', composition, { preset });
    assert.equal(replacement.type, 'slide.replaceContent');
    assert.deepEqual(replacement, composeSlideContent(source, 'first', composition, { preset }));
    const applied = applySlideCommands(source, { type: 'slide.compose', slideId: 'first', composition, preset });
    assert.deepEqual(applied.deck, applySlideCommands(source, replacement).deck);
    assert.equal(applied.deck.slides[0].id, 'first');
    assert.equal(applied.deck.slides[0].notes, 'Keep these notes');
    assert.equal(applied.deck.slides[1], source.slides[1]);
    assert.equal(applied.deck.slides[0].elements.every(element => ['text', 'shape'].includes(element.type) && !element.locked), true);
    assert.equal(applySlideCommands(applied.deck, { type: 'slide.compose', slideId: 'first', composition, preset }).changed, false);
    assert.deepEqual(getSlideLayoutDiagnostics(applied.deck.slides[0], { width: source.width, height: source.height, measureText: measure }), []);
    assert.deepEqual(parseSlideDeck(serializeSlideDeck(applied.deck)), applied.deck);
    assert.equal(serializeSlideDeck(source), before);
  }
});

test('compositions adapt geometry to standard, full HD and compact canvases without stale animation references', () => {
  for (const [width, height] of [[960, 720], [1920, 1080], [640, 360]]) {
    const source = deck({ width, height });
    for (const composition of [{ kind: 'closing', title: '次の一歩', action: '小さく始める' }, examples[2], examples[3]]) {
      const result = applySlideCommands(source, { type: 'slide.compose', slideId: 'first', composition }).deck;
      assert.deepEqual(getSlideLayoutDiagnostics(result.slides[0], { width, height, measureText: measure }), []);
    }
  }
  const old = createSlideElement({ type: 'text', id: 'old', text: 'Old' });
  const source = deck({ slides: [page('first', [old], { animations: [{ id: 'fade', animation: { type: 'tween', elementId: 'old', durationMs: 200, to: { opacity: 0 } } }] })] });
  const result = applySlideCommands(source, { type: 'slide.compose', slideId: 'first', composition: examples[0], notes: 'New notes' }).deck;
  assert.equal(result.slides[0].animations, undefined);
  assert.equal(result.slides[0].notes, 'New notes');
});

test('composition uses master title slots, reserves inherited edge art and never changes inheritance', () => {
  const title = createSlideElement({ type: 'text', id: 'prototype', x: 64, y: 82, width: 1150, height: 108, text: '', color: '#513b24', fontFamily: 'Georgia', fontSize: 38, bold: true });
  const band = createSlideElement({ type: 'shape', id: 'master-band', shape: 'rect', x: 0, y: 0, width: 1280, height: 40, fill: '#173f5f' });
  const footer = createSlideElement({ type: 'text', id: 'master-footer', x: 70, y: 665, width: 500, height: 45, text: 'Example Corp', fontSize: 18 });
  const source = deck({ masters: [{ id: 'master', name: 'Master', background: '#f8f5ef', elements: [band, footer] }], layouts: [{ id: 'layout', masterId: 'master', name: 'Title', elements: [], placeholders: [{ id: 'title-slot', kind: 'title', element: title }] }], slides: [page('first', [], { layoutId: 'layout', inheritBackground: true })] });
  const result = applySlideCommands(source, { type: 'slide.compose', slideId: 'first', composition: examples[2], preset: 'contrast' }).deck;
  assert.deepEqual(result.masters, source.masters); assert.deepEqual(result.layouts, source.layouts);
  assert.equal(result.slides[0].layoutId, 'layout'); assert.equal(result.slides[0].inheritBackground, true);
  assert.equal(result.slides[0].background, '#ffffff');
  const linked = result.slides[0].elements.find(element => element.layoutPlaceholderId === 'title-slot');
  assert.equal(linked.text, examples[2].title); assert.equal(linked.fontFamily, 'Georgia'); assert.equal(linked.fontSize, 38);
  assert.equal(linked.color, '#513b24'); assert.equal(linked.x, 64); assert.equal(linked.y, 82);
  assert.deepEqual(resolveSlideAppearance(result, result.slides[0]).inheritedElements, [band, footer]);
  assert.ok(result.slides[0].elements.every(element => element.y >= 62 && element.y + element.height <= 643));
});

test('dark master backgrounds get readable foreground without changing the master or covering it', () => {
  const source = deck({ masters: [{ id: 'master', name: 'Dark', background: '#10131f', elements: [] }], layouts: [{ id: 'layout', masterId: 'master', name: 'Blank', elements: [], placeholders: [] }], slides: [page('first', [], { layoutId: 'layout', inheritBackground: true })] });
  const command = composeSlideContent(source, 'first', examples[0]);
  assert.equal(command.background, undefined);
  assert.equal(command.elements.find(element => element.name === 'composition.title').color, '#f4f6fa');
  assert.equal(command.elements.some(element => element.width === 1280 && element.height === 720), false);
});

test('inherited transparent artwork is composited and title placeholder fill/opacity survive', () => {
  const title = createSlideElement({ type: 'text', id: 'title-prototype', x: 64, y: 62, width: 1150, height: 108, text: '', color: '#ffffff', fill: '#173f5f', opacity: .9, fontSize: 38 });
  const overlay = (fill, opacity) => createSlideElement({ type: 'shape', id: 'overlay', shape: 'rect', x: 0, y: 0, width: 1280, height: 720, fill, opacity });
  const make = (elements, placeholders = []) => deck({ masters: [{ id: 'master', name: 'Layered', background: '#ffffff', elements }], layouts: [{ id: 'layout', masterId: 'master', name: 'Blank', elements: [], placeholders }], slides: [page('first', [], { layoutId: 'layout', inheritBackground: true })] });
  for (const art of [overlay('#000000', 0), overlay('#000000', .1), overlay('#0000000a', 1)]) {
    const composed = composeSlideContent(make([art]), 'first', examples[0]);
    assert.equal(composed.elements.find(element => element.name === 'composition.title').color, '#173f5f');
  }
  const linked = composeSlideContent(make([], [{ id: 'slot', kind: 'title', element: title }]), 'first', examples[2]).elements.find(element => element.layoutPlaceholderId);
  assert.equal(linked.color, '#ffffff'); assert.equal(linked.fill, '#173f5f'); assert.equal(linked.opacity, .9);
});

test('flow and architecture produce attached native connectors behind editable node content', () => {
  for (const composition of [examples[3], examples[4]]) {
    const source = deck(), result = applySlideCommands(source, { type: 'slide.compose', slideId: 'first', composition }).deck;
    const elements = result.slides[0].elements, lines = elements.filter(element => element.type === 'shape' && element.shape === 'line');
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(elements.indexOf(line) < elements.findIndex(element => element.id === line.line.start.binding.targetId));
      assert.ok(elements.find(element => element.id === line.line.end.binding.targetId));
      assert.equal(line.endArrow, 'triangle');
    }
    const line = lines[0], targetId = line.line.start.binding.targetId, previousX = line.line.start.x;
    const moved = applySlideCommands(result, { type: 'element.update', slideId: 'first', elementId: targetId, patch: { x: elements.find(element => element.id === targetId).x + 20 } }).deck;
    assert.equal(moved.slides[0].elements.find(element => element.id === line.id).line.start.x, previousX + 20);
  }
});

test('failed composition is atomic including earlier commands and editor history', () => {
  const source = deck(), session = createSlideSession(source), before = serializeSlideDeck(source);
  assert.throws(() => session.execute([{ type: 'deck.rename', title: 'Do not persist' }, { type: 'slide.compose', slideId: 'first', composition: { ...examples[0], title: 'あ'.repeat(65) } }]), /composition.title.*64/);
  assert.equal(serializeSlideDeck(session.getSnapshot().deck), before); assert.equal(session.getSnapshot().canUndo, false);
  session.execute({ type: 'slide.compose', slideId: 'first', composition: examples[0] }); session.undo();
  assert.equal(serializeSlideDeck(session.getSnapshot().deck), before);
  const locked = deck({ slides: [page('first', [createSlideElement({ type: 'text', locked: true })])] });
  assert.throws(() => composeSlideContent(locked, 'first', examples[0]), /ロック/);
});

test('density failures name the exact field, respect graphemes, and never truncate or shrink', () => {
  const source = deck();
  assert.throws(() => composeSlideContent(source, 'first', { ...examples[2], items: [{ title: '項目', body: 'あ'.repeat(161) }, examples[2].items[1]] }), /composition.items\[0\].body.*160/);
  const literal = composeSlideContent(source, 'first', { ...examples[0], subtitle: 'C:\\new\\reports' });
  assert.equal(literal.elements.find(element => element.name === 'composition.subtitle').text, 'C:\\new\\reports');
  assert.throws(() => composeSlideContent(source, 'first', { ...examples[0], title: 'あ\n'.repeat(20) }), /composition.title.*行.*短く/);
  assert.throws(() => composeSlideContent(source, 'first', examples[0], { measureText: () => 10000 }), /composition/);
  assert.throws(() => composeSlideContent(source, 'first', examples[0], { measureText: () => NaN }), /測定した文字幅/);
  const grapheme = '👨‍👩‍👧‍👦';
  const composed = composeSlideContent(source, 'first', { kind: 'hero', title: grapheme.repeat(5) });
  assert.equal(composed.elements.find(element => element.name === 'composition.title').text, grapheme.repeat(5));
});

test('invalid inputs, inherited central artwork and generated ID collisions fail explicitly', () => {
  const source = deck();
  for (const composition of [
    { ...examples[0], kind: 'invalid' }, { ...examples[0], additional: true }, { ...examples[2], items: [] },
    { ...examples[3], steps: Array(6).fill({ title: 'Step', body: 'Body' }) },
    { ...examples[4], connections: [{ from: 'missing', to: 'erp' }] },
    { ...examples[4], connections: [{ from: 'erp', to: 'erp' }] },
    { ...examples[4], connections: [{ from: 'erp', to: 'screen' }] },
    { ...examples[4], connections: [{ from: 'erp', to: 'api' }, { from: 'api', to: 'erp' }] },
  ]) assert.throws(() => composeSlideContent(source, 'first', composition));
  const collision = composeSlideContent(source, 'first', examples[0]).elements[0];
  const colliding = deck({ slides: [page('first'), page('second', [collision])] });
  assert.throws(() => composeSlideContent(colliding, 'first', examples[0]), /衝突/);
  const art = createSlideElement({ type: 'shape', id: 'art', x: 300, y: 260, width: 400, height: 220 });
  const occupied = deck({ masters: [{ id: 'master', name: 'Art', background: '#ffffff', elements: [art] }], layouts: [{ id: 'layout', masterId: 'master', name: 'Art', elements: [], placeholders: [] }], slides: [page('first', [], { layoutId: 'layout', inheritBackground: true })] });
  assert.throws(() => composeSlideContent(occupied, 'first', examples[0]), /マスター.*装飾.*通常の要素編集API/);
  assert.throws(() => composeSlideContent(deck({ width: 300, height: 300 }), 'first', examples[0]), /640/);
});
