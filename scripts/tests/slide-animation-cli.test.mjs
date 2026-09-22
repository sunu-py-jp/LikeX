import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
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
    '@likex/core': path.join(repo, 'packages/core/src/index.ts'), '@likex/core/json': path.join(repo, 'packages/core/src/json.ts'), '@likex/core/ooxml': path.join(repo, 'packages/core/src/ooxml.ts'),
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
