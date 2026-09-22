#!/usr/bin/env node
// Generated from scripts/skills/document-cli.mjs. Do not edit; run node scripts/build-skill-scripts.mjs.
import { open, lstat, stat, rename, unlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const DOCUMENT_KIND = "board";
const LIBRARY_VERSION = "0.1.0";
const MAX_COMMAND_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CLI_VERSION = 1;
// Public entry points and result envelopes vary by module; model operations stay in the libraries.
const adapters = {
  spreadsheet: ['Workbook', 'applySpreadsheetCommands', 'workbook', 192],
  slide: ['SlideDeck', 'applySlideCommands', 'deck', 240],
  document: ['Document', 'executeDocumentCommands', 'document', 40],
  board: ['Board', 'executeBoardCommands', 'board', 48],
  dataview: ['DataView', 'executeDataViewCommands', 'data', 96],
  diagram: ['Diagram', 'executeDiagramCommands', null, 24],
  whiteboard: ['Whiteboard', 'executeWhiteboardCommands', null, 120],
  calendar: ['Calendar', 'executeCalendarCommands', 'calendar', 5],
  aichat: ['AIChat', 'executeAIChatCommands', 'aichat', 32],
  chat: ['Chat', 'executeChatCommands', 'chat', 32],
  form: ['Form', 'executeFormCommands', null, 8],
};
const selectorsByKind = {
  spreadsheet: ['sheet-id', 'range', 'drawing-id'], slide: ['slide-id', 'element-id'], document: ['block-id', 'offset', 'limit'],
  board: ['column-id', 'card-id', 'offset', 'limit'], dataview: ['row-id', 'field-id', 'offset', 'limit'],
  diagram: ['node-id', 'edge-id', 'offset', 'limit'], whiteboard: ['element-id', 'offset', 'limit'],
  calendar: ['event-id', 'start', 'end', 'offset', 'limit'], chat: ['conversation-id', 'message-id', 'offset', 'limit'],
  aichat: ['conversation-id', 'message-id', 'offset', 'limit'],
  form: ['field-id', 'offset', 'limit'],
};
const dataSelectors = ['drawing-id', 'element-id', 'block-id', 'card-id', 'row-id', 'field-id', 'node-id', 'edge-id', 'event-id', 'message-id'];

class CliError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
const fail = (code, message, details) => { throw new CliError(code, message, details); };
const identity = value => value && [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');
const sameFile = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;

function usage(kind, version) {
  const selectors = selectorsByKind[kind].map(key => `--${key} ${['offset', 'limit'].includes(key) ? 'N' : ['start', 'end'].includes(key) ? 'YYYY-MM-DD' : key === 'range' ? 'A1:C5' : 'ID'}`).join(' | ');
  return {
    ok: true, kind, libraryVersion: version,
    usage: [
      'node document.mjs create --output FILE [--commands FILE] [--dry-run]',
      `node document.mjs inspect --input FILE [${selectors}]`,
      'node document.mjs apply --input FILE --commands FILE --output FILE [--dry-run]',
      'node document.mjs validate --input FILE',
      'All commands accept --project DIRECTORY. --help and --version need no installed library.',
      '--commands must contain a JSON array. --dry-run permits omitting --output and never writes.',
      '--range returns stored cells. --include-data adds the selected item content; embedded image bytes are always omitted.',
      ...(selectorsByKind[kind].includes('offset') ? ['Lists return 100 items by default; --offset and --limit (1–1000) control pagination. Item selectors cannot be combined with pagination.'] : []),
      ...(['chat', 'aichat'].includes(kind) ? ['--message-id requires --conversation-id. Select a conversation to list its messages.'] : []),
      ...(kind === 'calendar' ? ['--start and --end must be supplied together; end is exclusive and dates use calendar.timeZone.'] : []),
      ...(kind === 'slide' ? ['inspect defaults to final static values. --include-animations returns original values and the animation definitions; it does not modify the file.'] : []),
      ...(kind === 'document' ? ['Document inspect lists 100 blocks by default. --offset and --limit (1–1000) page through current block positions.'] : []),
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
  const flags = new Set(['dry-run', 'include-data', 'include-animations', 'help']);
  const values = new Set(['input', 'output', 'commands', 'project', ...Object.values(selectorsByKind).flat()]);
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
  const queryKeys = [...new Set([...Object.values(selectorsByKind).flat(), 'include-data', 'include-animations'])];
  if (args.operation !== 'inspect' && queryKeys.some(key => args[key])) fail('USAGE', 'Query selectors are only valid for inspect.');
  const ownKeys = selectorsByKind[kind];
  const wrongKeys = queryKeys.filter(key => !['include-data', 'include-animations'].includes(key) && !ownKeys.includes(key));
  if (wrongKeys.some(key => args[key])) fail('USAGE', `Unsupported selector for ${kind}.`);
  if ((args.range || args['drawing-id']) && !args['sheet-id']) fail('USAGE', '--range and --drawing-id require --sheet-id.');
  if (args.range && args['drawing-id']) fail('USAGE', 'Choose --range or --drawing-id.');
  if (kind === 'slide' && args['element-id'] && !args['slide-id']) fail('USAGE', '--element-id requires --slide-id.');
  if (args['include-animations'] && kind !== 'slide') fail('USAGE', '--include-animations is only supported for slide inspect.');
  if (args['include-data'] && !dataSelectors.some(key => args[key])) fail('USAGE', '--include-data requires an explicit item selector.');
  if (dataSelectors.some(key => args[key]) && (args.offset !== undefined || args.limit !== undefined)) fail('USAGE', 'Choose an item selector or list pagination.');
  for (const [first, second] of [['column-id', 'card-id'], ['row-id', 'field-id'], ['node-id', 'edge-id']]) if (args[first] && args[second]) fail('USAGE', `Choose --${first} or --${second}.`);
  if (args['message-id'] && !args['conversation-id']) fail('USAGE', '--message-id requires --conversation-id.');
  if (Boolean(args.start) !== Boolean(args.end)) fail('USAGE', '--start and --end are required together.');
  if (args['event-id'] && args.start) fail('USAGE', 'Choose --event-id or a date range.');
  for (const key of ['offset', 'limit']) if (args[key] !== undefined) {
    if (!/^\d+$/.test(args[key]) || !Number.isSafeInteger(Number(args[key])) || Number(args[key]) < (key === 'limit' ? 1 : 0) || (key === 'limit' && Number(args[key]) > 1000))
      fail('USAGE', '--offset must be a nonnegative integer; --limit must be an integer from 1 to 1000.');
    args[key] = Number(args[key]);
  }
  return args;
}

function documentLimit(kind) { return adapters[kind][3] * 1024 * 1024; }

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
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)); }
    catch { fail('INVALID_UTF8', `File must contain valid UTF-8: ${file}`); }
    return { text, snapshot, file: path.resolve(file) };
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

function summaryFor(kind, document, model) {
  if (kind === 'spreadsheet') return { format: 'likex.spreadsheet', sheetCount: document.sheets.length,
    imageCount: Object.keys(document.resources?.images ?? {}).length, namedRangeCount: document.namedRanges?.length ?? 0,
    sheets: document.sheets.map(sheetSummary) };
  if (kind === 'document') return { format: 'likex.document', id: document.id, title: document.title, page: document.page,
    blockCount: model.getBlocks(document).length, characterCount: model.getDocumentText(document).length, imageCount: model.getImages(document).length };
  const common = { format: document.format, id: document.id, title: document.title };
  if (kind === 'board') return { ...common, columnCount: document.columns.length,
    cardCount: document.columns.reduce((count, column) => count + column.cards.length, 0), labelCount: document.labels.length, memberCount: document.members.length };
  if (kind === 'dataview') return { ...common, fieldCount: document.fields.length, rowCount: document.rows.length };
  if (kind === 'diagram') return { ...common, nodeCount: document.nodes.length, edgeCount: document.edges.length };
  if (kind === 'whiteboard') return { ...common, elementCount: document.elements.length, imageCount: document.elements.filter(item => item.kind === 'image').length };
  if (kind === 'calendar') return { ...common, timeZone: document.timeZone, eventCount: document.events.length, allDayCount: document.events.filter(item => item.allDay).length };
  if (['chat', 'aichat'].includes(kind)) return { ...common, conversationCount: document.conversations.length,
    messageCount: document.conversations.reduce((count, conversation) => count + conversation.messages.length, 0) };
  if (kind === 'form') return { ...common, fieldCount: document.fields.length, requiredFieldCount: document.fields.filter(field => field.required).length };
  return { format: 'likex.slide', id: document.id, title: document.title, width: document.width, height: document.height,
    slideCount: document.slides.length, elementCount: document.slides.reduce((sum, slide) => sum + slide.elements.length, 0),
    slides: document.slides.map(slide => ({ id: slide.id, name: slide.name, elementCount: slide.elements.length })) };
}

function objectSummary(item) {
  const keys = ['id', 'type', 'kind', 'name', 'shape', 'anchor', 'x', 'y', 'width', 'height', 'rotation', 'locked', 'resourceId'];
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

function blockSummary(block) {
  const { id, from, to, contentFrom, contentTo, node } = block;
  const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key]) => !['src', 'alt'].includes(key)));
  return { id, type: node.type, from, to, contentFrom, contentTo, attrs, childCount: node.content?.length ?? 0 };
}

