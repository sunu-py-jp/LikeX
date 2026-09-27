import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { build } from 'esbuild';
import { copyFile, mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { buildSkillScripts, generatedSkillScript, skillKinds } from '../build-skill-scripts.mjs';
import { checkSkillConsumer } from '../lib/skill-consumer.mjs';

const exec = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let temporary, project;
const fixtures = {};

test.before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'likex-skill-cli-'));
  project = path.join(temporary, 'host-project');
  await mkdir(project);
  // Bundle current source into an isolated headless host; these tests never require dist or a prior library build.
  for (const kind of skillKinds) {
    const metadata = JSON.parse(await readFile(path.join(repo, `packages/${kind}/package.json`), 'utf8'));
    const installed = path.join(project, `node_modules/@likex/${kind}`);
    const script = path.join(installed, `skills/likex-${kind}/scripts/document.mjs`);
    await mkdir(path.dirname(script), { recursive: true });
    await writeFile(path.join(installed, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, type: 'module',
      exports: { './model': './model.mjs', './package.json': './package.json' } }));
    await writeFile(script, await generatedSkillScript(kind));
    await build({ entryPoints: [path.join(repo, `packages/${kind}/src/model-entry.ts`)], outfile: path.join(installed, 'model.mjs'),
      bundle: true, format: 'esm', platform: 'node', target: 'es2022',
      alias: { '@likex/core/json': path.join(repo, 'packages/core/src/json.ts'),
        '@likex/core/ooxml': path.join(repo, 'packages/core/src/ooxml.ts'), '@likex/core': path.join(repo, 'packages/core/src/index.ts') } });
    fixtures[kind] = { installed, script, version: metadata.version, model: await import(pathToFileURL(path.join(installed, 'model.mjs')).href) };
  }
});
test.after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

async function run(kind, args, { script = fixtures[kind].script, cwd = temporary } = {}) {
  try {
    const result = await exec(process.execPath, [script, ...args], { cwd, maxBuffer: 3 * 1024 * 1024 });
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.trim().split('\n').length, 1, 'one machine-readable stdout object');
    return { status: 0, json: JSON.parse(result.stdout) };
  } catch (error) {
    if (!Object.hasOwn(error, 'stdout')) throw error;
    assert.equal(error.stderr, '');
    assert.equal(error.stdout.trim().split('\n').length, 1, 'one machine-readable error object');
    return { status: error.code, json: JSON.parse(error.stdout) };
  }
}
async function paths(kind) {
  const directory = await mkdtemp(path.join(temporary, `${kind}-`));
  return { directory, input: path.join(directory, 'input.json'), output: path.join(directory, 'output.json'), commands: path.join(directory, 'commands.json') };
}
const renameCommand = (kind, summary, title) => ({
  spreadsheet: () => ({ type: 'sheets.rename', sheetId: summary.sheets[0].id, name: title }),
  slide: () => ({ type: 'deck.rename', title }), document: () => ({ type: 'document.update', title }),
  board: () => ({ type: 'board.rename', title }), dataview: () => ({ type: 'data.rename', title }),
  diagram: () => ({ type: 'diagram.update', title }), whiteboard: () => ({ type: 'whiteboard.update', title }),
  calendar: () => ({ type: 'calendar.update', title }), chat: () => ({ type: 'chat.update', title }), aichat: () => ({ type: 'aichat.update', title }),
  form: () => ({ type: 'form.update', patch: { title } }),
}[kind]());
const modelFunctions = (kind, model) => {
  const [suffix, applyName, resultKey] = {
    spreadsheet: ['Workbook', 'applySpreadsheetCommands', 'workbook'], slide: ['SlideDeck', 'applySlideCommands', 'deck'],
    document: ['Document', 'executeDocumentCommands', 'document'], board: ['Board', 'executeBoardCommands', 'board'],
    dataview: ['DataView', 'executeDataViewCommands', 'data'], diagram: ['Diagram', 'executeDiagramCommands'],
    whiteboard: ['Whiteboard', 'executeWhiteboardCommands'], calendar: ['Calendar', 'executeCalendarCommands', 'calendar'],
    chat: ['Chat', 'executeChatCommands', 'chat'], aichat: ['AIChat', 'executeAIChatCommands', 'aichat'], form: ['Form', 'executeFormCommands'],
  }[kind];
  return { parse: model[`parse${suffix}`], serialize: model[`serialize${suffix}`], apply: model[applyName], result: value => resultKey ? value[resultKey] : value };
};

test('committed standalone scripts match the one canonical source and current package versions', async () => {
  await buildSkillScripts({ check: true });
});

