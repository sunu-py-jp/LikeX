import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { resolveExplorerNavigation, resolveExplorerFileTargets } = await importTypeScript('../src/model/navigation.ts');
const folder = (id, parent, name) => ({ id, parent, name, kind: 'folder' });
const file = (id, parent, name) => ({ id, parent, name, kind: 'file' });
const entries = Object.freeze([
  folder('docs', 'root', 'Docs'), folder('plans', 'docs', '計画'), folder('photos', 'root', 'Photos'),
  folder('literal-root-label', 'root', 'ファイル'),
  file('root-file', 'root', 'README.md'), file('report', 'plans', 'report.txt'),
  file('summary', 'plans', '概要.csv'), file('other-report', 'photos', 'report.txt'),
  file('unicode', 'docs', 'が.txt'), file('space', 'docs', 'A B.txt'), file('encoded', 'docs', 'A%20B.txt'),
].map(Object.freeze));
const navigate = path => resolveExplorerNavigation(entries, path);
const select = targets => resolveExplorerFileTargets(entries, targets);
const error = (result, code) => {
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length);
  assert.equal(Object.hasOwn(result, 'value'), false, 'failed requests must not expose a partial selection');
};

test('absolute folder navigation starts at the virtual root and expands the complete ancestor path', () => {
  assert.deepEqual(navigate('/'), { ok: true, value: { location: 'root', expanded: ['root'], fileIds: [] } });
  for (const path of ['/Docs/計画', ' /docs/計画/ ', '\\Docs\\計画', '/Docs/./計画']) {
    assert.deepEqual(navigate(path), { ok: true, value: { location: 'plans', expanded: ['root', 'docs', 'plans'], fileIds: [] } });
  }
  assert.equal(navigate('/Docs/計画/..').value.location, 'docs');
  assert.equal(navigate('/../../Photos').value.location, 'photos');
  assert.equal(navigate('/ファイル').value.location, 'literal-root-label');
});

test('relative, external and non-string folder addresses are rejected without falling back to root', () => {
  for (const path of ['', ' ', '.', '..', 'Docs', 'ファイル/Docs', 'docs', 'https://example.com/Docs',
    'C:\\Docs', '//server/Docs', '\\\\server\\Docs', '/\u0000Docs', null, undefined, 42]) error(navigate(path), 'invalid-path');
  error(navigate('/missing'), 'not-found');
  error(navigate('/README.md'), 'not-folder');
  error(navigate('/README.md/../Docs'), 'not-folder');
});

test('file IDs and paths resolve the current parent with normalized names and exact IDs', () => {
  const expected = { ok: true, value: { location: 'plans', expanded: ['root', 'docs', 'plans'], fileIds: ['report'] } };
  assert.deepEqual(select([{ id: 'report' }]), expected);
  assert.deepEqual(select([{ path: '/DOCS/計画/REPORT.TXT' }]), expected);
  assert.equal(select([{ path: '/Docs/か\u3099.txt' }]).value.fileIds[0], 'unicode');
  assert.equal(select([{ path: '/Docs/A B.txt' }]).value.fileIds[0], 'space');
  assert.equal(select([{ path: '/Docs/A%20B.txt' }]).value.fileIds[0], 'encoded', 'paths are literal, not URL-decoded');
  error(select([{ id: 'REPORT' }]), 'not-found');
  error(select([{ id: 'report.txt' }]), 'not-found');
  error(select([{ id: '/Docs/計画/report.txt' }]), 'not-found');
  error(select([{ path: 'report' }]), 'invalid-path');
});

test('multi-file resolution deduplicates identities in input order and fails the whole request across folders', () => {
  assert.deepEqual(select([{ id: 'summary' }, { path: '/Docs/計画/report.txt' }, { id: 'report' }, { id: 'summary' }]), {
    ok: true, value: { location: 'plans', expanded: ['root', 'docs', 'plans'], fileIds: ['summary', 'report'] },
  });
  error(select([{ id: 'report' }, { id: 'other-report' }]), 'different-folders');
  error(select([{ id: 'report' }, { path: '/Docs/計画/missing.txt' }]), 'not-found');
  assert.deepEqual(select([]), { ok: true, value: { location: null, expanded: [], fileIds: [] } });
});

