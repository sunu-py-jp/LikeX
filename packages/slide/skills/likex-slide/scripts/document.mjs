#!/usr/bin/env node
// Generated from scripts/skills/document-cli.mjs. Do not edit; run node scripts/build-skill-scripts.mjs.
import { open, lstat, stat, rename, unlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const DOCUMENT_KIND = "slide";
const LIBRARY_VERSION = "0.1.0";
const MAX_COMMAND_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CLI_VERSION = 1;

class CliError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
const fail = (code, message, details) => { throw new CliError(code, message, details); };
const identity = value => value && [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');
const sameFile = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;

function usage(kind, version) {
  const selectors = kind === 'spreadsheet'
    ? '--sheet-id ID [--range A1:C5 | --drawing-id ID [--include-data]]'
    : '--slide-id ID [--element-id ID [--include-data]]';
  return {
    ok: true, kind, libraryVersion: version,
    usage: [
      'node document.mjs create --output FILE [--commands FILE] [--dry-run]',
      `node document.mjs inspect --input FILE [${selectors}]`,
      'node document.mjs apply --input FILE --commands FILE --output FILE [--dry-run]',
      'node document.mjs validate --input FILE',
      'All commands accept --project DIRECTORY. --help and --version need no installed library.',
      '--commands must contain a JSON array. --dry-run permits omitting --output and never writes.',
      '--range returns stored cells. --include-data adds drawing/element text; embedded image bytes are always omitted.',
    ],
    runtime: { package: `@likex/${kind}`, version, node: '>=22.13.0', resolution: '--project, or script package then current directory', autoInstall: false },
    limits: { documentBytes: documentLimit(kind), commandBytes: MAX_COMMAND_BYTES, responseBytes: MAX_RESPONSE_BYTES },
  };
}

function argumentsFor(argv, kind) {
  const args = { operation: argv[0] };
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) return { operation: 'help' };
  if (argv.length === 1 && argv[0] === '--version') return { operation: 'version' };
  if (!['create', 'inspect', 'apply', 'validate'].includes(args.operation)) fail('USAGE', 'Expected create, inspect, apply, or validate. Use --help.');
  const flags = new Set(['dry-run', 'include-data', 'help']);
  const values = new Set(['input', 'output', 'commands', 'project', 'sheet-id', 'range', 'drawing-id', 'slide-id', 'element-id']);
  for (let index = 1; index < argv.length; index++) {
    const raw = argv[index];
    const key = raw.startsWith('--') ? raw.slice(2) : '';
    if (!flags.has(key) && !values.has(key)) fail('USAGE', `Unknown option: ${raw}`);
    if (Object.hasOwn(args, key)) fail('USAGE', `Option --${key} was provided twice.`);
    if (flags.has(key)) args[key] = true;
    else {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail('USAGE', `Option --${key} requires a value.`);
      args[key] = value;
    }
  }
  if (args.help) return { operation: 'help' };
  const write = ['create', 'apply'].includes(args.operation);
  if (args.operation === 'create' && args.input) fail('USAGE', 'create does not accept --input; use apply for existing files.');
  if (args.operation !== 'create' && !args.input) fail('USAGE', '--input is required.');
  if (args.operation === 'apply' && !args.commands) fail('USAGE', '--commands is required for apply.');
  if (write && !args.output && !args['dry-run']) fail('USAGE', '--output is required unless --dry-run is set.');
  if (!write && (args.output || args.commands || args['dry-run'])) fail('USAGE', 'Only create and apply accept --output, --commands, and --dry-run.');
  const queryKeys = ['sheet-id', 'range', 'drawing-id', 'slide-id', 'element-id', 'include-data'];
  if (args.operation !== 'inspect' && queryKeys.some(key => args[key])) fail('USAGE', 'Query selectors are only valid for inspect.');
  const wrongKeys = kind === 'spreadsheet' ? ['slide-id', 'element-id'] : ['sheet-id', 'range', 'drawing-id'];
  if (wrongKeys.some(key => args[key])) fail('USAGE', `Unsupported selector for ${kind}.`);
  if ((args.range || args['drawing-id']) && !args['sheet-id']) fail('USAGE', '--range and --drawing-id require --sheet-id.');
  if (args.range && args['drawing-id']) fail('USAGE', 'Choose --range or --drawing-id.');
  if (args['element-id'] && !args['slide-id']) fail('USAGE', '--element-id requires --slide-id.');
  if (args['include-data'] && !args['drawing-id'] && !args['element-id']) fail('USAGE', '--include-data requires --drawing-id or --element-id.');
  return args;
}

function documentLimit(kind) { return (kind === 'spreadsheet' ? 64 : 80) * 1024 * 1024 * 3; }

/** Bound byte reads as well as preflight size, including a file growing during the read. */
async function readBounded(file, limit) {
  const handle = await open(file, 'r');
  try {
    const snapshot = await handle.stat({ bigint: true });
    if (!snapshot.isFile()) fail('INVALID_FILE', `Expected a regular file: ${file}`);
    if (snapshot.size > BigInt(limit)) fail('FILE_TOO_LARGE', `File exceeds the ${limit}-byte limit: ${file}`);
    const chunks = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) fail('FILE_TOO_LARGE', `File exceeds the ${limit}-byte limit: ${file}`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    if (identity(snapshot) !== identity(await handle.stat({ bigint: true }))) fail('FILE_CHANGED', `File changed while being read: ${file}`);
    return { text: Buffer.concat(chunks, total).toString('utf8'), snapshot, file: path.resolve(file) };
  } finally { await handle.close(); }
}

async function optionalStat(file) {
  try { return await lstat(file, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function outputSnapshot(file) {
  const value = await optionalStat(file);
  if (value && (value.isSymbolicLink() || !value.isFile())) fail('INVALID_OUTPUT', 'Output must be a regular file or a new path; symbolic links are not accepted.');
  return value;
}

async function writeAtomic(file, serialized, before, source) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', before ? Number(before.mode & 0o777n) : 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    const current = await outputSnapshot(file);
    if (identity(current) !== identity(before)) fail('FILE_CHANGED', 'Output changed before the write could be committed.');
    if (source && (source.file === file || sameFile(before, source.snapshot))) {
      if (identity(source.snapshot) !== identity(await stat(source.file, { bigint: true }))) fail('FILE_CHANGED', 'Input changed before the write could be committed.');
    }
    await rename(temporary, file);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function loadModel(kind, version, project, scriptUrl) {
  const name = `@likex/${kind}`;
  const locations = project ? [pathToFileURL(path.join(path.resolve(project), '__likex_resolver__.cjs'))]
    : [scriptUrl, pathToFileURL(path.join(process.cwd(), '__likex_resolver__.cjs'))];
  let lastError;
  for (const location of locations) {
    const require = createRequire(location);
    let modelPath, packagePath;
    try { modelPath = require.resolve(`${name}/model`); packagePath = require.resolve(`${name}/package.json`); }
    catch (error) { lastError = error; continue; }
    const metadata = JSON.parse((await readBounded(packagePath, 1024 * 1024)).text);
    if (metadata.version !== version) fail('VERSION_MISMATCH', `This skill requires ${name}@${version}; found ${metadata.version}. Use the matching skill and library release.`);
    try { return await import(pathToFileURL(modelPath).href); }
    catch (error) { fail('RUNTIME_UNAVAILABLE', `Could not load ${name}/model. Build or install ${name}@${version} in the project first. ${error.message}`); }
  }
  fail('RUNTIME_UNAVAILABLE', `Cannot resolve ${name}/model. Build or install ${name}@${version}, run from that project or pass --project DIRECTORY. No packages were installed. ${lastError?.code ?? ''}`);
}

function sheetSummary(sheet) {
  return { id: sheet.id, name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount,
    cellCount: Object.keys(sheet.cells).length, drawingCount: sheet.drawings?.length ?? 0,
    commentCount: Object.keys(sheet.comments ?? {}).length, mergeCount: sheet.merges?.length ?? 0, tableCount: sheet.tables?.length ?? 0 };
}

function summaryFor(kind, document) {
  if (kind === 'spreadsheet') return { format: 'likex.spreadsheet', sheetCount: document.sheets.length,
    imageCount: Object.keys(document.resources?.images ?? {}).length, namedRangeCount: document.namedRanges?.length ?? 0,
    sheets: document.sheets.map(sheetSummary) };
  return { format: 'likex.slide', id: document.id, title: document.title, width: document.width, height: document.height,
    slideCount: document.slides.length, elementCount: document.slides.reduce((sum, slide) => sum + slide.elements.length, 0),
    slides: document.slides.map(slide => ({ id: slide.id, name: slide.name, elementCount: slide.elements.length })) };
}

function objectSummary(item) {
  const keys = ['id', 'type', 'name', 'shape', 'anchor', 'x', 'y', 'width', 'height', 'rotation', 'locked', 'resourceId'];
  return { ...Object.fromEntries(keys.filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]])),
    ...(typeof item.text === 'string' ? { textLength: item.text.length } : {}),
    ...(typeof item.alt === 'string' ? { altLength: item.alt.length } : {}) };
}

function selectedObject(item, includeData) {
  if (!item) fail('NOT_FOUND', 'The selected drawing or element was not found.');
  if (!includeData) return objectSummary(item);
  // Only known image payload fields are omitted; text remains available for explicit, bounded reads.
  return Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'src' && key !== 'dataUrl'));
}