test('documented native files and command examples execute through the public models', async () => {
  for (const kind of skillKinds) {
    const reference = path.join(repo, `packages/${kind}/skills/likex-${kind}/references`);
    const examples = async name => [...(await readFile(path.join(reference, name), 'utf8'))
      .matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => match[1]);
    const [native] = await examples('schema-guide.md');
    assert.ok(native, `${kind} native example`);
    const model = fixtures[kind].model;
    const { parse, serialize, apply, result: resultDocument } = modelFunctions(kind, model);
    const commands = await examples('commands.md');
    assert.ok(commands.length, `${kind} command examples`);
    for (const example of commands) {
      const result = apply(parse(native), JSON.parse(example));
      if (kind === 'spreadsheet') assert.equal(result.ok, true, JSON.stringify(result));
      const saved = serialize(resultDocument(result));
      assert.equal(serialize(parse(saved)), saved);
    }
  }
});

for (const kind of skillKinds) {
  test(`${kind}: packaged consumer skill verification uses the same public runtime`, async () => {
    const result = await checkSkillConsumer({ module: kind, installed: fixtures[kind].installed, consumer: project });
    assert.equal(result.createApplyValidate, 'passed'); assert.equal(result.copiedSkill, 'passed');
  });

  test(`${kind}: self-contained installed script creates, inspects, applies, and validates native files`, async () => {
    const files = await paths(kind);
    const created = await run(kind, ['create', '--output', files.input]);
    assert.equal(created.status, 0);
    assert.equal(created.json.written, true);
    assert.equal(created.json.libraryVersion, fixtures[kind].version);
    const original = await readFile(files.input, 'utf8');
    const native = JSON.parse(original);
    assert.equal(native.format, `likex.${kind}`);
    if (kind === 'spreadsheet') assert.ok(!('cells' in native.sheets[0]), 'uses native file rows, not runtime cells');
    const inspected = await run(kind, ['inspect', '--input', files.input]);
    assert.equal(inspected.status, 0);
    assert.deepEqual(inspected.json.summary, created.json.summary);
    await writeFile(files.commands, JSON.stringify([renameCommand(kind, created.json.summary, 'New title')]));
    const applied = await run(kind, ['apply', '--input', files.input, '--commands', files.commands, '--output', files.output]);
    assert.equal(applied.status, 0);
    assert.equal(applied.json.changed, true);
    assert.equal(applied.json.commandCount, 1);
    assert.equal(await readFile(files.input, 'utf8'), original, 'separate output leaves source untouched');
    assert.equal(kind === 'spreadsheet' ? applied.json.summary.sheets[0].name : applied.json.summary.title, 'New title');
    assert.equal((await run(kind, ['validate', '--input', files.output])).json.valid, true);
    const { parse, serialize } = modelFunctions(kind, fixtures[kind].model);
    const saved = await readFile(files.output, 'utf8');
    assert.equal(serialize(parse(saved)), saved, 'writes the dedicated stable serializer output');
    assert.deepEqual((await readdir(files.directory)).sort(), ['commands.json', 'input.json', 'output.json']);
  });

  test(`${kind}: invalid batches and malformed native files never truncate output or input`, async () => {
    const files = await paths(kind);
    const created = await run(kind, ['create', '--output', files.input]);
    const original = await readFile(files.input, 'utf8');
    await writeFile(files.output, 'keep this output');
    await writeFile(files.commands, JSON.stringify([renameCommand(kind, created.json.summary, 'Must not commit'), { type: 'invalid.command' }]));
    const failed = await run(kind, ['apply', '--input', files.input, '--commands', files.commands, '--output', files.output]);
    assert.notEqual(failed.status, 0);
    assert.equal(failed.json.ok, false);
    assert.ok(failed.json.error.code);
    if (kind === 'spreadsheet') assert.equal(failed.json.error.commandIndex, 1);
    assert.equal(await readFile(files.input, 'utf8'), original);
    assert.equal(await readFile(files.output, 'utf8'), 'keep this output');
    await writeFile(files.commands, JSON.stringify(renameCommand(kind, created.json.summary, 'Bad root')));
    assert.equal((await run(kind, ['apply', '--input', files.input, '--commands', files.commands, '--output', files.input])).json.error.code, 'INVALID_COMMANDS');
    assert.equal(await readFile(files.input, 'utf8'), original);
    await writeFile(files.input, '{"format":"unsupported"}');
    assert.notEqual((await run(kind, ['apply', '--input', files.input, '--commands', files.commands, '--output', files.output])).status, 0);
    assert.equal(await readFile(files.output, 'utf8'), 'keep this output');
  });

  test(`${kind}: dry runs validate commands and explicit in-place writes work atomically`, async () => {
    const files = await paths(kind);
    const preview = await run(kind, ['create', '--dry-run']);
    assert.equal(preview.status, 0);
    assert.equal(preview.json.written, false);
    const created = await run(kind, ['create', '--output', files.input]);
    const original = await readFile(files.input, 'utf8');
    await writeFile(files.commands, JSON.stringify([renameCommand(kind, created.json.summary, 'Updated')]));
    const dry = await run(kind, ['apply', '--input', files.input, '--commands', files.commands, '--output', files.output, '--dry-run']);
    assert.equal(dry.status, 0);
    assert.equal(dry.json.dryRun, true);
    assert.equal(await readFile(files.input, 'utf8'), original);
    await assert.rejects(readFile(files.output), { code: 'ENOENT' });
    assert.equal((await run(kind, ['apply', '--input', files.input, '--commands', files.commands, '--output', files.input])).status, 0);
    assert.notEqual(await readFile(files.input, 'utf8'), original);
    await symlink(files.input, files.output);
    const rejected = await run(kind, ['create', '--output', files.output]);
    assert.equal(rejected.json.error.code, 'INVALID_OUTPUT');
    assert.equal((await run(kind, ['validate', '--input', files.input])).status, 0);
  });

  test(`${kind}: a copied skill resolves the host runtime, without dependencies reports actionable JSON`, async () => {
    const files = await paths(kind);
    const copied = path.join(files.directory, 'document.mjs');
    await copyFile(fixtures[kind].script, copied);
    assert.equal((await run(kind, ['create', '--dry-run', '--project', project], { script: copied })).status, 0);
    assert.equal((await run(kind, ['create', '--dry-run'], { script: copied, cwd: project })).status, 0);
    const missing = await run(kind, ['create', '--dry-run'], { script: copied });
    assert.equal(missing.json.error.code, 'RUNTIME_UNAVAILABLE');
    assert.match(missing.json.error.message, /--project/);
    assert.equal((await run(kind, ['--help'], { script: copied })).status, 0);
    assert.equal((await run(kind, ['--version'], { script: copied })).json.cliVersion, 1);
    const mismatchRoot = path.join(files.directory, 'wrong-project');
    const mismatchPackage = path.join(mismatchRoot, `node_modules/@likex/${kind}`);
    await mkdir(mismatchPackage, { recursive: true });
    await writeFile(path.join(mismatchPackage, 'package.json'), JSON.stringify({ name: `@likex/${kind}`, version: '999.0.0',
      exports: { './model': './model.mjs', './package.json': './package.json' } }));
    await writeFile(path.join(mismatchPackage, 'model.mjs'), 'throw new Error("wrong runtime must not execute");');
    assert.equal((await run(kind, ['create', '--dry-run', '--project', mismatchRoot], { script: copied })).json.error.code, 'VERSION_MISMATCH');
  });

  test(`${kind}: rejects unsupported options and oversized files before parsing`, async () => {
    for (const args of [['create'], ['create', '--dry-run', '--surprise'], ['inspect', '--input', 'missing', '--range', 'A1'],
      ['create', '--dry-run', '--input', 'missing'], ['create', '--output', 'first', '--output', 'second']]) {
      assert.equal((await run(kind, args)).json.error.code, 'USAGE');
    }
    const files = await paths(kind);
    const handle = await open(files.input, 'w');
    await handle.truncate(({ spreadsheet: 192, slide: 240, document: 40, board: 48, dataview: 96, diagram: 24, whiteboard: 120, calendar: 5, chat: 32, aichat: 32, form: 8 }[kind]) * 1024 * 1024 + 1);
    await handle.close();
    assert.equal((await run(kind, ['validate', '--input', files.input])).json.error.code, 'FILE_TOO_LARGE');
    await writeFile(files.input, 'not JSON');
    assert.notEqual((await run(kind, ['validate', '--input', files.input])).status, 0);
    await writeFile(files.input, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
    assert.equal((await run(kind, ['validate', '--input', files.input])).json.error.code, 'INVALID_UTF8');
  });
}

test('spreadsheet selectors discover drawing IDs and explicitly read a bounded cell range', async () => {
  const files = await paths('spreadsheet');
  await writeFile(files.commands, JSON.stringify([
    { type: 'cells.set', sheetId: 'sheet-1', values: { A1: 'secret cell', B1: '=1+2' } },
    { type: 'textBoxes.insert', sheetId: 'sheet-1', anchor: { row: 0, column: 0 }, text: 'secret drawing' },
    { type: 'namedRanges.add', sheetId: 'sheet-1', name: 'InputValues', range: 'A1:B1' },
    { type: 'tables.insert', sheetId: 'sheet-1', name: 'InputTable', target: { row: 0, column: 3 },
      headers: ['Heading'], data: { type: 'rows', values: [['private table body']] } },
  ]));
  assert.equal((await run('spreadsheet', ['create', '--commands', files.commands, '--output', files.input])).status, 0);
  const beforeInspect = await readFile(files.input, 'utf8');
  const summary = await run('spreadsheet', ['inspect', '--input', files.input]);
  assert.doesNotMatch(JSON.stringify(summary), /secret/);
  const sheet = await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'sheet-1']);
  const drawingId = sheet.json.selection.drawings[0].id;
  assert.doesNotMatch(JSON.stringify(sheet), /secret|private table body/);
  const namedRange = sheet.json.selection.namedRanges[0];
  assert.equal(typeof namedRange.id, 'string');
  assert.equal(namedRange.name, 'InputValues');
  assert.equal(namedRange.sheetId, 'sheet-1');
  assert.equal(namedRange.address, 'A1:B1');
  assert.deepEqual(namedRange.range, { top: 0, left: 0, bottom: 0, right: 1 });
  const table = sheet.json.selection.tables[0];
  assert.equal(typeof table.id, 'string');
  assert.equal(table.name, 'InputTable');
  assert.equal(table.sheetId, 'sheet-1');
  assert.equal(table.address, 'D1:D2');
  assert.equal(table.columnCount, 1);
  assert.deepEqual(table.range, { top: 0, left: 3, bottom: 1, right: 3 });
  assert.equal(await readFile(files.input, 'utf8'), beforeInspect, 'metadata inspection never writes');
  const drawing = await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'sheet-1', '--drawing-id', drawingId, '--include-data']);
  assert.equal(drawing.json.selection.drawing.text, 'secret drawing');
  const range = await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'sheet-1', '--range', 'A1:C2']);
  assert.deepEqual(range.json.selection, { sheetId: 'sheet-1', range: 'A1:C2', rows: [
    [{ value: 'secret cell' }, { value: '=1+2' }, null], [null, null, null],
  ] });
  assert.equal((await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'missing'])).json.error.code, 'NOT_FOUND');
  const values = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`A${index + 1}`, 'x'.repeat(100_000)]));
  await writeFile(files.commands, JSON.stringify([{ type: 'cells.set', sheetId: 'sheet-1', values }]));
  await run('spreadsheet', ['apply', '--input', files.input, '--commands', files.commands, '--output', files.input]);
  assert.equal((await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'sheet-1', '--range', 'A1:A12'])).json.error.code, 'RESPONSE_TOO_LARGE');
});

