import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundled = await build({ stdin: { resolveDir: root, contents: `
  export { checkCommandReferences, WriteFailures } from './apps/playground/build/ai/write-diagnostics.ts';
  export { checkSlideWrite } from './apps/playground/build/ai/slide-write-policy.ts';
  export { SkillWorkspace } from './apps/playground/build/ai/tools.ts';
  export * as slide from '@likex/slide/model';
  export * as sheet from '@likex/spreadsheet/model';
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { checkCommandReferences, WriteFailures, checkSlideWrite, SkillWorkspace, slide, sheet } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const source = JSON.stringify({ slides: [{ id: 'page', elements: [{ id: 'a' }, { id: 'b' }, { id: 'line' }] }, { id: 'other', elements: [] }] });
const point = (targetId, port = 'left') => ({ x: 20, y: 30, binding: { targetId, port } });
const add = { type: 'line.add', slideId: 'page', id: 'new-line', start: point('a'), end: point('b') };

test('AI page policy permits line commands on one page and still rejects mixed pages', () => {
  assert.doesNotThrow(() => checkSlideWrite(source, 'apply', [add, { type: 'line.update', slideId: 'page', elementId: 'new-line', endArrow: 'triangle' }]));
  assert.throws(() => checkSlideWrite(source, 'apply', [add, { type: 'line.update', slideId: 'other', elementId: 'line', endArrow: 'triangle' }]), error => error.details.code === 'slide_page_limit');
});

test('connector reference preflight tracks new line IDs and reports exact endpoint paths for both modules', () => {
  assert.doesNotThrow(() => checkCommandReferences('slide', source, [add, { type: 'line.update', slideId: 'page', elementId: 'new-line', start: point('b') }]));
  for (const [module, document, command] of [
    ['slide', source, { ...add, end: point('typo') }],
    ['spreadsheet', JSON.stringify({ sheets: [{ id: 'sheet', drawings: [{ id: 'a' }, { id: 'b' }] }] }), { type: 'lines.insert', sheetId: 'sheet', start: point('a'), end: point('typo') }],
  ]) assert.throws(() => checkCommandReferences(module, document, [command]), error => error.details.code === 'unknown_id' && error.details.path === 'commands[0].end.binding.targetId');
});

test('unknown endpoint repair requires inspect, keeps other targets, and consistently fixes repeated binding IDs', () => {
  const commands = [{ ...add, start: point('typo'), end: point('typo') }, { type: 'line.update', slideId: 'page', elementId: 'line', end: point('b'), endArrow: 'triangle' }];
  const tracker = new WriteFailures();
  let error;
  try { checkCommandReferences('slide', source, commands); } catch (caught) { error = caught; }
  const failureId = tracker.failed('apply', commands, error).details.failureId;
  const corrected = [{ ...commands[0], start: point('a'), end: point('a') }, commands[1]];
  const prepare = batch => tracker.prepare('apply', batch, [failureId]);
  assert.throws(() => prepare(corrected), /バッチ全体/);
  tracker.inspected();
  assert.doesNotThrow(() => prepare(corrected));
  assert.throws(() => prepare([{ ...corrected[0], end: point('b') }, corrected[1]]), /バッチ全体/);
  assert.throws(() => prepare([corrected[0], { ...corrected[1], end: point('a') }]), /バッチ全体/);
  assert.throws(() => prepare([corrected[0], { ...corrected[1], endArrow: undefined }]), /バッチ全体/);
  assert.throws(() => prepare(corrected.slice(0, 1)), /バッチ全体/);
});

test('AI tools apply attached lines through the installed CLI and follow target edits in both modules', async () => {
  const deck = slide.createSlideDeck({ slides: [{ id: 'page', name: 'Page', background: '#ffffff', notes: '', elements: [
    slide.createSlideElement({ type: 'shape', id: 'box', shape: 'rect', x: 100, y: 100, width: 100, height: 80 }),
  ] }] });
  const book = sheet.normalizeWorkbook({ sheets: [{ id: 'page', name: 'Page', rowCount: 20, columnCount: 10, cells: {}, drawings: [
    { id: 'box', type: 'shape', shape: 'rectangle', anchor: { row: 2, column: 2, offsetX: 0, offsetY: 0 }, width: 100, height: 80, fill: '#ffffff', stroke: '#112233', strokeWidth: 2 },
  ] }] });
  for (const moduleName of ['slide', 'spreadsheet']) {
    const source = moduleName === 'slide' ? slide.serializeSlideDeck(deck) : sheet.serializeWorkbook(book);
    const workspace = await SkillWorkspace.create(root, moduleName, source), signal = new AbortController().signal;
    const apply = commands => workspace.invoke('apply_commands', { commands, dryRun: false, resolvesFailureIds: [] }, signal);
    try {
      const endpoints = { start: point('box', 'right'), end: { x: 650, y: 350 }, startArrow: 'oval', endArrow: 'triangle' };
      await apply([moduleName === 'slide' ? { type: 'line.add', slideId: 'page', id: 'connection', ...endpoints } : { type: 'lines.insert', sheetId: 'page', ...endpoints }]);
      if (moduleName === 'slide') {
        await apply([{ type: 'element.update', slideId: 'page', elementId: 'box', patch: { x: 250 } }, { type: 'line.update', slideId: 'page', elementId: 'connection', endArrow: 'openArrow' }]);
        const line = slide.parseSlideDeck((await workspace.result(signal)).document).slides[0].elements.find(element => element.id === 'connection');
        assert.deepEqual(line.line.start, { x: 350, y: 140, binding: { targetId: 'box', port: 'right' } });
        assert.equal(line.startArrow, 'oval'); assert.equal(line.endArrow, 'openArrow');
      } else {
        const first = sheet.parseWorkbook((await workspace.result(signal)).document), lineId = first.sheets[0].drawings.at(-1).id;
        const start = sheet.getSpreadsheetLinePoints(first.sheets[0], lineId).start;
        await apply([{ type: 'shapes.update', sheetId: 'page', drawingId: 'box', patch: { anchor: { row: 2, column: 3, offsetX: 0, offsetY: 0 } } }, { type: 'lines.update', sheetId: 'page', drawingId: lineId, endArrow: 'openArrow' }]);
        const result = sheet.parseWorkbook((await workspace.result(signal)).document).sheets[0], line = result.drawings.at(-1);
        assert.equal(sheet.getSpreadsheetLinePoints(result, lineId).start.x, start.x + 100);
        assert.equal(line.startArrow, 'oval'); assert.equal(line.endArrow, 'openArrow');
      }
      assert.deepEqual(workspace.unresolvedWrites, []);
    } finally { await workspace.dispose(); }
  }
});
