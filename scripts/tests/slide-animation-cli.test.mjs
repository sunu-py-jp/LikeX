import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { generatedSkillScript } from '../build-skill-scripts.mjs';

const exec = promisify(execFile), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let temporary, script, input, model, animation;
test.before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'likex-animation-cli-'));
  const installed = path.join(temporary, 'node_modules/@likex/slide');
  await mkdir(installed, { recursive: true });
  const { version } = JSON.parse(await readFile(path.join(repo, 'packages/slide/package.json'), 'utf8'));
  await writeFile(path.join(installed, 'package.json'), JSON.stringify({ name: '@likex/slide', version, type: 'module', exports: { './model': './model.mjs', './package.json': './package.json' } }));
  await build({ entryPoints: [path.join(repo, 'packages/slide/src/model-entry.ts')], outfile: path.join(installed, 'model.mjs'), bundle: true, platform: 'node', format: 'esm', alias: {
    '@likex/core': path.join(repo, 'packages/core/src/index.ts'), '@likex/core/office-shapes': path.join(repo, 'packages/core/src/office-shapes.ts'), '@likex/core/connectors': path.join(repo, 'packages/core/src/connectors.ts'), '@likex/core/json': path.join(repo, 'packages/core/src/json.ts'), '@likex/core/ooxml': path.join(repo, 'packages/core/src/ooxml.ts'),
  } });
  model = await import(pathToFileURL(path.join(installed, 'model.mjs')).href);
  animation = { id: 'move', name: 'Move heading', trigger: { type: 'click', elementId: 'heading' }, animation: {
    type: 'tween', elementId: 'heading', durationMs: 600, from: { opacity: 0 }, to: { x: 100, opacity: 1 }, easing: 'ease-out',
  } };
  const deck = model.createSlideDeck({ slides: [{ id: 'cover', name: 'Cover', background: '#ffffff', notes: '', animations: [animation], elements: [
    model.createSlideElement({ id: 'heading', type: 'text', x: 20, opacity: 0.5, text: 'Hello' }),
  ] }] });
  input = path.join(temporary, 'deck.slon'); await writeFile(input, model.serializeSlideDeck(deck));
  script = path.join(temporary, 'document.mjs'); await writeFile(script, await generatedSkillScript('slide'));
});
test.after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });
async function run(args, entry = script) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [entry, ...args], { cwd: temporary, maxBuffer: 1024 * 1024 });
    assert.equal(stderr, ''); return { status: 0, json: JSON.parse(stdout) };
  } catch (error) {
    if (!Object.hasOwn(error, 'stdout')) throw error;
    assert.equal(error.stderr, ''); return { status: error.code, json: JSON.parse(error.stdout) };
  }
}
const inspect = args => run(['inspect', '--input', input, ...args]);

test('slide inspect defaults to final static values and opt-in returns source values with definitions', async () => {
  const before = await readFile(input, 'utf8');
  const normal = await inspect(['--slide-id', 'cover', '--element-id', 'heading', '--include-data']);
  assert.equal(normal.status, 0); assert.equal(normal.json.selection.element.x, 100); assert.equal(normal.json.selection.element.opacity, 1);
  assert.equal('animations' in normal.json.selection, false);
  const full = await inspect(['--slide-id', 'cover', '--element-id', 'heading', '--include-data', '--include-animations']);
  assert.equal(full.status, 0); assert.equal(full.json.selection.element.x, 20); assert.equal(full.json.selection.element.opacity, 0.5);
  assert.equal(full.json.selection.animations[0].id, 'move'); assert.equal(full.json.selection.animations[0].animation.to.x, 100);
  const whole = await inspect(['--include-animations']);
  assert.equal(whole.json.animations[0].slideId, 'cover'); assert.equal(whole.json.animations[0].animations[0].trigger.elementId, 'heading');
  const slide = await inspect(['--slide-id', 'cover', '--include-animations']);
  assert.equal(slide.json.selection.elements[0].x, 20); assert.equal(slide.json.selection.animations[0].id, 'move');
  assert.equal(await readFile(input, 'utf8'), before);
});