async function spreadsheetSearchFixture() {
  const files = await paths('spreadsheet'), model = fixtures.spreadsheet.model;
  const sheet = (id, name, cells) => ({ id, name, rowCount: 300, columnCount: 26, cells });
  const workbook = model.normalizeWorkbook({ sheets: [
    sheet('sales', 'Sales', { A1: { value: 'Revenue' }, B2: { value: 'Revenue forecast' }, B3: { value: 'REVENUE' }, C2: { value: '=2+3' }, D4: { value: '--help' } }),
    sheet('sales-old', 'Sales archive', { A1: { value: 'Revenue' } }),
    sheet('notes', 'Notes', Object.fromEntries(Array.from({ length: 103 }, (_, index) => [`A${index + 1}`, { value: `page-${index}` }]))),
  ] });
  await writeFile(files.input, model.serializeWorkbook(workbook));
  return files;
}

test('spreadsheet and slide overview return only document counts and title without lists or content', async () => {
  const files = await spreadsheetSearchFixture();
  const spreadsheet = await run('spreadsheet', ['inspect', '--input', files.input, '--overview']);
  assert.equal(spreadsheet.status, 0); assert.deepEqual(spreadsheet.json.summary, { format: 'likex.spreadsheet', sheetCount: 3, imageCount: 0, namedRangeCount: 0 });
  assert.equal(spreadsheet.json.selection, undefined); assert.doesNotMatch(JSON.stringify(spreadsheet), /Revenue|Sales|sales|Notes|page-/);
  const slideFiles = await paths('slide'), model = fixtures.slide.model, deck = { ...model.createSlideDeck(), title: 'Overview deck' };
  await writeFile(slideFiles.input, model.serializeSlideDeck(deck));
  const slide = await run('slide', ['inspect', '--input', slideFiles.input, '--overview']);
  assert.equal(slide.status, 0); assert.deepEqual(slide.json.summary, { format: 'likex.slide', title: 'Overview deck', slideCount: deck.slides.length, elementCount: deck.slides.reduce((sum, item) => sum + item.elements.length, 0) });
  assert.equal(slide.json.selection, undefined); assert.equal(slide.json.animations, undefined);
  assert.equal((await run('slide', ['inspect', '--input', slideFiles.input])).json.summary.slides.length, deck.slides.length, 'ordinary inspect retains the list');
  for (const [kind, input, selectors] of [
    ['spreadsheet', files.input, ['--sheet-id', 'sales']], ['spreadsheet', files.input, ['--include-data']], ['spreadsheet', files.input, ['--search', 'cells', '--text', 'Revenue']],
    ['spreadsheet', files.input, ['--offset', '0']], ['spreadsheet', files.input, ['--match-case']], ['spreadsheet', files.input, ['--range', 'A1']],
    ['slide', slideFiles.input, ['--slide-id', 'slide-1']], ['slide', slideFiles.input, ['--include-animations']], ['slide', slideFiles.input, ['--include-data']],
  ]) assert.equal((await run(kind, ['inspect', '--input', input, '--overview', ...selectors])).json.error.code, 'USAGE');
  assert.equal((await run('spreadsheet', ['validate', '--input', files.input, '--overview'])).json.error.code, 'USAGE');
  assert.equal((await run('aichat', ['inspect', '--input', files.input, '--overview'])).json.error.code, 'USAGE');
});

