import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { generatedSkillScript } from '../build-skill-scripts.mjs';

const exec = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const kinds = ['board', 'dataview', 'diagram', 'whiteboard', 'calendar', 'aichat', 'chat', 'form'];
const count = 103;
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=';
const fixtures = {};
let temporary;

function createFixture(kind, model) {
  if (kind === 'board') return model.createBoard({ id: 'board', title: 'Board', labels: [{ id: 'label', name: 'Priority', color: '#2563eb' }], members: [{ id: 'member', name: 'Owner' }], columns: [
    { id: 'column-0', title: 'Todo', cards: Array.from({ length: count }, (_, index) => ({ id: `card-${index}`, title: `Card ${index}`, description: `private card description ${index}`, labelIds: ['label'], assigneeIds: ['member'] })) },
    { id: 'column-1', title: 'Done', cards: [] },
  ] });
  if (kind === 'dataview') return model.createDataView({ id: 'data', title: 'Data', fields: [
    { id: 'field-0', name: 'Name', type: 'text' }, { id: 'field-1', name: 'Choice', type: 'select', options: ['private select option'] },
  ], rows: Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, values: { 'field-0': `private cell value ${index}`, 'field-1': 'private select option' } })) });
  if (kind === 'diagram') return model.createDiagram({ id: 'diagram', title: 'Diagram',
    nodes: Array.from({ length: count }, (_, index) => ({ id: `node-${index}`, text: `private node text ${index}`, x: index * 10, y: 10 })),
    edges: [{ id: 'edge-0', sourceId: 'node-0', targetId: 'node-1', label: 'private edge label' }, { id: 'edge-1', sourceId: 'node-1', targetId: 'node-2', label: 'private second edge label' }],
  });
  if (kind === 'whiteboard') return model.createWhiteboard({ id: 'whiteboard', title: 'Whiteboard', elements: [
    ...Array.from({ length: count - 1 }, (_, index) => ({ id: `element-${index}`, kind: 'sticky', text: `private element text ${index}` })),
    { id: 'image-0', kind: 'image', src: image, alt: 'private image description', width: 30, height: 30 },
  ] });
  if (kind === 'calendar') return model.createCalendar({ id: 'calendar', title: 'Calendar', timeZone: 'America/Los_Angeles', events: [
    { id: 'event-0', title: 'Late local event', allDay: false, start: '2026-09-22T06:30:00Z', end: '2026-09-22T07:00:00Z', description: 'private event description', location: 'private meeting location' },
    { id: 'event-1', title: 'Starts at local midnight', allDay: false, start: '2026-09-22T07:00:00Z', end: '2026-09-22T08:00:00Z' },
    { id: 'event-2', title: 'All-day Monday', allDay: true, start: '2026-09-21', end: '2026-09-22' },
    { id: 'event-3', title: 'Ends at local midnight', allDay: false, start: '2026-09-21T06:00:00Z', end: '2026-09-21T07:00:00Z' },
    { id: 'event-4', title: 'Spans midnight', allDay: false, start: '2026-09-22T06:00:00Z', end: '2026-09-22T08:00:00Z' },
    ...Array.from({ length: count - 5 }, (_, index) => ({ id: `event-${index + 5}`, title: `Future event ${index}`, allDay: true, start: '2026-10-01', end: '2026-10-02', description: `private future event ${index}` })),
  ] });
  if (kind === 'chat') return model.createChat({ id: 'chat', title: 'Team', participants: [{ id: 'me', name: 'Me' }, { id: 'peer', name: 'Peer' }], conversations: [
    { id: 'conversation-0', kind: 'space', title: 'Team', memberIds: ['me', 'peer'], messages: Array.from({ length: count }, (_, index) => model.createChatMessage({ id: `message-${index}`, authorId: index % 2 ? 'peer' : 'me', text: `private message body ${index}`, createdAt: '2026-09-22T00:00:00Z', ...(index === 1 ? { replyTo: 'message-0' } : {}) })) },
    { id: 'conversation-1', kind: 'direct', title: 'Direct', memberIds: ['me', 'peer'], messages: [] },
  ] });
  if (kind === 'aichat') return model.createAIChat({ id: 'aichat', title: 'Chat', conversations: [
    { id: 'conversation-0', title: 'Conversation', messages: Array.from({ length: count }, (_, index) => model.createAIChatMessage({ id: `message-${index}`, role: index % 2 ? 'assistant' : 'user', content: `private message body ${index}`, createdAt: '2026-09-22T00:00:00Z',
      ...(index === 1 ? { replyTo: 'message-0' } : {}),
      ...(index === 0 ? { attachments: [{ id: 'attachment-0', name: 'private attachment name', mediaType: 'image/png', size: 68, url: 'https://example.test/image.png' }], references: [{ id: 'reference-0', title: 'Reference', description: 'private reference description' }], toolCalls: [{ id: 'tool-0', name: 'search', status: 'complete', detail: 'private tool detail' }] } : {}),
    })) },
    { id: 'conversation-1', title: 'Other conversation', messages: [model.createAIChatMessage({ id: 'other-message', role: 'user', content: 'private other conversation body', createdAt: '2026-09-22T01:00:00Z' })] },
  ] });
  return model.createForm({ id: 'form', title: 'Form', description: 'private form description', fields: Array.from({ length: count }, (_, index) => ({ id: `field-${index}`, type: 'text', label: `Field ${index}`, description: `private field description ${index}`, placeholder: `private field placeholder ${index}`, defaultValue: `private default value ${index}`, ...(index === 1 ? { visibleWhen: { fieldId: 'field-0', operator: 'notEmpty' } } : {}) })) });
}