function selectionFor(kind, model, document, args) {
  if (kind === 'spreadsheet' && args['sheet-id']) {
    const sheet = document.sheets.find(item => item.id === args['sheet-id']);
    if (!sheet) fail('NOT_FOUND', 'The selected sheet was not found.');
    if (args.range) return { sheetId: sheet.id, range: args.range, cells: model.getRange(document, sheet.id, args.range) };
    if (args['drawing-id']) return { sheetId: sheet.id, drawing: selectedObject(model.getDrawing(document, sheet.id, args['drawing-id']), args['include-data']) };
    return { sheet: sheetSummary(sheet), drawings: (sheet.drawings ?? []).map(objectSummary),
      namedRanges: model.getNamedRanges(document, sheet.id),
      tables: model.getTables(document, sheet.id).map(table => ({ id: table.id, name: table.name, sheetId: table.sheetId,
        range: table.range, address: table.address, columnCount: table.columns.length })) };
  }
  if (kind === 'slide' && args['slide-id']) {
    const slide = model.getSlide(document, args['slide-id']);
    if (!slide) fail('NOT_FOUND', 'The selected slide was not found.');
    if (args['element-id']) return { slideId: slide.id, element: selectedObject(model.getElement(document, slide.id, args['element-id']), args['include-data']) };
    return { slide: { id: slide.id, name: slide.name, background: slide.background, notesLength: slide.notes.length,
      elementCount: slide.elements.length }, elements: slide.elements.map(objectSummary) };
  }
  return undefined;
}