test('spreadsheet sheet content lists sorted stored cells from only the selected sheet with bounded pagination', async () => {
  const files = await spreadsheetSearchFixture(), original = await readFile(files.input, 'utf8');
  const inspect = async (...options) => { const result = await run('spreadsheet', ['inspect', '--input', files.input, ...options]); assert.equal(result.status, 0, JSON.stringify(result.json)); return result.json; };
  const selected = (await inspect('--sheet-id', 'sales', '--include-data')).selection;
  assert.deepEqual(selected.cells.map(cell => cell.address), ['A1', 'B2', 'C2', 'B3', 'D4']);
  assert.equal(selected.sheet.id, 'sales'); assert.equal(selected.cells[2].value, '=2+3'); assert.equal(selected.offset, 0); assert.equal(selected.limit, 100); assert.equal(selected.total, 5); assert.equal(selected.hasMore, false);
  assert.doesNotMatch(JSON.stringify(selected), /page-/); assert.equal(selected.drawings, undefined);
  const paged = (await inspect('--sheet-id', 'notes', '--include-data')).selection;
  assert.equal(paged.cells.length, 100); assert.equal(paged.total, 103); assert.equal(paged.hasMore, true);
  const last = (await inspect('--sheet-id', 'notes', '--include-data', '--offset', '102', '--limit', '2')).selection;
  assert.deepEqual(last.cells, [{ address: 'A103', value: 'page-102' }]); assert.equal(last.hasMore, false);
  assert.deepEqual((await inspect('--sheet-id', 'notes', '--include-data', '--offset', '200')).selection.cells, []);
  const metadata = (await inspect('--sheet-id', 'sales')).selection; assert.equal(metadata.cells, undefined); assert.doesNotMatch(JSON.stringify(metadata), /Revenue/);
  assert.equal(await readFile(files.input, 'utf8'), original, 'content inspection preserves the native file');
  for (const args of [['--include-data'], ['--sheet-id', 'sales', '--limit', '1'], ['--sheet-id', 'sales', '--include-data', '--range', 'A1'], ['--sheet-id', 'sales', '--include-data', '--search', 'cells', '--text', 'Revenue'], ['--sheet-id', 'sales', '--include-data', '--limit', '1001']]) {
    assert.equal((await run('spreadsheet', ['inspect', '--input', files.input, ...args])).json.error.code, 'USAGE');
  }
  assert.equal((await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'missing', '--include-data'])).json.error.code, 'NOT_FOUND');
});