test.before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'likex-selector-cli-'));
  for (const kind of kinds) {
    const metadata = JSON.parse(await readFile(path.join(repo, `packages/${kind}/package.json`), 'utf8'));
    const installed = path.join(temporary, `host/node_modules/@likex/${kind}`);
    const script = path.join(installed, `skills/likex-${kind}/scripts/document.mjs`);
    await mkdir(path.dirname(script), { recursive: true });
    await writeFile(path.join(installed, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, type: 'module', exports: { './model': './model.mjs', './package.json': './package.json' } }));
    await writeFile(script, await generatedSkillScript(kind));
    await build({ entryPoints: [path.join(repo, `packages/${kind}/src/model-entry.ts`)], outfile: path.join(installed, 'model.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'es2022', alias: {
      '@likex/core/json': path.join(repo, 'packages/core/src/json.ts'), '@likex/core/ooxml': path.join(repo, 'packages/core/src/ooxml.ts'), '@likex/core': path.join(repo, 'packages/core/src/index.ts'),
    } });
    const model = await import(pathToFileURL(path.join(installed, 'model.mjs')).href);
    const suffix = { board: 'Board', dataview: 'DataView', diagram: 'Diagram', whiteboard: 'Whiteboard', calendar: 'Calendar', aichat: 'AIChat', chat: 'Chat', form: 'Form' }[kind];
    const input = path.join(temporary, `${kind}.json`), original = model[`serialize${suffix}`](createFixture(kind, model));
    await writeFile(input, original); fixtures[kind] = { script, input, original };
  }
});
test.after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

