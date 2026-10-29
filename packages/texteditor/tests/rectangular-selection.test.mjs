import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const result = await build({
  stdin: { contents: `export { rectangleBetween, RectangleSelectionSession, rectangleMouseStyle } from './src/ui/rectangular-selection';
    export { codeSelectionToSource } from './src/ui/code-editor';
    export { EditorState, EditorSelection, Text } from '@codemirror/state';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const temporary = await mkdtemp(join(tmpdir(), 'likex-rectangle-'));
const bundlePath = join(temporary, 'bundle.mjs');
await writeFile(bundlePath, result.outputFiles[0].text);
const { rectangleBetween, RectangleSelectionSession, rectangleMouseStyle, codeSelectionToSource, EditorState, EditorSelection, Text } = await import(pathToFileURL(bundlePath).href);
await rm(temporary, { recursive: true, force: true });

function stateFor(lines, options = {}) {
  return EditorState.create({ doc: Text.of(lines), selection: EditorSelection.cursor(options.cursor ?? 0), extensions: [
    EditorState.allowMultipleSelections.of(true), EditorState.tabSize.of(4),
    EditorState.readOnly.of(options.readOnly ?? false), EditorState.lineSeparator.of(options.separator ?? '\n'),
  ] });
}
function point(state, line, column) { return { offset: state.doc.line(line).from + Math.min(column, state.doc.line(line).length), column }; }
function ranges(selection) { return selection.ranges.map(range => [range.anchor, range.head]); }
function selected(state, selection) { return selection.ranges.map(range => state.sliceDoc(range.from, range.to)); }
function mouse(line, column, extra = {}) { return { altKey: true, shiftKey: true, button: 0, clientX: column * 10, clientY: (line - 1) * 20 + 10, ...extra }; }
// Deterministic ASCII geometry for the mouse adapter; range calculations use real CodeMirror state.
function viewFor(lines, options) {
  const view = { state: stateFor(lines, options), defaultCharacterWidth: 10,
    posAtCoords({ x, y }) {
      const lineNumber = Math.floor(y / 20) + 1;
      if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
      const line = view.state.doc.line(lineNumber);
      return line.from + Math.max(0, Math.min(line.length, Math.floor(x / 10)));
    },
    coordsAtPos(offset) { const line = view.state.doc.lineAt(offset); return { left: (offset - line.from) * 10 }; },
  };
  return view;
}
function apply(view, session, spec) {
  const startState = view.state, transaction = startState.update(spec);
  view.state = transaction.state;
  const update = { startState, state: view.state, docChanged: transaction.docChanged, selectionSet: !!transaction.selection, changes: transaction.changes };
  session.update(update);
  return update;
}

test('click rectangle selects the intervening columns and replacement edits each selected line', () => {
  const state = stateFor(['abcd', 'uvwx', '1234']);
  const selection = rectangleBetween(state, point(state, 1, 1), point(state, 3, 3));
  assert.deepEqual(selected(state, selection), ['bc', 'vw', '23']);
  assert.equal(selection.mainIndex, 2);
  const selectedState = state.update({ selection }).state;
  assert.equal(selectedState.update(selectedState.replaceSelection('X')).state.sliceDoc(), 'aXd\nuXx\n1X4');
});

test('reverse corners preserve horizontal selection direction and put the main selection on the endpoint line', () => {
  const state = stateFor(['abcd', 'uvwx', '1234']);
  const selection = rectangleBetween(state, point(state, 3, 3), point(state, 1, 1));
  assert.deepEqual(ranges(selection), [[3, 1], [8, 6], [13, 11]]);
  assert.equal(selection.mainIndex, 0);
  assert.deepEqual(selected(state, selection), ['bc', 'vw', '23']);
});

test('equal columns create one cursor per line and short or empty lines stop at their own end', () => {
  const state = stateFor(['abcd', 'x', '', 'efgh']);
  const selection = rectangleBetween(state, point(state, 1, 2), point(state, 4, 2));
  assert.deepEqual(ranges(selection), [[2, 2], [6, 6], [7, 7], [10, 10]]);
  const selectedState = state.update({ selection }).state;
  assert.equal(selectedState.update(selectedState.replaceSelection('Z')).state.sliceDoc(), 'abZcd\nxZ\nZ\nefZgh');
  const wide = rectangleBetween(state, point(state, 1, 1), point(state, 4, 3));
  assert.deepEqual(selected(state, wide), ['bc', '', '', 'fg']);
});

test('tab columns and grapheme clusters are preserved when replacing a rectangle', () => {
  const state = stateFor(['\tA🙂e\u0301Z', '....B🙂e\u0301Q']);
  const selection = rectangleBetween(state, { offset: 2, column: 5 }, { offset: state.doc.line(2).from + 9, column: 7 });
  assert.deepEqual(selected(state, selection), ['🙂e\u0301', '🙂e\u0301']);
  const selectedState = state.update({ selection }).state;
  assert.equal(selectedState.update(selectedState.replaceSelection('!')).state.sliceDoc(), '\tA!Z\n....B!Q');
});

test('Alt+Shift click selects from the existing caret and repeated endpoints retain that original corner', () => {
  const view = viewFor(['abcd', 'wxyz', '1234', 'ABCDE'], { cursor: 1 }), session = new RectangleSelectionSession();
  const event = mouse(3, 3), first = rectangleMouseStyle(view, event, session).get(event, true, true);
  assert.deepEqual(selected(view.state, first), ['bc', 'xy', '23']);
  apply(view, session, { selection: first });
  const nextEvent = mouse(4, 2), next = rectangleMouseStyle(view, nextEvent, session).get(nextEvent, true, true);
  assert.deepEqual(selected(view.state, next), ['b', 'x', '2', 'B']);
  assert.equal(next.mainIndex, 3);
  // The modifier's multiple=true flag must not accumulate prior rectangles.
  assert.equal(next.ranges.length, 4);
});

test('ordinary selection and document changes reset the remembered rectangle corner', () => {
  const view = viewFor(['abcd', 'wxyz', '1234', 'ABCDE'], { cursor: 1 }), session = new RectangleSelectionSession();
  const event = mouse(3, 3), first = rectangleMouseStyle(view, event, session).get(event, true, true);
  apply(view, session, { selection: first });
  apply(view, session, { selection: EditorSelection.cursor(5) });
  assert.equal(session.anchor, null);
  const nextEvent = mouse(4, 1), next = rectangleMouseStyle(view, nextEvent, session).get(nextEvent, true, true);
  assert.deepEqual(selected(view.state, next), ['w', '1', 'A']);
  apply(view, session, { selection: next });
  apply(view, session, { changes: { from: 0, insert: 'new\n' } });
  assert.equal(session.anchor, null);
  assert.equal(session.selection, null);
});

test('small pointer jitter remains a click, while an Alt+Shift drag starts from the mousedown position', () => {
  const view = viewFor(['abcd', 'wxyz', '1234', 'ABCDE'], { cursor: 1 }), session = new RectangleSelectionSession();
  const down = mouse(3, 2), style = rectangleMouseStyle(view, down, session);
  assert.equal(style.get(down, true, true).ranges.length, 3);
  assert.equal(style.get({ ...down, clientX: down.clientX + 3 }, true, true).ranges.length, 3);
  assert.deepEqual(ranges(style.get({ ...down, clientX: down.clientX + 4 }, true, true)), [[12, 12]]);
  const dragged = style.get(mouse(4, 3), true, true);
  assert.deepEqual(selected(view.state, dragged), ['3', 'C']);
  assert.equal(dragged.mainIndex, 1);
});

test('dragging from past the end of a short line retains the intended column for longer lines', () => {
  const view = viewFor(['abcdef', 'x', 'abcdef'], { cursor: 2 }), session = new RectangleSelectionSession();
  const down = mouse(2, 5), style = rectangleMouseStyle(view, down, session);
  const selection = style.get(mouse(3, 4), true, true);
  assert.deepEqual(selected(view.state, selection), ['', 'e']);
  assert.deepEqual(ranges(selection), [[8, 8], [14, 13]]);
});

test('read-only CRLF documents allow rectangle selection without changing text and report source offsets', () => {
  const view = viewFor(['abcd', 'wxyz', '1234'], { cursor: 1, readOnly: true, separator: '\r\n' }), session = new RectangleSelectionSession();
  const before = view.state.sliceDoc(), event = mouse(3, 3);
  const selection = rectangleMouseStyle(view, event, session).get(event, true, true);
  const update = apply(view, session, { selection });
  assert.equal(update.docChanged, false);
  assert.equal(view.state.sliceDoc(), before);
  assert.deepEqual(codeSelectionToSource(view.state), { coordinateSpace: 'source', ranges: [{ anchor: 1, head: 3 }, { anchor: 7, head: 9 }, { anchor: 13, head: 15 }], mainIndex: 2 });
});

test('plain clicks, Alt-only clicks, non-left clicks and coordinates outside the document are left to other handlers', () => {
  const view = viewFor(['abcd']), session = new RectangleSelectionSession();
  for (const extra of [{ altKey: false }, { shiftKey: false }, { button: 2 }]) assert.equal(rectangleMouseStyle(view, mouse(1, 1, extra), session), null);
  assert.equal(rectangleMouseStyle(view, mouse(2, 1), session), null);
});
