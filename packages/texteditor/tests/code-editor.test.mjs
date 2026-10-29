import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const result = await build({
  stdin: { contents: `export { runCodeEditorAction, codeSelectionToSource, sourcePositionToCode } from './src/ui/code-editor';
    export { EditorState, EditorSelection, Text } from '@codemirror/state';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const temporary = await mkdtemp(join(tmpdir(), 'likex-code-editor-'));
const bundlePath = join(temporary, 'bundle.mjs');
await writeFile(bundlePath, result.outputFiles[0].text);
const { EditorState, EditorSelection, Text, runCodeEditorAction, codeSelectionToSource, sourcePositionToCode } = await import(pathToFileURL(bundlePath).href);
await rm(temporary, { recursive: true, force: true });

function editor(text, selections = [{ anchor: 0 }], readOnly = false) {
  const view = { state: EditorState.create({ doc: text, selection: EditorSelection.create(selections.map(range => EditorSelection.range(range.anchor, range.head ?? range.anchor))),
    extensions: [EditorState.allowMultipleSelections.of(true), EditorState.readOnly.of(readOnly)] }),
    dispatch(spec) { view.state = spec.state ?? view.state.update(spec).state; },
    moveVertically(range) { const line = view.state.doc.lineAt(range.head); return EditorSelection.cursor(line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1).from : line.to); },
  };
  // CodeMirror commands receive dispatch as a standalone function.
  view.dispatch = view.dispatch.bind(view);
  return view;
}
const callbacks = { onUndo() {}, onRedo() {} };

test('select all, next occurrence and all occurrences work on actual CodeMirror selections', () => {
  const view = editor('alpha beta alpha\nalpha', [{ anchor: 0, head: 5 }]);
  assert.equal(runCodeEditorAction(view, 'selectNextOccurrence', callbacks), true);
  assert.deepEqual(view.state.selection.ranges.map(range => [range.from, range.to]), [[0, 5], [11, 16]]);
  assert.equal(runCodeEditorAction(view, 'selectAllOccurrences', callbacks), true);
  assert.equal(view.state.selection.ranges.length, 3);
  view.dispatch(view.state.replaceSelection('A'));
  assert.equal(view.state.doc.toString(), 'A beta A\nA');
  runCodeEditorAction(view, 'selectAll', callbacks);
  assert.equal(view.state.selection.main.from, 0);
  assert.equal(view.state.selection.main.to, view.state.doc.length);
});

test('line movement, duplication, indentation and deletion modify the selected lines', () => {
  const view = editor('first\nsecond\nthird', [{ anchor: 7 }]);
  assert.equal(runCodeEditorAction(view, 'moveLineUp', callbacks), true);
  assert.equal(view.state.doc.toString(), 'second\nfirst\nthird');
  assert.equal(runCodeEditorAction(view, 'copyLineDown', callbacks), true);
  assert.equal(view.state.doc.toString(), 'second\nsecond\nfirst\nthird');
  runCodeEditorAction(view, 'indent', callbacks);
  assert.match(view.state.doc.toString(), /  second/);
  runCodeEditorAction(view, 'outdent', callbacks);
  assert.equal(view.state.doc.toString(), 'second\nsecond\nfirst\nthird');
  runCodeEditorAction(view, 'deleteLine', callbacks);
  assert.equal(view.state.doc.toString(), 'second\nfirst\nthird');
});

test('read-only action dispatcher blocks document mutations but keeps selection commands', () => {
  let history = 0;
  const view = editor('a\nb', [{ anchor: 0 }], true), initial = view.state;
  for (const action of ['moveLineUp', 'moveLineDown', 'copyLineUp', 'copyLineDown', 'deleteLine', 'indent', 'outdent', 'undo', 'redo', 'replace']) {
    assert.equal(runCodeEditorAction(view, action, { onUndo() { history++; }, onRedo() { history++; } }), false, action);
  }
  assert.equal(view.state, initial); assert.equal(history, 0);
  assert.equal(runCodeEditorAction(view, 'selectAll', callbacks), true);
  assert.equal(view.state.selection.main.to, 3);
});

test('CRLF source selection coordinates map correctly around Japanese and surrogate pairs', () => {
  const state = EditorState.create({ doc: Text.of(['日本🙂', '次の行', 'end']), extensions: [EditorState.lineSeparator.of('\r\n'), EditorState.allowMultipleSelections.of(true)],
    selection: EditorSelection.create([EditorSelection.range(0, 4), EditorSelection.range(5, 8), EditorSelection.cursor(9)], 1) });
  assert.equal(state.sliceDoc(), '日本🙂\r\n次の行\r\nend');
  assert.deepEqual(codeSelectionToSource(state), { coordinateSpace: 'source', ranges: [{ anchor: 0, head: 4 }, { anchor: 6, head: 9 }, { anchor: 11, head: 11 }], mainIndex: 1 });
  assert.equal(sourcePositionToCode(state, 6), 5);
  assert.equal(sourcePositionToCode(state, 9), 8);
  assert.equal(sourcePositionToCode(state, 11), 9);
  assert.equal(sourcePositionToCode(state, 5), 4);
  assert.throws(() => sourcePositionToCode(state, -1), RangeError);
  assert.throws(() => sourcePositionToCode(state, 100), RangeError);
});

test('history actions call the shared lifecycle rather than a second undo stack', () => {
  const view = editor('hello'), invoked = [];
  runCodeEditorAction(view, 'undo', { onUndo() { invoked.push('undo'); }, onRedo() {} });
  runCodeEditorAction(view, 'redo', { onUndo() {}, onRedo() { invoked.push('redo'); } });
  assert.deepEqual(invoked, ['undo', 'redo']);
  assert.equal(view.state.doc.toString(), 'hello');
});

test('disabled search and replacement cannot be invoked through the command dispatcher', () => {
  const view = editor('alpha alpha', [{ anchor: 0, head: 5 }]);
  const before = view.state;
  for (const action of ['find', 'findNext', 'findPrevious', 'selectSearchMatches', 'replace', 'replaceNext', 'replaceAll'])
    assert.equal(runCodeEditorAction(view, action, { ...callbacks, searchEnabled: false }), false, action);
  for (const action of ['replace', 'replaceNext', 'replaceAll'])
    assert.equal(runCodeEditorAction(view, action, { ...callbacks, replaceEnabled: false }), false, action);
  assert.equal(view.state, before);
  assert.equal(runCodeEditorAction(view, 'selectNextOccurrence', { ...callbacks, searchEnabled: false }), true, 'multi-selection remains independent from the search panel');
});