async function inspect(kind, selectors = []) {
  let status = 0, stdout, stderr;
  try { ({ stdout, stderr } = await exec(process.execPath, [fixtures[kind].script, 'inspect', '--input', fixtures[kind].input, ...selectors], { cwd: temporary, maxBuffer: 3 * 1024 * 1024 })); }
  catch (error) { if (!Object.hasOwn(error, 'stdout')) throw error; ({ stdout, stderr } = error); status = error.code; }
  assert.equal(stderr, ''); assert.equal(stdout.trim().split('\n').length, 1, 'one JSON result line');
  return { status, json: JSON.parse(stdout) };
}
async function ok(kind, selectors = []) { const result = await inspect(kind, selectors); assert.equal(result.status, 0, JSON.stringify(result.json)); return result.json; }
async function failure(kind, selectors, code) { const result = await inspect(kind, selectors); assert.notEqual(result.status, 0); assert.equal(result.json.ok, false); assert.equal(result.json.error.code, code, JSON.stringify(result.json)); return result.json; }
const pageConfig = {
  board: { args: ['--column-id', 'column-0'], key: 'cards', prefix: 'card' },
  dataview: { args: [], key: 'rows', prefix: 'row' },
  diagram: { args: [], key: 'nodes', prefix: 'node' },
  whiteboard: { args: [], key: 'elements', prefix: 'element' },
  calendar: { args: [], key: 'events', prefix: 'event' },
  chat: { args: ['--conversation-id', 'conversation-0'], key: 'messages', prefix: 'message' },
  aichat: { args: ['--conversation-id', 'conversation-0'], key: 'messages', prefix: 'message' },
  form: { args: [], key: 'fields', prefix: 'field' },
};
const itemSelectors = {
  board: ['--card-id', 'card-0'], dataview: ['--row-id', 'row-0'], diagram: ['--node-id', 'node-0'], whiteboard: ['--element-id', 'element-0'], calendar: ['--event-id', 'event-0'], aichat: ['--conversation-id', 'conversation-0', '--message-id', 'message-0'], chat: ['--conversation-id', 'conversation-0', '--message-id', 'message-0'], form: ['--field-id', 'field-0'],
};

for (const kind of kinds) {
  test(`${kind}: summary and paged inspection omit bodies and leave the native file unchanged`, async () => {
    const overview = await ok(kind);
    assert.equal(overview.summary.format, `likex.${kind}`);
    assert.doesNotMatch(JSON.stringify(overview), /private|base64|iVBORw0KGgo/);
    const config = pageConfig[kind], listed = await ok(kind, config.args), first = listed.selection[config.key];
    assert.doesNotMatch(JSON.stringify(listed), /private|base64|iVBORw0KGgo/);
    assert.equal(first.items.length, 100); assert.equal(first.limit, 100); assert.equal(first.offset, 0); assert.equal(first.total, count); assert.equal(first.hasMore, true);
    assert.equal(first.items[0].id, `${config.prefix}-0`);
    const paged = await ok(kind, [...config.args, '--offset', '1', '--limit', '1']);
    assert.equal(paged.selection[config.key].items.length, 1); assert.equal(paged.selection[config.key].items[0].id, `${config.prefix}-1`);
    assert.equal(paged.selection[config.key].offset, 1); assert.equal(paged.selection[config.key].hasMore, true);
    const last = await ok(kind, [...config.args, '--offset', '102', '--limit', '2']);
    assert.equal(last.selection[config.key].items.length, 1); assert.equal(last.selection[config.key].hasMore, false);
    const empty = await ok(kind, [...config.args, '--offset', '999', '--limit', '1']);
    assert.deepEqual(empty.selection[config.key].items, []); assert.equal(empty.selection[config.key].total, count); assert.equal(empty.selection[config.key].hasMore, false);
    assert.equal(await readFile(fixtures[kind].input, 'utf8'), fixtures[kind].original, 'read-only inspection preserves the native file');
  });

  test(`${kind}: explicit include-data reveals selected content while metadata-only selection stays bounded`, async () => {
    const selectors = itemSelectors[kind];
    const summary = await ok(kind, selectors); assert.doesNotMatch(JSON.stringify(summary), /private|base64|iVBORw0KGgo/);
    const content = await ok(kind, [...selectors, '--include-data']); assert.match(JSON.stringify(content), /private/); assert.doesNotMatch(JSON.stringify(content), /base64|iVBORw0KGgo/);
    const wrong = selectors.map((value, index) => index === selectors.length - 1 ? 'unknown-id' : value);
    await failure(kind, wrong, 'NOT_FOUND');
    for (const args of [['--include-data'], [...selectors, '--offset', '0'], [...selectors, '--limit', '1'], ['--offset', '-1'], ['--offset', '9007199254740992'], ['--limit', '0'], ['--limit', '1001'], ['--offset', '1.5'], ['--sheet-id', 'wrong-module']]) await failure(kind, args, 'USAGE');
  });
}

