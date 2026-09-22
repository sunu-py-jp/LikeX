import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { generatedRenderImagesScript } from '../build-skill-scripts.mjs';

const exec = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let temporary, project, script, input, renderer, model, version, deck;

test.before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'likex-slide-image-cli-'));
  project = path.join(temporary, 'project');
  const installed = path.join(project, 'node_modules/@likex/slide');
  await mkdir(installed, { recursive: true });
  ({ version } = JSON.parse(await readFile(path.join(repo, 'packages/slide/package.json'), 'utf8')));
  await writeFile(path.join(installed, 'package.json'), JSON.stringify({ name: '@likex/slide', version, type: 'module', exports: {
    './model': './model.mjs', './package.json': './package.json',
  } }));
  await build({ entryPoints: [path.join(repo, 'packages/slide/src/model-entry.ts')], outfile: path.join(installed, 'model.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'es2022', alias: {
      '@likex/core': path.join(repo, 'packages/core/src/index.ts'), '@likex/core/json': path.join(repo, 'packages/core/src/json.ts'),
      '@likex/core/ooxml': path.join(repo, 'packages/core/src/ooxml.ts'),
    } });
  model = await import(pathToFileURL(path.join(installed, 'model.mjs')).href);
  deck = model.createSlideDeck({ width: 320, height: 180 });
  deck = model.applySlideCommands(deck, [{ type: 'slide.add', slide: { id: 'second' } }, { type: 'slide.add', slide: { id: 'third' } }]).deck;
  input = path.join(temporary, 'deck.slon');
  await writeFile(input, model.serializeSlideDeck(deck));
  script = path.join(temporary, 'render-images.mjs');
  await writeFile(script, await generatedRenderImagesScript());
  renderer = path.join(temporary, 'renderer.mjs');
  // A real blank PNG encoder keeps tests independent of browsers and graphics dependencies.
  await writeFile(renderer, `import { deflateSync } from 'node:zlib';
const crc = bytes => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i=0;i<8;i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; };
const chunk = (name, data) => { const type = Buffer.from(name), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); type.copy(out,4); data.copy(out,8); out.writeUInt32BE(crc(Buffer.concat([type,data])),8+data.length); return out; };
export function renderSlideImage({width,height,signal}) {
  signal?.throwIfAborted(); const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=6;
  return new Blob([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))],{type:'image/png'});
}`);
});
test.after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

async function run(args, { projectPath = project } = {}) {
  const argv = [...args, ...(projectPath ? ['--project', projectPath] : [])];
  try {
    const result = await exec(process.execPath, [script, ...argv], { cwd: temporary, maxBuffer: 1024 * 1024 });
    assert.equal(result.stderr, ''); return { status: 0, json: JSON.parse(result.stdout) };
  } catch (error) {
    if (!Object.hasOwn(error, 'stdout')) throw error;
    assert.equal(error.stderr, ''); return { status: error.code, json: JSON.parse(error.stdout) };
  }
}
const options = output => ['--input', input, '--renderer', renderer, '--output-dir', path.join(temporary, output)];
const missing = async file => assert.rejects(lstat(file), { code: 'ENOENT' });

test('image CLI exposes help without a runtime and reproduces the generated distributable', async () => {
  const result = await run(['--help'], { projectPath: null });
  assert.equal(result.json.ok, true); assert.match(result.json.renderer, /No packages or browsers/);
  assert.equal(await readFile(path.join(repo, 'packages/slide/skills/likex-slide/scripts/render-images.mjs'), 'utf8'), await generatedRenderImagesScript());
});

test('single page and ordered page lists write valid PNG files without changing the source', async () => {
  const before = await readFile(input, 'utf8');
  const one = await run([...options('one'), '--page-number', '2', '--scale', '2']);
  assert.equal(one.status, 0); assert.equal(one.json.images.length, 1);
  assert.equal(one.json.images[0].width, 640); assert.equal(one.json.images[0].height, 360);
  assert.equal(one.json.images[0].pageNumber, 2); assert.equal(one.json.images[0].slideId, deck.slides[1].id);
  const png = await readFile(one.json.images[0].path);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 640); assert.equal(png.readUInt32BE(20), 360);
  const ordered = await run([...options('ordered'), '--page-numbers', '3,1']);
  assert.equal(ordered.status, 0); assert.deepEqual(ordered.json.images.map(image => image.pageNumber), [3, 1]);
  assert.deepEqual(await readdir(ordered.json.outputDirectory), ['page-0001.png', 'page-0003.png']);
  assert.equal(await readFile(input, 'utf8'), before);
});

test('inclusive range, slide IDs and omitted selectors preserve public model semantics', async () => {
  for (const [name, args, expected] of [
    ['range', ['--range', '2:3'], [2, 3]], ['all', [], [1, 2, 3]],
    ['id', ['--slide-id', deck.slides[1].id], [2]],
    ['ids', ['--slide-ids', JSON.stringify([deck.slides[2].id, deck.slides[0].id])], [3, 1]],
  ]) {
    const result = await run([...options(name), ...args]);
    assert.equal(result.status, 0, JSON.stringify(result)); assert.deepEqual(result.json.images.map(image => image.pageNumber), expected);
  }
});