function encodedResponse(value) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > MAX_RESPONSE_BYTES) fail('RESPONSE_TOO_LARGE', 'Result exceeds 1 MiB. Inspect a smaller range or omit --include-data.');
  return json;
}

export async function runDocumentCli({ argv = process.argv.slice(2), kind = DOCUMENT_KIND, version = LIBRARY_VERSION,
  scriptUrl = import.meta.url, stdout = process.stdout } = {}) {
  let operation = argv[0] ?? 'help';
  try {
    if (!['spreadsheet', 'slide'].includes(kind)) fail('USAGE', 'Run a generated skill script, not scripts/skills/document-cli.mjs directly.');
    const args = argumentsFor(argv, kind);
    operation = args.operation;
    const base = { ok: true, kind, operation, libraryVersion: version };
    if (operation === 'help') { stdout.write(`${encodedResponse({ ...base, ...usage(kind, version) })}\n`); return 0; }
    if (operation === 'version') { stdout.write(`${encodedResponse({ ...base, cliVersion: CLI_VERSION })}\n`); return 0; }
    const model = await loadModel(kind, version, args.project, scriptUrl);
    const spreadsheet = kind === 'spreadsheet';
    const parse = spreadsheet ? model.parseWorkbook : model.parseSlideDeck;
    const serialize = spreadsheet ? model.serializeWorkbook : model.serializeSlideDeck;
    let source, document;
    if (args.input) { source = await readBounded(args.input, documentLimit(kind)); document = parse(source.text); }
    else document = spreadsheet ? model.createWorkbook() : model.createSlideDeck();
    const output = args.output ? path.resolve(args.output) : null;
    const before = output ? await outputSnapshot(output) : null;
    let commands = [], changed = operation === 'create', receipt;
    if (args.commands) {
      try { commands = JSON.parse((await readBounded(args.commands, MAX_COMMAND_BYTES)).text); }
      catch (error) { if (error instanceof SyntaxError) fail('INVALID_COMMANDS', 'Commands file must be valid JSON.'); throw error; }
      if (!Array.isArray(commands)) fail('INVALID_COMMANDS', 'Commands file must contain a JSON array, even for a single command.');
      try {
        receipt = spreadsheet ? model.applySpreadsheetCommands(document, commands) : model.applySlideCommands(document, commands);
        if (spreadsheet && !receipt.ok) fail(receipt.code, receipt.message, { ...(receipt.commandIndex !== undefined ? { commandIndex: receipt.commandIndex } : {}) });
        document = spreadsheet ? receipt.workbook : receipt.deck;
        changed = changed || receipt.changed;
      } catch (error) { if (error instanceof CliError) throw error; fail('COMMAND_FAILED', error.message); }
    }
    if (operation === 'inspect') {
      const selection = selectionFor(kind, model, document, args);
      stdout.write(`${encodedResponse({ ...base, summary: summaryFor(kind, document), ...(selection ? { selection } : {}) })}\n`);
      return 0;
    }
    // A complete native serialization and parse must succeed before any output is created.
    const serialized = serialize(document);
    parse(serialized);
    if (operation === 'validate') {
      stdout.write(`${encodedResponse({ ...base, valid: true, summary: summaryFor(kind, document) })}\n`);
      return 0;
    }
    const result = encodedResponse({ ...base, dryRun: Boolean(args['dry-run']), written: !args['dry-run'], output,
      commandCount: commands.length, changed, summary: summaryFor(kind, document) });
    if (!args['dry-run']) await writeAtomic(output, serialized, before, source);
    stdout.write(`${result}\n`);
    return 0;
  } catch (error) {
    stdout.write(`${JSON.stringify({ ok: false, kind, operation, libraryVersion: version,
      error: { code: error instanceof CliError ? error.code : error.code ?? 'VALIDATION_FAILED',
        message: error.message ?? String(error), ...(error instanceof CliError ? error.details : {}) } })}\n`);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runDocumentCli();