test('file-only targets reject folders, malformed unions, sparse arrays and accessors', () => {
  for (const target of [{ id: 'docs' }, { path: '/Docs' }, { id: 'root' }, { path: '/' }]) error(select([target]), 'not-file');
  for (const target of [null, undefined, 'report', {}, { id: '' }, { path: '' }, { id: 42 }, { path: 42 },
    { id: 'report', path: '/Docs/計画/report.txt' }, { id: 'report', path: undefined }, { id: 'report', extra: true }, [], new Map()]) {
    error(select([target]), 'invalid-target');
  }
  let reads = 0;
  error(select([{ get id() { reads++; return 'report'; } }]), 'invalid-target');
  assert.equal(reads, 0);
  error(select([, { id: 'report' }]), 'invalid-target');
  error(select(null), 'invalid-target');
});

test('ambiguous folder and file paths fail instead of selecting the first match', () => {
  const duplicateFolder = [...entries, folder('duplicate-docs', 'root', 'DOCS')];
  error(resolveExplorerNavigation(duplicateFolder, '/Docs/計画'), 'ambiguous-path');
  error(resolveExplorerFileTargets(duplicateFolder, [{ path: '/Docs/計画/report.txt' }]), 'ambiguous-path');
  assert.equal(resolveExplorerFileTargets(duplicateFolder, [{ id: 'report' }]).ok, true, 'exact IDs disambiguate duplicate names');
  const duplicateFile = [...entries, file('duplicate-report', 'plans', 'REPORT.TXT')];
  error(resolveExplorerFileTargets(duplicateFile, [{ path: '/Docs/計画/report.txt' }]), 'ambiguous-path');
  const duplicateUnicode = [...entries, file('duplicate-unicode', 'docs', 'か\u3099.txt')];
  error(resolveExplorerFileTargets(duplicateUnicode, [{ path: '/Docs/が.txt' }]), 'ambiguous-path');
});

test('broken parents, cyclic folder chains, file ancestors and duplicate IDs are never resolved by ID', () => {
  for (const extra of [
    [file('broken', 'missing', 'broken.txt')],
    [folder('cycle', 'cycle', 'Cycle'), file('broken', 'cycle', 'broken.txt')],
    [file('broken', 'root-file', 'broken.txt')],
    [file('report', 'root', 'duplicate.txt'), file('broken', 'root', 'broken.txt')],
    [folder('root', 'root', 'Invalid root'), file('broken', 'root', 'broken.txt')],
  ]) error(resolveExplorerFileTargets([...entries, ...extra], [{ id: 'broken' }]), 'invalid-hierarchy');
});

test('resolution uses the current entries after file moves or renames and never mutates inputs', () => {
  const targets = Object.freeze([Object.freeze({ id: 'report' })]);
  const before = structuredClone(entries);
  assert.equal(select(targets).value.location, 'plans');
  assert.deepEqual(entries, before);
  assert.deepEqual(targets, [{ id: 'report' }]);
  const moved = entries.map(entry => entry.id === 'report' ? { ...entry, parent: 'photos', name: 'renamed.txt' } : entry);
  assert.deepEqual(resolveExplorerFileTargets(moved, targets).value, { location: 'photos', expanded: ['root', 'photos'], fileIds: ['report'] });
  error(resolveExplorerFileTargets(moved, [{ path: '/Docs/計画/report.txt' }]), 'not-found');
  assert.equal(resolveExplorerFileTargets(moved, [{ path: '/Photos/renamed.txt' }]).value.fileIds[0], 'report');
  assert.deepEqual(entries, before);
});

test('large path selections inspect sibling names once per batch instead of once per selected file', () => {
  let nameReads = 0;
  const count = 2_000;
  const files = Array.from({ length: count }, (_, index) => Object.freeze({ id: `file-${index}`, parent: 'folder', kind: 'file',
    get name() { nameReads++; return `file-${index}.txt`; },
  }));
  const current = Object.freeze([Object.freeze(folder('folder', 'root', 'Files')), ...files]);
  assert.equal(resolveExplorerFileTargets(current, [{ id: 'file-0' }]).ok, true, 'warm the shared index before measuring resolution');
  nameReads = 0;
  const result = resolveExplorerFileTargets(current, Array.from({ length: count }, (_, index) => ({ path: `/Files/file-${index}.txt` })));
  assert.equal(result.ok, true);
  assert.equal(result.value.fileIds.length, count);
  assert.equal(result.value.fileIds.at(-1), `file-${count - 1}`);
  assert.ok(nameReads <= count * 2, `a ${count}-file batch read sibling names ${nameReads} times`);
  const duplicate = Object.freeze([...current, Object.freeze(file('duplicate', 'folder', 'FILE-1999.TXT'))]);
  error(resolveExplorerFileTargets(duplicate, [{ path: '/Files/file-0.txt' }, { path: '/Files/file-1999.txt' }]), 'ambiguous-path');
});