test('apply and native serialization preserve definitions while changing source element values', async () => {
  const commands = path.join(temporary, 'commands.json'), output = path.join(temporary, 'edited.slon');
  await writeFile(commands, JSON.stringify([{ type: 'element.update', slideId: 'cover', elementId: 'heading', patch: { x: 40 } }]));
  const result = await run(['apply', '--input', input, '--commands', commands, '--output', output]);
  assert.equal(result.status, 0);
  const deck = model.parseSlideDeck(await readFile(output, 'utf8'));
  assert.equal(deck.slides[0].elements[0].x, 40); assert.equal(deck.slides[0].animations[0].id, 'move');
  const remove = path.join(temporary, 'remove.json');
  await writeFile(remove, JSON.stringify([{ type: 'animation.remove', slideId: 'cover', animationId: 'move' }]));
  assert.equal((await run(['apply', '--input', output, '--commands', remove, '--output', output])).status, 0);
  assert.equal(model.parseSlideDeck(await readFile(output, 'utf8')).slides[0].animations?.length ?? 0, 0);
});

test('include-animations is limited to slide inspect and help explains the final-state default', async () => {
  const invalid = await run(['validate', '--input', input, '--include-animations']);
  assert.equal(invalid.status, 1); assert.equal(invalid.json.error.code, 'USAGE');
  const other = path.join(temporary, 'spreadsheet.mjs'); await writeFile(other, await generatedSkillScript('spreadsheet'));
  const crossModule = await run(['inspect', '--input', input, '--include-animations'], other);
  assert.equal(crossModule.status, 1); assert.equal(crossModule.json.error.code, 'USAGE');
  const help = await run(['--help']); assert.ok(help.json.usage.some(line => line.includes('--include-animations')));
});

test('imported layouts are discoverable and inherited decorations remain separate from editable placeholders', async () => {
  let deck = model.createSlideDeck({ slides: [{ id: 'page', name: 'Page', background: '#ffffff', notes: '', elements: [] }] });
  deck = model.applySlideCommands(deck, { type: 'masters.import', library: { width: 1280, height: 720,
    masters: [{ id: 'brand', name: 'Brand', background: '#112233', elements: [model.createSlideElement({ id: 'logo', type: 'text', text: 'Common logo' })] }],
    layouts: [{ id: 'title-layout', masterId: 'brand', name: 'Title', elements: [], placeholders: [
      { id: 'title-slot', kind: 'title', element: model.createSlideElement({ id: 'title-prototype', type: 'text', text: '' }) },
    ] }],
  } }).deck;
  const layoutId = model.getSlideLayouts(deck)[0].id, masterId = model.getSlideMasters(deck)[0].id;
  const placeholderId = model.getSlideLayouts(deck)[0].placeholders[0].id;
  deck = model.applySlideCommands(deck, { type: 'slide.applyLayout', slideId: 'page', layoutId }).deck;
  const catalogFile = path.join(temporary, 'catalog.slon'); await writeFile(catalogFile, model.serializeSlideDeck(deck));
  const query = args => run(['inspect', '--input', catalogFile, ...args]);
  const overview = (await query(['--overview'])).json;
  assert.equal(overview.summary.masterCount, 1); assert.equal(overview.summary.layoutCount, 1);
  assert.equal(overview.summary.layouts, undefined);
  const list = (await query([])).json;
  assert.equal(list.summary.layouts[0].id, layoutId); assert.equal(list.summary.layouts[0].placeholders[0].kind, 'title');
  const layout = await query(['--layout-id', layoutId, '--include-data', '--compact-summary']);
  assert.equal(layout.status, 0); assert.equal(layout.json.selection.placeholders[0].element.type, 'text');
  assert.equal(layout.json.summary.layouts, undefined);
  const master = (await query(['--master-id', masterId, '--include-data'])).json;
  assert.equal(master.selection.elements[0].text, 'Common logo');
  const page = (await query(['--slide-id', 'page', '--include-data'])).json;
  assert.equal(page.selection.slide.background, '#112233');
  assert.equal(page.selection.elements[0].layoutPlaceholderId, placeholderId);
  assert.equal(page.selection.inheritedElements[0].text, 'Common logo');
  assert.equal(page.selection.elements.some(element => element.text === 'Common logo'), false);
  assert.equal((await query(['--layout-id', 'absent'])).json.error.code, 'NOT_FOUND');
  assert.equal((await query(['--layout-id', layoutId, '--slide-id', 'page'])).json.error.code, 'USAGE');
  assert.equal((await query(['--layout-id', layoutId, '--include-animations'])).json.error.code, 'USAGE');
});