test('invalid selectors, dimensions and absent renderers never create an output directory', async () => {
  for (const [name, args] of [
    ['duplicate', ['--page-numbers', '1,1']], ['missing-page', ['--page-number', '99']],
    ['mixed', ['--page-number', '1', '--range', '1:2']], ['oversized', ['--scale', '1000']],
    ['invalid-state', ['--animation-state', 'during']], ['bad-range', ['--range', '2:1']], ['bad-id', ['--slide-id', 'missing']],
  ]) {
    const result = await run([...options(name), ...args]);
    assert.equal(result.status, 1); assert.equal(result.json.ok, false); await missing(path.join(temporary, name));
  }
  const noRenderer = await run(['--input', input, '--output-dir', path.join(temporary, 'no-renderer')]);
  assert.equal(noRenderer.json.error.code, 'USAGE'); await missing(path.join(temporary, 'no-renderer'));
});

test('existing output and mid-render failures preserve input and leave no partial images', async () => {
  const output = path.join(temporary, 'existing'); await mkdir(output); await writeFile(path.join(output, 'keep.txt'), 'keep');
  const existing = await run(options('existing'));
  assert.equal(existing.json.error.code, 'OUTPUT_EXISTS'); assert.equal(await readFile(path.join(output, 'keep.txt'), 'utf8'), 'keep');
  const failing = path.join(temporary, 'failing.mjs');
  await writeFile(failing, `import {renderSlideImage as render} from './renderer.mjs'; export function renderSlideImage(request) { if(request.pageNumber===2) throw new Error('renderer failed'); return render(request); }`);
  const failed = await run(['--input', input, '--renderer', failing, '--output-dir', path.join(temporary, 'failed')]);
  assert.equal(failed.status, 1); assert.match(failed.json.error.message, /renderer failed/); await missing(path.join(temporary, 'failed'));
  const bad = path.join(temporary, 'bad.mjs'); await writeFile(bad, `export function renderSlideImage(){return new Blob(['not PNG'],{type:'image/png'});}`);
  const invalid = await run(['--input', input, '--renderer', bad, '--output-dir', path.join(temporary, 'bad')]);
  assert.equal(invalid.status, 1); await missing(path.join(temporary, 'bad'));
});

test('an output directory appearing during rendering is preserved rather than overwritten', async () => {
  const output = path.join(temporary, 'late-directory'), adapter = path.join(temporary, 'create-output.mjs');
  await writeFile(adapter, `import {mkdir,writeFile} from 'node:fs/promises'; import {renderSlideImage as render} from './renderer.mjs';
export async function renderSlideImage(request) { await mkdir(${JSON.stringify(output)}); await writeFile(${JSON.stringify(path.join(output, 'keep.txt'))},'keep'); return render(request); }`);
  const result = await run(['--input', input, '--renderer', adapter, '--output-dir', output, '--page-number', '1']);
  assert.equal(result.status, 1); assert.equal(result.json.error.code, 'EEXIST');
  assert.deepEqual(await readdir(output), ['keep.txt']); assert.equal(await readFile(path.join(output, 'keep.txt'), 'utf8'), 'keep');
});

test('invalid renderer exports and mismatched libraries fail before output creation', async () => {
  const adapter = path.join(temporary, 'no-export.mjs'); await writeFile(adapter, 'export const renderer = 1;');
  const bad = await run(['--input', input, '--renderer', adapter, '--output-dir', path.join(temporary, 'no-export')]);
  assert.equal(bad.json.error.code, 'INVALID_RENDERER'); await missing(path.join(temporary, 'no-export'));
  const projectPath = path.join(temporary, 'wrong-project'), installed = path.join(projectPath, 'node_modules/@likex/slide');
  await mkdir(installed, { recursive: true }); await writeFile(path.join(installed, 'model.mjs'), 'export {};');
  await writeFile(path.join(installed, 'package.json'), JSON.stringify({ version: '999.0.0', type: 'module', exports: { './model': './model.mjs', './package.json': './package.json' } }));
  const mismatch = await run(options('mismatch'), { projectPath });
  assert.equal(mismatch.json.error.code, 'VERSION_MISMATCH'); await missing(path.join(temporary, 'mismatch'));
});


test('animation-state selects final or initial element values for the injected renderer', async () => {
  const animatedInput = path.join(temporary, 'animated.slon');
  const animated = model.createSlideDeck({ width: 320, height: 180, slides: [{ id: 'animated', name: 'Animated', background: '#ffffff', notes: '',
    elements: [model.createSlideElement({ id: 'heading', type: 'text', text: 'Hello', x: 20 })],
    animations: [{ id: 'move', animation: { type: 'tween', elementId: 'heading', durationMs: 500, to: { x: 100 } } }],
  }] });
  await writeFile(animatedInput, model.serializeSlideDeck(animated));
  for (const [state, expected] of [['initial', 20], ['final', 100]]) {
    const adapter = path.join(temporary, `state-${state}.mjs`);
    await writeFile(adapter, `import {renderSlideImage as render} from './renderer.mjs'; export function renderSlideImage(request) { if(request.slide.elements[0].x !== ${expected}) throw new Error('Wrong animation state'); return render(request); }`);
    const result = await run(['--input', animatedInput, '--renderer', adapter, '--output-dir', path.join(temporary, `state-${state}`), '--animation-state', state]);
    assert.equal(result.status, 0, JSON.stringify(result.json)); assert.equal(result.json.images.length, 1);
  }
});