test('board column selection supplies card locations and identifiers without descriptions', async () => {
  const overview = await ok('board'); assert.equal(overview.summary.columnCount, 2); assert.equal(overview.summary.cardCount, count);
  assert.deepEqual(overview.selection.columns.items.map(column => column.id), ['column-0', 'column-1']);
  const column = await ok('board', ['--column-id', 'column-0', '--limit', '1']);
  assert.equal(column.selection.column.cardCount, count); assert.equal(column.selection.labels[0].id, 'label'); assert.equal(column.selection.members[0].id, 'member');
  const card = await ok('board', ['--card-id', 'card-1', '--include-data']);
  assert.equal(card.selection.columnId, 'column-0'); assert.equal(card.selection.index, 1); assert.equal(card.selection.card.description, 'private card description 1');
  await failure('board', ['--column-id', 'missing'], 'NOT_FOUND');
  await failure('board', ['--column-id', 'column-0', '--card-id', 'card-0'], 'USAGE');
});

test('dataview field and row selectors expose only explicitly requested options and values', async () => {
  const field = await ok('dataview', ['--field-id', 'field-1']);
  assert.equal(field.selection.field.optionCount, 1); assert.doesNotMatch(JSON.stringify(field), /private/);
  const complete = await ok('dataview', ['--field-id', 'field-1', '--include-data']);
  assert.deepEqual(complete.selection.field.options, ['private select option']);
  const row = await ok('dataview', ['--row-id', 'row-0', '--include-data']);
  assert.equal(row.selection.row.values['field-0'], 'private cell value 0');
  await failure('dataview', ['--field-id', 'missing'], 'NOT_FOUND');
  await failure('dataview', ['--field-id', 'field-0', '--row-id', 'row-0'], 'USAGE');
});

test('diagram edge selectors return endpoints and explicitly selected labels', async () => {
  const overview = await ok('diagram', ['--offset', '1', '--limit', '1']);
  assert.equal(overview.selection.nodes.items[0].id, 'node-1'); assert.equal(overview.selection.edges.items[0].id, 'edge-1');
  const edge = await ok('diagram', ['--edge-id', 'edge-0']);
  assert.equal(edge.selection.edge.sourceId, 'node-0'); assert.equal(edge.selection.edge.targetId, 'node-1'); assert.equal(edge.selection.edge.labelLength, 'private edge label'.length);
  assert.doesNotMatch(JSON.stringify(edge), /private/);
  assert.equal((await ok('diagram', ['--edge-id', 'edge-0', '--include-data'])).selection.edge.label, 'private edge label');
  await failure('diagram', ['--edge-id', 'missing'], 'NOT_FOUND');
  await failure('diagram', ['--node-id', 'node-0', '--edge-id', 'edge-0'], 'USAGE');
});

test('whiteboard embedded image data is never printed even with include-data', async () => {
  const selected = await ok('whiteboard', ['--element-id', 'image-0', '--include-data']);
  assert.equal(selected.selection.element.alt, 'private image description'); assert.equal(selected.selection.element.width, 30);
  assert.equal(Object.hasOwn(selected.selection.element, 'src'), false); assert.doesNotMatch(JSON.stringify(selected), /base64|iVBORw0KGgo/);
  const metadata = await ok('whiteboard', ['--element-id', 'image-0']);
  assert.equal(metadata.selection.element.altLength, 'private image description'.length); assert.doesNotMatch(JSON.stringify(metadata), /private|base64/);
});