function withoutImageBytes(node) {
  return { ...node, ...(node.attrs ? { attrs: Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== 'src')) } : {}),
    ...(node.content ? { content: node.content.map(withoutImageBytes) } : {}) };
}

function selectionFor(kind, model, document, args) {
  const page = (items, mapper = value => value) => {
    const offset = args.offset ?? 0, limit = args.limit ?? 100;
    return { items: items.slice(offset, offset + limit).map(mapper), offset, limit, total: items.length, hasMore: offset + limit < items.length };
  };
  const required = (item, name) => { if (!item) fail('NOT_FOUND', `The selected ${name} was not found.`); return item; };
  const selected = (item, mapper) => args['include-data'] ? item : mapper(item);
  if (kind === 'board') {
    const cardSummary = card => ({ id: card.id, title: card.title, descriptionLength: card.description.length, labelIds: card.labelIds, assigneeIds: card.assigneeIds, dueDate: card.dueDate });
    const columnSummary = column => ({ id: column.id, title: column.title, color: column.color, cardCount: column.cards.length });
    if (args['card-id']) {
      const location = required(model.getCard(document, args['card-id']), 'card');
      return { columnId: location.columnId, index: location.index, card: selected(location.card, cardSummary) };
    }
    if (args['column-id']) {
      const column = required(model.getColumn(document, args['column-id']), 'column');
      return { column: columnSummary(column), cards: page(column.cards, cardSummary), labels: document.labels, members: document.members };
    }
    return { columns: page(document.columns, columnSummary), labels: document.labels, members: document.members };
  }
  if (kind === 'dataview') {
    const fieldSummary = field => ({ id: field.id, name: field.name, type: field.type, optionCount: field.options.length });
    const rowSummary = row => ({ id: row.id, valueCount: Object.keys(row.values).length });
    if (args['field-id']) return { field: selected(required(document.fields.find(field => field.id === args['field-id']), 'field'), fieldSummary) };
    if (args['row-id']) return { row: selected(required(document.rows.find(row => row.id === args['row-id']), 'row'), rowSummary) };
    return { fields: document.fields.map(fieldSummary), rows: page(document.rows, rowSummary) };
  }
  if (kind === 'diagram') {
    const edgeSummary = edge => ({ id: edge.id, sourceId: edge.sourceId, targetId: edge.targetId, color: edge.color, labelLength: edge.label.length });
    if (args['node-id']) return { node: selected(required(document.nodes.find(node => node.id === args['node-id']), 'node'), objectSummary) };
    if (args['edge-id']) return { edge: selected(required(document.edges.find(edge => edge.id === args['edge-id']), 'edge'), edgeSummary) };
    return { nodes: page(document.nodes, objectSummary), edges: page(document.edges, edgeSummary) };
  }
  if (kind === 'whiteboard') {
    if (args['element-id']) return { element: selectedObject(required(document.elements.find(element => element.id === args['element-id']), 'element'), args['include-data']) };
    return { elements: page(document.elements, objectSummary) };
  }
  if (kind === 'calendar') {
    const eventSummary = event => ({ id: event.id, title: event.title, allDay: event.allDay, start: event.start, end: event.end, color: event.color,
      descriptionLength: event.description?.length ?? 0, locationLength: event.location?.length ?? 0 });
    if (args['event-id']) return { event: selected(required(model.getCalendarEvent(document, args['event-id']), 'event'), eventSummary) };
    const range = args.start ? { start: args.start, end: args.end } : undefined;
    return { ...(range ? { range } : {}), events: page(model.getCalendarEvents(document, range), eventSummary) };
  }
  if (kind === 'aichat') {
    const conversationSummary = conversation => ({ id: conversation.id, title: conversation.title, messageCount: conversation.messages.length });
    const messageSummary = message => ({ id: message.id, role: message.role, status: message.status, createdAt: message.createdAt,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}), contentLength: message.content.length,
      attachmentCount: message.attachments?.length ?? 0, referenceCount: message.references?.length ?? 0, toolCallCount: message.toolCalls?.length ?? 0 });
    if (args['conversation-id']) {
      const conversation = required(model.getAIChatConversation(document, args['conversation-id']), 'conversation');
      if (args['message-id']) return { conversationId: conversation.id, message: selected(required(model.getAIChatMessage(document, conversation.id, args['message-id']), 'message'), messageSummary) };
      return { conversation: conversationSummary(conversation), messages: page(model.getAIChatMessages(document, conversation.id), messageSummary) };
    }
    return { conversations: page(model.getAIChatConversations(document), conversationSummary) };
  }
  if (kind === 'chat') {
    const conversationSummary = conversation => ({ id: conversation.id, title: conversation.title, messageCount: conversation.messages.length });
    const messageSummary = message => ({ id: message.id, authorId: message.authorId, createdAt: message.createdAt,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}), contentLength: message.text.length,
      attachmentCount: message.attachments?.length ?? 0, reactionCount: message.reactions?.length ?? 0 });
    if (args['conversation-id']) {
      const conversation = required(model.getConversation(document, args['conversation-id']), 'conversation');
      if (args['message-id']) return { conversationId: conversation.id, message: selected(required(model.getMessage(document, conversation.id, args['message-id']), 'message'), messageSummary) };
      return { conversation: conversationSummary(conversation), messages: page(model.getMessages(document, conversation.id), messageSummary) };
    }
    return { conversations: page(model.getConversations(document), conversationSummary) };
  }
  if (kind === 'form') {
    const fieldSummary = field => ({ id: field.id, type: field.type, label: field.label, required: field.required, optionCount: field.options.length,
      ...(field.visibleWhen ? { visibleWhen: field.visibleWhen } : {}) });
    if (args['field-id']) return { field: selected(required(model.getFormField(document, args['field-id']), 'field'), fieldSummary) };
    return { fields: page(document.fields, fieldSummary) };
  }
  if (kind === 'document') {
    if (args['block-id']) {
      const block = model.getBlock(document, args['block-id']);
      if (!block) fail('NOT_FOUND', 'The selected document block was not found.');
      return { block: { ...blockSummary(block), ...(args['include-data'] ? { node: withoutImageBytes(block.node) } : {}) } };
    }
    const blocks = model.getBlocks(document), offset = args.offset ?? 0, limit = args.limit ?? 100;
    return { blocks: blocks.slice(offset, offset + limit).map(blockSummary), offset, limit,
      total: blocks.length, hasMore: offset + limit < blocks.length };
  }
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
    const options = { includeAnimations: Boolean(args['include-animations']) };
    const slide = model.getSlide(document, args['slide-id'], options);
    if (!slide) fail('NOT_FOUND', 'The selected slide was not found.');
    if (args['element-id']) return { slideId: slide.id, element: selectedObject(model.getElement(document, slide.id, args['element-id'], options), args['include-data']),
      ...(args['include-animations'] ? { animations: model.getAnimations(document, slide.id) } : {}) };
    return { slide: { id: slide.id, name: slide.name, background: slide.background, notesLength: slide.notes.length,
      elementCount: slide.elements.length }, elements: slide.elements.map(objectSummary),
      ...(args['include-animations'] ? { animations: model.getAnimations(document, slide.id) } : {}) };
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
    if (!Object.hasOwn(adapters, kind)) fail('USAGE', 'Run a generated skill script, not scripts/skills/document-cli.mjs directly.');
    const args = argumentsFor(argv, kind);
    operation = args.operation;
    const base = { ok: true, kind, operation, libraryVersion: version };
    if (operation === 'help') { stdout.write(`${encodedResponse({ ...base, ...usage(kind, version) })}\n`); return 0; }
    if (operation === 'version') { stdout.write(`${encodedResponse({ ...base, cliVersion: CLI_VERSION })}\n`); return 0; }
    const model = await loadModel(kind, version, args.project, scriptUrl);
    const spreadsheet = kind === 'spreadsheet';
    const [suffix, executeName, resultKey] = adapters[kind];
    const parse = model[`parse${suffix}`], serialize = model[`serialize${suffix}`];
    let source, document;
    if (args.input) { source = await readBounded(args.input, documentLimit(kind)); document = parse(source.text); }
    else document = model[`create${suffix}`]();
    const output = args.output ? path.resolve(args.output) : null;
    const before = output ? await outputSnapshot(output) : null;
    let commands = [], changed = operation === 'create', receipt;
    if (args.commands) {
      try { commands = JSON.parse((await readBounded(args.commands, MAX_COMMAND_BYTES)).text); }
      catch (error) { if (error instanceof SyntaxError) fail('INVALID_COMMANDS', 'Commands file must be valid JSON.'); throw error; }
      if (!Array.isArray(commands)) fail('INVALID_COMMANDS', 'Commands file must contain a JSON array, even for a single command.');
      try {
        const beforeCommands = serialize(document);
        receipt = model[executeName](document, commands);
        if (spreadsheet && !receipt.ok) fail(receipt.code, receipt.message, { ...(receipt.commandIndex !== undefined ? { commandIndex: receipt.commandIndex } : {}) });
        document = resultKey ? receipt[resultKey] : receipt;
        changed = changed || beforeCommands !== serialize(document);
      } catch (error) { if (error instanceof CliError) throw error; fail('COMMAND_FAILED', error.message); }
    }
    if (operation === 'inspect') {
      const inspected = kind === 'slide' ? model.getDeck(document, { includeAnimations: Boolean(args['include-animations']) }) : document;
      const selection = selectionFor(kind, model, inspected, args);
      stdout.write(`${encodedResponse({ ...base, summary: summaryFor(kind, inspected, model), ...(selection ? { selection } : {}),
        ...(kind === 'slide' && args['include-animations'] && !args['slide-id'] ? { animations: inspected.slides.map(slide => ({ slideId: slide.id, animations: model.getAnimations(inspected, slide.id) })) } : {}) })}\n`);
      return 0;
    }
    // A complete native serialization and parse must succeed before any output is created.
    const serialized = serialize(document);
    parse(serialized);
    if (operation === 'validate') {
      stdout.write(`${encodedResponse({ ...base, valid: true, summary: summaryFor(kind, document, model) })}\n`);
      return 0;
    }
    const result = encodedResponse({ ...base, dryRun: Boolean(args['dry-run']), written: !args['dry-run'], output,
      commandCount: commands.length, changed, summary: summaryFor(kind, document, model) });
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