test('spreadsheet sheet content preserves formatting and empty stored cells while enforcing output limits', async () => {
  const files = await paths('spreadsheet'), model = fixtures.spreadsheet.model;
  const sheet = (id, cells) => ({ id, name: id, rowCount: 300, columnCount: 26, cells });
  const workbook = model.normalizeWorkbook({ sheets: [sheet('data', { D4: { value: '', format: { bold: true } }, B2: { value: 'Text', format: { italic: true } } }), sheet('empty', {}),
    sheet('large', Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`A${index + 1}`, { value: 'x'.repeat(100_000) }])))] });
  await writeFile(files.input, model.serializeWorkbook(workbook));
  const result = await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'data', '--include-data']);
  assert.equal(result.status, 0); assert.deepEqual(result.json.selection.cells, [{ address: 'B2', value: 'Text', format: { italic: true } }, { address: 'D4', value: '', format: { bold: true } }]);
  assert.equal(Object.hasOwn(result.json.selection, 'rows'), false, 'stored-cell lists remain flat cells, without a matrix alias');
  const range = await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'data', '--range', 'B2:D4']);
  assert.equal(range.status, 0);
  assert.deepEqual(range.json.selection, { sheetId: 'data', range: 'B2:D4', rows: [
    [{ value: 'Text', format: { italic: true } }, null, null],
    [null, null, null],
    [null, null, { value: '', format: { bold: true } }],
  ] });
  const empty = await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'empty', '--include-data']); assert.deepEqual(empty.json.selection.cells, []); assert.equal(empty.json.selection.total, 0);
  const large = await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'large', '--include-data']); assert.equal(large.json.error.code, 'RESPONSE_TOO_LARGE');
  const bounded = await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'large', '--include-data', '--limit', '1']); assert.equal(bounded.status, 0); assert.equal(bounded.json.selection.cells[0].value.length, 100_000);
});

