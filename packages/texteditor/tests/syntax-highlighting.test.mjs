import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `
  import { EditorState } from '@codemirror/state';
  import { ensureSyntaxTree } from '@codemirror/language';
  import { highlightTree } from '@lezer/highlight';
  import { textEditorLanguageExtension, textEditorHighlightStyle } from './src/ui/code-language';
  import { yamlScalarDecorations } from './src/ui/yaml-scalar-highlighting';
  export function tokens(mode, source) {
    const state = EditorState.create({doc: source, extensions: [textEditorLanguageExtension(mode)]});
    const tree = ensureSyntaxTree(state, state.doc.length, 1000), result = [];
    if (tree) highlightTree(tree, textEditorHighlightStyle, (from, to, classes) =>
      result.push({text: state.sliceDoc(from, to), classes: classes.split(' ')}));
    if (mode === 'yaml') yamlScalarDecorations(state, [{from: 0, to: state.doc.length}]).between(0, state.doc.length,
      (from, to, decoration) => result.push({text: state.sliceDoc(from, to), classes: decoration.spec.class.split(' ')}));
    return result;
  }
  export function yamlVisibleTokens(source, from, to) {
    const state = EditorState.create({doc: source, extensions: [textEditorLanguageExtension('yaml')]});
    ensureSyntaxTree(state, state.doc.length, 1000);
    const result = [];
    yamlScalarDecorations(state, [{from, to}]).between(0, state.doc.length,
      (start, end, decoration) => result.push({text: state.sliceDoc(start, end), classes: decoration.spec.class.split(' ')}));
    return result;
  }
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { tokens, yamlVisibleTokens } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const role = (values, text, expected) => assert.ok(values.some(value => value.text === text && value.classes.includes(`lxte-syntax-${expected}`)), `${text} should be highlighted as ${expected}: ${JSON.stringify(values)}`);

test('JSON keys, strings, numbers and literal values receive distinct syntax roles', () => {
  const values = tokens('json', '{"name":"日本","count":42,"enabled":true,"empty":null}');
  role(values, '"name"', 'property'); role(values, '"日本"', 'string');
  role(values, '42', 'number'); role(values, 'true', 'atom'); role(values, 'null', 'atom');
});

test('XML tags, attributes, strings and comments are highlighted without executing markup', () => {
  const values = tokens('xml', '<request enabled="true"><name>日本</name><!-- comment --></request>');
  role(values, 'request', 'tag'); role(values, 'enabled', 'attribute');
  role(values, '"true"', 'string'); role(values, '<!-- comment -->', 'comment');
});

test('YAML keys, quoted text, numbers, booleans and comments use the language parser', () => {
  const values = tokens('yaml', '# config\nname: "日本"\ncount: 42\nenabled: true\nempty: null\nlist:\n  - one\n');
  role(values, '# config', 'comment'); role(values, 'name', 'property');
  role(values, '"日本"', 'string'); role(values, '42', 'number'); role(values, 'true', 'atom');
});

test('plain text stays unhighlighted and Markdown source retains heading and emphasis roles', () => {
  assert.deepEqual(tokens('text', '{"key":42}\n<name>text</name>'), []);
  const values = tokens('markdown', '# Heading\n\n**Bold** and *italic*\n');
  assert.ok(values.some(value => value.text.includes('Heading') && value.classes.includes('lxte-syntax-heading')));
  assert.ok(values.some(value => value.text.includes('Bold') && value.classes.includes('lxte-syntax-strong')));
  assert.ok(values.some(value => value.text.includes('italic') && value.classes.includes('lxte-syntax-emphasis')));
});

test('incomplete structured sources remain parseable during editing', () => {
  for (const [mode, source] of [['json', '{"name": "unfinished'], ['xml', '<request enabled="'], ['yaml', 'items:\n  - "unfinished']])
    assert.doesNotThrow(() => tokens(mode, source));
});

test('YAML scalar hints only visit visible values and respect explicitly tagged strings', () => {
  const source = 'before: 123\nvisible: true\nafter: 456\n';
  const values = yamlVisibleTokens(source, source.indexOf('visible'), source.indexOf('after'));
  role(values, 'true', 'atom');
  assert.ok(!values.some(value => value.text === '123' || value.text === '456'));
  const typed = tokens('yaml', 'code: !!str 42\nquoted: "true"\nbase: &base { retries: 3 }\ncopy: *base\n');
  role(typed, '42', 'string'); role(typed, '"true"', 'string');
  role(typed, '!!str', 'meta'); role(typed, '&base', 'meta'); role(typed, '*base', 'meta');
});
