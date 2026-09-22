#!/usr/bin/env node
// Generated from scripts/skills/render-images-cli.mjs. Do not edit; run node scripts/build-skill-scripts.mjs.
import { open, readFile, mkdir, unlink, rmdir, lstat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LIBRARY_VERSION = "0.1.0";
const INPUT_BYTES = 240 * 1024 * 1024;
const OUTPUT_BYTES = 100 * 1024 * 1024;
class CliError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new CliError(code, message); };
const usage = {
  usage: 'node render-images.mjs --input FILE --renderer FILE --output-dir NEW_DIRECTORY [--project DIRECTORY] [--page-number N | --slide-id ID | --range FROM:TO | --page-numbers N,N | --slide-ids JSON_ARRAY] [--scale N] [--animation-state initial|final]',
  renderer: 'Local module with named export renderSlideImage(request), returning a PNG Blob. No packages or browsers are installed.',
  output: 'New directory containing page-NNNN.png files. Existing output paths are rejected. JSON images preserve the requested order.',
};
function argumentsFor(argv) {
  if (!argv.length || (argv.length === 1 && argv[0] === '--help')) return { help: true };
  if (argv.length === 1 && argv[0] === '--version') return { version: true };
  const allowed = ['input', 'renderer', 'output-dir', 'project', 'page-number', 'slide-id', 'range', 'page-numbers', 'slide-ids', 'scale', 'animation-state'];
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], key = flag.startsWith('--') ? flag.slice(2) : '';
    if (!allowed.includes(key) || Object.hasOwn(args, key)) fail('USAGE', `Unknown or repeated option: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) fail('USAGE', `Option ${flag} requires a value.`);
    args[key] = value;
  }
  for (const key of ['input', 'renderer', 'output-dir']) if (!args[key]) fail('USAGE', `--${key} is required.`);
  const selected = ['page-number', 'slide-id', 'range', 'page-numbers', 'slide-ids'].filter(key => args[key] !== undefined);
  if (selected.length > 1) fail('USAGE', 'Choose only one page selector.');
  const integer = value => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) fail('USAGE', 'Page numbers must be positive integers.');
    return Number(value);
  };
  const options = {};
  if (args['page-number']) options.pageNumber = integer(args['page-number']);
  if (args['slide-id']) options.slideId = args['slide-id'];
  if (args.range) {
    const range = args.range.split(':');
    if (range.length !== 2) fail('USAGE', '--range expects FROM:TO.');
    options.range = { from: integer(range[0]), to: integer(range[1]) };
  }
  if (args['page-numbers']) options.pageNumbers = args['page-numbers'].split(',').map(integer);
  if (args['slide-ids']) {
    try { options.slideIds = JSON.parse(args['slide-ids']); } catch { fail('USAGE', '--slide-ids expects a JSON array of IDs.'); }
    if (!Array.isArray(options.slideIds) || !options.slideIds.length || !options.slideIds.every(id => typeof id === 'string' && id.length))
      fail('USAGE', '--slide-ids expects a nonempty JSON array of IDs.');
  }
  if (args['animation-state'] !== undefined) {
    if (!['initial', 'final'].includes(args['animation-state'])) fail('USAGE', '--animation-state must be initial or final.');
    options.animationState = args['animation-state'];
  }
  if (args.scale !== undefined) {
    options.scale = Number(args.scale);
    if (!Number.isFinite(options.scale) || options.scale <= 0) fail('USAGE', '--scale must be a positive finite number.');
  }
  return { ...args, options, single: args['page-number'] !== undefined || args['slide-id'] !== undefined };
}
async function readInput(file) {
  const handle = await open(file, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(INPUT_BYTES)) fail('INVALID_INPUT', 'Input must be a regular file of at most 240 MiB.');
    const chunks = []; let length = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, INPUT_BYTES - length + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > INPUT_BYTES) fail('INVALID_INPUT', 'Input exceeds 240 MiB.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail('INPUT_CHANGED', 'Input changed while being read.');
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
  } finally { await handle.close(); }
}
async function loadModel(project, scriptUrl, version) {
  const locations = project ? [pathToFileURL(path.join(path.resolve(project), '__likex_resolver__.cjs'))]
    : [scriptUrl, pathToFileURL(path.join(process.cwd(), '__likex_resolver__.cjs'))];
  for (const location of locations) {
    const require = createRequire(location);
    let modelPath, metadataPath;
    try { modelPath = require.resolve('@likex/slide/model'); metadataPath = require.resolve('@likex/slide/package.json'); }
    catch { continue; }
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (metadata.version !== version) fail('VERSION_MISMATCH', `This skill requires @likex/slide@${version}; found ${metadata.version}.`);
    const model = await import(pathToFileURL(modelPath).href);
    if (typeof model.exportImages !== 'function' || typeof model.exportImage !== 'function') fail('RUNTIME_UNAVAILABLE', 'Build or install a matching @likex/slide with image export support.');
    return model;
  }
  fail('RUNTIME_UNAVAILABLE', `Cannot resolve @likex/slide/model. Build or install version ${version}, or pass --project DIRECTORY. No packages were installed.`);
}
async function requireNewDirectory(directory) {
  try { await lstat(directory); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  fail('OUTPUT_EXISTS', 'Output directory must not exist. Choose a new --output-dir.');
}
async function writeImages(directory, images, signal) {
  // Rendering and byte reads finish before the output directory is created.
  const buffers = []; let total = 0;
  for (const image of images) {
    signal.throwIfAborted();
    const bytes = Buffer.from(await image.blob.arrayBuffer());
    total += bytes.length;
    if (bytes.length !== image.blob.size || total > OUTPUT_BYTES) fail('INVALID_IMAGE', 'PNG bytes changed or exceed the 100 MiB output budget.');
    buffers.push(bytes);
  }
  signal.throwIfAborted();
  await mkdir(directory, { mode: 0o700 }); // Exclusive: never overwrite an existing directory, including races.
  const created = [];
  try {
    const results = [];
    for (let index = 0; index < images.length; index++) {
      signal.throwIfAborted();
      const image = images[index], file = path.join(directory, `page-${String(image.pageNumber).padStart(4, '0')}.png`);
      const handle = await open(file, 'wx', 0o600);
      created.push(file);
      try { await handle.writeFile(buffers[index]); await handle.sync(); } finally { await handle.close(); }
      results.push({ path: file, width: image.width, height: image.height, mimeType: image.mimeType, pageNumber: image.pageNumber, slideId: image.slideId });
    }
    signal.throwIfAborted();
    return results;
  } catch (error) {
    for (const file of created) await unlink(file).catch(() => {});
    await rmdir(directory).catch(() => {});
    throw error;
  }
}

export async function runRenderImagesCli({ argv = process.argv.slice(2), version = LIBRARY_VERSION,
  scriptUrl = import.meta.url, stdout = process.stdout } = {}) {
  const base = { kind: 'slide', operation: 'render-images', libraryVersion: version };
  const abort = new AbortController();
  const cancel = () => abort.abort(new Error('Image export cancelled.'));
  try {
    const args = argumentsFor(argv);
    if (args.help || args.version) { stdout.write(`${JSON.stringify({ ok: true, ...base, ...(args.help ? usage : { cliVersion: 1 }) })}\n`); return 0; }
    const directory = path.resolve(args['output-dir']);
    await requireNewDirectory(directory);
    const model = await loadModel(args.project, scriptUrl, version);
    const deck = model.parseSlideDeck(await readInput(args.input));
    const rendererPath = path.resolve(args.renderer);
    if (!(await lstat(rendererPath)).isFile()) fail('INVALID_RENDERER', '--renderer must name a local regular JavaScript module.');
    const adapter = await import(pathToFileURL(rendererPath).href);
    if (typeof adapter.renderSlideImage !== 'function') fail('INVALID_RENDERER', 'Renderer must export a function named renderSlideImage.');
    process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
    const options = { ...args.options, renderer: adapter.renderSlideImage, signal: abort.signal };
    const images = args.single ? [await model.exportImage(deck, options)] : await model.exportImages(deck, options);
    const results = await writeImages(directory, images, abort.signal);
    stdout.write(`${JSON.stringify({ ok: true, ...base, outputDirectory: directory, images: results })}\n`);
    return 0;
  } catch (error) {
    stdout.write(`${JSON.stringify({ ok: false, ...base, error: { code: error.code ?? 'EXPORT_FAILED', message: error.message ?? String(error) } })}\n`);
    return 1;
  } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runRenderImagesCli();