test('compact inspect summaries omit unrelated lists before output size limits while preserving selected content', async () => {
  const files = await paths('slide'), model = fixtures.slide.model, base = model.createSlideDeck();
  const element = model.createSlideElement({ type: 'text', id: 'target', text: 'Only the requested content' });
  const deck = model.createSlideDeck({ ...base, slides: Array.from({ length: 400 }, (_, index) => ({ ...base.slides[0], id: `page-${index}`, name: '界'.repeat(1000), elements: index === 0 ? [element] : [] })) });
  const original = model.serializeSlideDeck(deck); await writeFile(files.input, original);
  const args = ['inspect', '--input', files.input, '--slide-id', 'page-0', '--element-id', 'target', '--include-data'];
  const tooLarge = await run('slide', args); assert.equal(tooLarge.json.error.code, 'RESPONSE_TOO_LARGE', 'legacy full summary exceeds 1MiB even for one short target');
  const compact = await run('slide', [...args, '--compact-summary']); assert.equal(compact.status, 0, JSON.stringify(compact.json));
  assert.equal(compact.json.summary.slides, undefined); assert.equal(compact.json.summary.slideCount, 400); assert.equal(compact.json.summary.width, deck.width); assert.equal(compact.json.summary.id, deck.id);
  assert.equal(compact.json.selection.element.text, 'Only the requested content'); assert.ok(Buffer.byteLength(JSON.stringify(compact.json)) < 4000); assert.doesNotMatch(JSON.stringify(compact.json), /界/);
  assert.equal(await readFile(files.input, 'utf8'), original);
  const spreadsheetFiles = await spreadsheetSearchFixture();
  const regular = await run('spreadsheet', ['inspect', '--input', spreadsheetFiles.input, '--sheet-id', 'sales', '--include-data', '--limit', '1']);
  const reduced = await run('spreadsheet', ['inspect', '--input', spreadsheetFiles.input, '--sheet-id', 'sales', '--include-data', '--limit', '1', '--compact-summary']);
  assert.equal(reduced.status, 0); assert.equal(reduced.json.summary.sheets, undefined); assert.equal(regular.json.summary.sheets.length, 3); assert.deepEqual(reduced.json.selection, regular.json.selection);
  for (const [kind, operation, flags] of [['spreadsheet', 'inspect', ['--overview']], ['slide', 'validate', []], ['aichat', 'inspect', []]]) {
    const result = await run(kind, [operation, '--input', files.input, '--compact-summary', ...flags]); assert.equal(result.json.error.code, 'USAGE');
  }
});

test('spreadsheet search discovers sheet names and cell values with exact and case-sensitive matching', async () => {
  const files = await spreadsheetSearchFixture(), original = await readFile(files.input, 'utf8');
  const inspect = async (...options) => { const result = await run('spreadsheet', ['inspect', '--input', files.input, ...options]); assert.equal(result.status, 0, JSON.stringify(result.json)); return result.json; };
  const sheets = await inspect('--search', 'sheets', '--text', 'sales');
  assert.deepEqual(sheets.selection, { search: 'sheets', text: 'sales', matches: [
    { sheetId: 'sales', name: 'Sales', index: 0, rowCount: 300, columnCount: 26 },
    { sheetId: 'sales-old', name: 'Sales archive', index: 1, rowCount: 300, columnCount: 26 },
  ], offset: 0, limit: 100, total: 2, hasMore: false });
  assert.deepEqual((await inspect('--search', 'sheets', '--text', 'Sales', '--exact')).selection.matches.map(item => item.sheetId), ['sales']);
  assert.deepEqual((await inspect('--search', 'sheets', '--text', 'sales', '--match-case')).selection.matches, []);
  const cells = await inspect('--search', 'cells', '--text', 'revenue');
  assert.equal(cells.selection.total, 4); assert.deepEqual(cells.selection.matches.map(item => [item.sheetId, item.address]), [['sales', 'A1'], ['sales', 'B2'], ['sales', 'B3'], ['sales-old', 'A1']]);
  assert.deepEqual(cells.selection.matches[0], { sheetId: 'sales', address: 'A1', value: 'Revenue', matchedText: 'Revenue' });
  assert.equal((await inspect('--search', 'cells', '--text', 'Revenue', '--exact', '--match-case')).selection.total, 2);
  assert.equal((await inspect('--search', 'cells', '--text', '--help')).selection.matches[0].address, 'D4');
  assert.equal((await inspect('--search', 'cells', '--text', 'not present')).selection.total, 0);
  assert.equal(await readFile(files.input, 'utf8'), original, 'search does not modify the native workbook');
});