test('calendar date ranges use the saved timezone and exclusive ends before pagination', async () => {
  const monday = await ok('calendar', ['--start', '2026-09-21', '--end', '2026-09-22']);
  assert.equal(monday.summary.timeZone, 'America/Los_Angeles'); assert.equal(monday.summary.eventCount, count);
  assert.deepEqual(monday.selection.range, { start: '2026-09-21', end: '2026-09-22' });
  assert.deepEqual(monday.selection.events.items.map(event => event.id), ['event-0', 'event-2', 'event-4']);
  const tuesday = await ok('calendar', ['--start', '2026-09-22', '--end', '2026-09-23']);
  assert.deepEqual(tuesday.selection.events.items.map(event => event.id), ['event-1', 'event-4']);
  const paged = await ok('calendar', ['--start', '2026-09-21', '--end', '2026-09-22', '--offset', '1', '--limit', '1']);
  assert.equal(paged.selection.events.total, 3); assert.equal(paged.selection.events.items[0].id, 'event-2');
  for (const selectors of [['--start', '2026-09-21'], ['--end', '2026-09-22'], ['--event-id', 'event-0', '--start', '2026-09-21', '--end', '2026-09-22']]) await failure('calendar', selectors, 'USAGE');
  for (const selectors of [['--start', '2026-02-30', '--end', '2026-03-01'], ['--start', '2026-09-22', '--end', '2026-09-22']]) await failure('calendar', selectors, 'VALIDATION_FAILED');
});

test('chat requires conversation context for messages and does not leak message metadata contents by default', async () => {
  const overview = await ok('aichat', ['--offset', '1', '--limit', '1']);
  assert.equal(overview.selection.conversations.items[0].id, 'conversation-1'); assert.equal(overview.selection.conversations.hasMore, false);
  const listed = await ok('aichat', ['--conversation-id', 'conversation-0', '--limit', '2']);
  const first = listed.selection.messages.items[0];
  assert.equal(first.attachmentCount, 1); assert.equal(first.referenceCount, 1); assert.equal(first.toolCallCount, 1);
  assert.equal(listed.selection.messages.items[1].replyTo, 'message-0'); assert.doesNotMatch(JSON.stringify(listed), /private/);
  const selected = await ok('aichat', ['--conversation-id', 'conversation-0', '--message-id', 'message-0', '--include-data']);
  assert.equal(selected.selection.message.content, 'private message body 0'); assert.equal(selected.selection.message.toolCalls[0].detail, 'private tool detail');
  await failure('aichat', ['--message-id', 'message-0'], 'USAGE');
  await failure('aichat', ['--message-id', 'message-0', '--include-data'], 'USAGE');
  await failure('aichat', ['--conversation-id', 'conversation-0', '--include-data'], 'USAGE');
  await failure('aichat', ['--conversation-id', 'missing'], 'NOT_FOUND');
  await failure('aichat', ['--conversation-id', 'conversation-1', '--message-id', 'message-0'], 'NOT_FOUND');
});

test('form field inspection exposes descriptions defaults and placeholders only when explicitly requested', async () => {
  const selected = await ok('form', ['--field-id', 'field-0', '--include-data']);
  assert.equal(selected.selection.field.description, 'private field description 0'); assert.equal(selected.selection.field.defaultValue, 'private default value 0'); assert.equal(selected.selection.field.placeholder, 'private field placeholder 0');
  const condition = await ok('form', ['--field-id', 'field-1']);
  assert.deepEqual(condition.selection.field.visibleWhen, { fieldId: 'field-0', operator: 'notEmpty' }); assert.doesNotMatch(JSON.stringify(condition), /private/);
});

 test('human Chat uses authorId/text metadata and includes bodies only on explicit request', async () => {
  const listed = await ok('chat', ['--conversation-id', 'conversation-0', '--limit', '2']);
  assert.equal(listed.selection.messages.items[0].authorId, 'me');
  assert.equal(listed.selection.messages.items[1].replyTo, 'message-0');
  assert.doesNotMatch(JSON.stringify(listed), /private/);
  const selected = await ok('chat', ['--conversation-id', 'conversation-0', '--message-id', 'message-0', '--include-data']);
  assert.equal(selected.selection.message.text, 'private message body 0');
  await failure('chat', ['--message-id', 'message-0'], 'USAGE');
});