test('image inspection deduplicates bytes, preserves placements and never returns image payloads', async () => {
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=';
  const bytes = Buffer.from(src.split(',')[1], 'base64'), imageId = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const deck = model.createSlideDeck({ slides: [
    { id: 'first', name: 'First', background: '#ffffff', notes: '', elements: [
      model.createSlideElement({ id: 'small', type: 'image', src, name: 'Logo', alt: 'Brand mark', x: 12, width: 30, height: 20, opacity: 0 }),
    ], animations: [{ id: 'grow', animation: { type: 'tween', elementId: 'small', durationMs: 300, from: { x: 0 }, to: { x: 80, width: 90, opacity: 1 } } }] },
    { id: 'second', name: 'Second', background: '#ffffff', notes: '', elements: [
      model.createSlideElement({ id: 'large', type: 'image', src, x: 200, width: 300, height: 200 }),
    ] },
  ] });
  const imageFile = path.join(temporary, 'image-deck.slon'), before = model.serializeSlideDeck(deck);
  await writeFile(imageFile, before);
  const query = args => run(['inspect', '--input', imageFile, '--images', ...args]);
  const final = await query([]);
  assert.equal(final.status, 0, JSON.stringify(final.json));
  assert.deepEqual(final.json.selection.images, [{ imageId, mimeType: 'image/png', byteLength: bytes.length }]);
  assert.deepEqual(final.json.selection.placements.map(item => [item.imageId, item.slideId, item.pageNumber, item.elementId, item.source, item.sourceId, item.x, item.width, item.opacity]), [
    [imageId, 'first', 1, 'small', 'slide', 'first', 80, 90, 1],
    [imageId, 'second', 2, 'large', 'slide', 'second', 200, 300, 1],
  ]);
  assert.equal(final.json.selection.placements[0].name, 'Logo'); assert.equal(final.json.selection.placements[0].alt, 'Brand mark');
  assert.doesNotMatch(JSON.stringify(final.json), /base64|iVBORw0KGgo|"src"|"dataUrl"/);
  const initial = await query(['--include-animations', '--compact-summary']);
  assert.equal(initial.status, 0, JSON.stringify(initial.json));
  assert.equal(initial.json.selection.placements[0].x, 12); assert.equal(initial.json.selection.placements[0].width, 30); assert.equal(initial.json.selection.placements[0].opacity, 0);
  assert.deepEqual(initial.json.selection.images, final.json.selection.images);
  assert.equal(initial.json.summary.slides, undefined); assert.equal(initial.json.animations, undefined);
  assert.equal(await readFile(imageFile, 'utf8'), before);
  const empty = await inspect(['--images', '--compact-summary']);
  assert.equal(empty.status, 0); assert.deepEqual(empty.json.selection, { images: [], placements: [] });
});

test('image inspection rejects other selectors, other operations and other modules', async () => {
  for (const selector of [['--overview'], ['--slide-id', 'cover'], ['--element-id', 'heading'], ['--master-id', 'brand'], ['--layout-id', 'layout'], ['--include-data'], ['--offset', '0']]) {
    const result = await inspect(['--images', ...selector]);
    assert.equal(result.status, 1); assert.equal(result.json.error.code, 'USAGE', JSON.stringify(result.json));
  }
  for (const operation of ['validate', 'create', 'apply']) {
    const options = operation === 'create' ? ['--dry-run'] : ['--input', input, ...(operation === 'apply' ? ['--commands', input, '--dry-run'] : [])];
    const result = await run([operation, ...options, '--images']);
    assert.equal(result.status, 1); assert.equal(result.json.error.code, 'USAGE');
  }
  const other = path.join(temporary, 'board-images.mjs'); await writeFile(other, await generatedSkillScript('board'));
  const unsupported = await run(['inspect', '--input', input, '--images'], other);
  assert.equal(unsupported.status, 1); assert.equal(unsupported.json.error.code, 'USAGE');
  const help = await run(['--help']);
  assert.ok(help.json.usage.some(line => line.includes('--images returns') && line.includes('SHA-256')));
});

test('image inspection keeps the response-size guard and returns no partial image report', async () => {
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=';
  const deck = model.createSlideDeck({ slides: [{ id: 'many-images', name: 'Images', background: '#ffffff', notes: '', elements:
    Array.from({ length: 110 }, (_, index) => model.createSlideElement({ id: `image-${index}`, type: 'image', src, alt: 'a'.repeat(10_000) })),
  }] });
  const file = path.join(temporary, 'large-image-report.slon'); await writeFile(file, model.serializeSlideDeck(deck));
  const result = await run(['inspect', '--input', file, '--images', '--compact-summary']);
  assert.equal(result.status, 1); assert.equal(result.json.error.code, 'RESPONSE_TOO_LARGE');
  assert.equal(result.json.selection, undefined);
});