test('spreadsheet search filters one sheet or range, chooses formulas versus displayed values and paginates', async () => {
  const files = await spreadsheetSearchFixture();
  const inspect = async (...options) => { const result = await run('spreadsheet', ['inspect', '--input', files.input, ...options]); assert.equal(result.status, 0, JSON.stringify(result.json)); return result.json; };
  assert.equal((await inspect('--search', 'cells', '--text', 'revenue', '--sheet-id', 'sales')).selection.total, 3);
  assert.deepEqual((await inspect('--search', 'cells', '--text', 'revenue', '--sheet-id', 'sales', '--range', 'B2:C2')).selection.matches.map(item => item.address), ['B2']);
  assert.deepEqual((await inspect('--search', 'cells', '--text', 'revenue', '--sheet-id', 'sales', '--range', 'A1')).selection.matches.map(item => item.address), ['A1']);
  const formula = await inspect('--search', 'cells', '--text', '=2+3', '--look-in', 'formulas');
  assert.deepEqual(formula.selection.matches, [{ sheetId: 'sales', address: 'C2', value: '=2+3', matchedText: '=2+3' }]);
  assert.equal((await inspect('--search', 'cells', '--text', '=2+3', '--look-in', 'values')).selection.total, 0);
  assert.equal((await inspect('--search', 'cells', '--text', '5', '--exact', '--sheet-id', 'sales')).selection.matches[0].address, 'C2');
  const first = (await inspect('--search', 'cells', '--text', 'page-')).selection;
  assert.equal(first.matches.length, 100); assert.equal(first.total, 103); assert.equal(first.hasMore, true);
  const last = (await inspect('--search', 'cells', '--text', 'page-', '--offset', '100', '--limit', '2')).selection;
  assert.equal(last.matches[0].address, 'A101'); assert.equal(last.matches.length, 2); assert.equal(last.hasMore, true);
  assert.deepEqual((await inspect('--search', 'cells', '--text', 'page-', '--offset', '103')).selection.matches, []);
  const unchanged = await inspect(); assert.equal(unchanged.selection, undefined); assert.equal(unchanged.summary.sheetCount, 3);
  assert.deepEqual((await inspect('--sheet-id', 'sales', '--range', 'A1')).selection, { sheetId: 'sales', range: 'A1', rows: [[{ value: 'Revenue' }]] });
  assert.deepEqual((await inspect('--sheet-id', 'sales', '--range', 'C1')).selection, { sheetId: 'sales', range: 'C1', rows: [[null]] });
});

test('spreadsheet search rejects missing, unused, incompatible and cross-module arguments', async () => {
  const files = await spreadsheetSearchFixture();
  const invalid = [
    ['--search', 'cells'], ['--search', 'rows', '--text', 'x'], ['--text', 'x'], ['--match-case'], ['--exact'], ['--look-in', 'values'], ['--offset', '0'], ['--limit', '1'],
    ['--search', 'sheets', '--text', 'x', '--sheet-id', 'sales'], ['--search', 'sheets', '--text', 'x', '--look-in', 'values'],
    ['--search', 'cells', '--text', 'x', '--range', 'A1'], ['--search', 'cells', '--text', 'x', '--include-data'],
    ['--search', 'cells', '--text', 'x', '--sheet-id', 'sales', '--drawing-id', 'drawing'], ['--search', 'cells', '--text', 'x', '--look-in', 'raw'],
    ['--search', 'cells', '--text', 'x', '--offset', '-1'], ['--search', 'cells', '--text', 'x', '--limit', '1001'],
    ['--search', 'cells', '--text', 'x', '--limit', '0'], ['--search', 'cells', '--text', ''], ['--search', 'cells', '--text'],
    ['--preview-length', '10'], ['--search', 'sheets', '--text', 'x', '--preview-length', '10'],
    ...['0', '10001', '-1', '1.5', 'NaN'].map(value => ['--search', 'cells', '--text', 'x', '--preview-length', value]),
  ];
  for (const args of invalid) { const result = await run('spreadsheet', ['inspect', '--input', files.input, ...args]); assert.equal(result.json.error.code, 'USAGE', JSON.stringify({ args, result })); }
  const missing = await run('spreadsheet', ['inspect', '--input', files.input, '--search', 'cells', '--text', 'x', '--sheet-id', 'missing']); assert.equal(missing.json.error.code, 'NOT_FOUND');
  for (const kind of ['slide', 'aichat']) { const result = await run(kind, ['inspect', '--input', files.input, '--search', 'cells', '--text', 'x']); assert.equal(result.json.error.code, 'USAGE'); }
  for (const operation of ['validate', 'apply']) { const result = await run('spreadsheet', [operation, '--input', files.input, ...(operation === 'apply' ? ['--commands', files.commands, '--dry-run'] : []), '--search', 'cells', '--text', 'x']); assert.equal(result.json.error.code, 'USAGE'); }
});

test('spreadsheet search previews long cells explicitly without changing matching or splitting surrogate pairs', async () => {
  const files = await paths('spreadsheet'), model = fixtures.spreadsheet.model, long = `${'Z'.repeat(25_000)}TAIL`;
  const workbook = model.normalizeWorkbook({ sheets: [{ id: 'sheet-1', name: 'Data', rowCount: 10, columnCount: 10, cells: { A1: { value: long }, A2: { value: 'A😀B' } } }] });
  await writeFile(files.input, model.serializeWorkbook(workbook));
  const inspect = async (...options) => { const result = await run('spreadsheet', ['inspect', '--input', files.input, '--search', 'cells', ...options]); assert.equal(result.status, 0, JSON.stringify(result.json)); return result.json; };
  const preview = await inspect('--text', 'TAIL', '--limit', '1');
  assert.equal(preview.selection.total, 1); assert.deepEqual(preview.selection.matches, [{
    sheetId: 'sheet-1', address: 'A1', value: 'Z'.repeat(200), matchedText: 'Z'.repeat(200),
    valueLength: long.length, valueTruncated: true, matchedTextLength: long.length, matchedTextTruncated: true,
  }]);
  assert.ok(Buffer.byteLength(JSON.stringify(preview)) < 2000, 'one long cell stays small enough for AI tool output');
  const larger = await inspect('--text', 'TAIL', '--preview-length', '10000'); assert.equal(larger.selection.matches[0].value.length, 10000);
  const unicode = await inspect('--text', '😀', '--preview-length', '2');
  assert.equal(unicode.selection.matches[0].value, 'A'); assert.equal(unicode.selection.matches[0].valueLength, 4); assert.equal(unicode.selection.matches[0].valueTruncated, true);
  const exact = await inspect('--text', 'A😀B', '--exact', '--preview-length', '4');
  assert.deepEqual(exact.selection.matches, [{ sheetId: 'sheet-1', address: 'A2', value: 'A😀B', matchedText: 'A😀B' }]);
  const full = await run('spreadsheet', ['inspect', '--input', files.input, '--sheet-id', 'sheet-1', '--range', 'A1']); assert.equal(full.json.selection.rows[0][0].value, long);
});

test('slide selectors expose IDs and bounds while never printing embedded image bytes', async () => {
  const files = await paths('slide');
  const model = fixtures.slide.model;
  const imageSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=';
  const deck = model.createSlideDeck({ slides: [{ id: 'page-1', name: 'Page', background: '#ffffff', notes: 'secret notes', elements: [
    model.createSlideElement({ id: 'text-1', type: 'text', text: 'secret text' }),
    model.createSlideElement({ id: 'image-1', type: 'image', src: imageSrc, alt: 'Image description' }),
  ] }] });
  await writeFile(files.input, model.serializeSlideDeck(deck));
  const page = await run('slide', ['inspect', '--input', files.input, '--slide-id', 'page-1']);
  assert.equal(page.json.selection.elements.length, 2);
  assert.doesNotMatch(JSON.stringify(page), /secret|base64/);
  const text = await run('slide', ['inspect', '--input', files.input, '--slide-id', 'page-1', '--element-id', 'text-1', '--include-data']);
  assert.equal(text.json.selection.element.text, 'secret text');
  const image = await run('slide', ['inspect', '--input', files.input, '--slide-id', 'page-1', '--element-id', 'image-1', '--include-data']);
  assert.equal(image.json.selection.element.alt, 'Image description');
  assert.doesNotMatch(JSON.stringify(image), /base64/);
  assert.equal((await run('slide', ['inspect', '--input', files.input, '--slide-id', 'page-1', '--element-id', 'missing'])).json.error.code, 'NOT_FOUND');
});

test('document inspection pages through current block positions and strips nested image bytes', async () => {
  const files = await paths('document');
  const model = fixtures.document.model;
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=';
  const document = model.createDocument({ content: { type: 'doc', content: [
    { type: 'paragraph', attrs: { id: 'paragraph-1' }, content: [{ type: 'text', text: 'secret body' }] },
    { type: 'bullet_list', attrs: { id: 'list-1' }, content: [{ type: 'list_item', attrs: { id: 'item-1' }, content: [
      { type: 'paragraph', attrs: { id: 'nested-1' }, content: [{ type: 'text', text: 'private nested text' }] },
      { type: 'image', attrs: { id: 'image-1', src: image, alt: 'private image description' } },
    ] }] },
  ] } });
  await writeFile(files.input, model.serializeDocument(document));
  const original = await readFile(files.input, 'utf8');
  const overview = await run('document', ['inspect', '--input', files.input]);
  assert.equal(overview.status, 0);
  assert.equal(overview.json.summary.imageCount, 1);
  assert.doesNotMatch(JSON.stringify(overview), /secret|private|base64/);
  assert.equal(overview.json.selection.blocks[0].id, 'paragraph-1');
  assert.equal(overview.json.selection.blocks[0].contentFrom, 1);
  const page = await run('document', ['inspect', '--input', files.input, '--offset', '1', '--limit', '1']);
  assert.equal(page.json.selection.blocks.length, 1);
  assert.equal(page.json.selection.blocks[0].id, 'list-1');
  assert.equal(page.json.selection.hasMore, true);
  const selected = await run('document', ['inspect', '--input', files.input, '--block-id', 'list-1', '--include-data']);
  assert.match(JSON.stringify(selected), /private nested text/);
  assert.doesNotMatch(JSON.stringify(selected), /base64/);
  assert.equal(await readFile(files.input, 'utf8'), original);
  assert.equal((await run('document', ['inspect', '--input', files.input, '--block-id', 'missing'])).json.error.code, 'NOT_FOUND');
  assert.equal((await run('document', ['inspect', '--input', files.input, '--limit', '1001'])).json.error.code, 'USAGE');
  assert.equal((await run('document', ['inspect', '--input', files.input, '--block-id', 'list-1', '--offset', '1'])).json.error.code, 'USAGE');
});
