import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = join(packageRoot, 'src');
const configFile = ts.readConfigFile(join(packageRoot, 'tsconfig.json'), ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
const { options } = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageRoot);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:[cm]?ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat().sort();
}

/** TypeScript's syntax flags distinguish erased dependencies from imports that execute a module. */
function moduleDependencies(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const dependencies = [];
  const add = (node, specifier, runtime) => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return;
    dependencies.push({ specifier: specifier.text, runtime: runtime && !source.isDeclarationFile,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  };
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const onlyNamedTypes = named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly);
      add(node, node.moduleSpecifier, !clause?.isTypeOnly && (!onlyNamedTypes || !!clause?.name));
    } else if (ts.isExportDeclaration(node)) {
      const named = node.exportClause;
      const onlyNamedTypes = named && ts.isNamedExports(named) && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly);
      add(node, node.moduleSpecifier, !node.isTypeOnly && !onlyNamedTypes);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, !node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, false);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      add(node, node.arguments[0], true);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return dependencies;
}

const files = await sourceFiles(sourceRoot);
const localFiles = new Set(files);
const dependencies = new Map(await Promise.all(files.map(async path => {
  const edges = moduleDependencies(path, await readFile(path, 'utf8')).map(dependency => {
    const resolvedModule = ts.resolveModuleName(dependency.specifier, path, options, ts.sys).resolvedModule;
    return { ...dependency, target: resolvedModule ? resolve(resolvedModule.resolvedFileName) : undefined };
  });
  return [path, edges];
})));
const display = path => relative(sourceRoot, path).split(sep).join('/');
const layer = path => path && localFiles.has(path) ? display(path).split('/')[0] : null;

test('data, commands, history and sessions remain independent of view state, UI, React and component props', () => {
  const violations = [];
  for (const [path, edges] of dependencies) {
    if (!['model', 'commands', 'history', 'session'].includes(layer(path))) continue;
    for (const edge of edges) {
      if (['state', 'ui'].includes(layer(edge.target)) || edge.target === join(sourceRoot, 'props.ts') ||
        /^(?:react|react-dom)(?:\/|$)/.test(edge.specifier)) {
        violations.push(`${display(path)}:${edge.line} → ${edge.specifier}`);
      }
    }
  }
  assert.deepEqual(violations, [], `Model dependencies must point toward domain code:\n${violations.join('\n')}`);
});

test('GUI adapters never call low-level workbook mutators instead of the command API', async () => {
  const mutators = new Set(['setCellValue', 'setCellValues', 'formatCells', 'resizeColumn', 'insertRows', 'deleteRows',
    'insertColumns', 'deleteColumns', 'moveCells', 'addSheet', 'renameSheet', 'deleteSheet', 'moveSheet',
    'addDrawing', 'updateDrawing', 'deleteDrawing', 'insertImage', 'setCellComment', 'setCellComments',
    'mergeCells', 'unmergeCells', 'setCellDataValidation', 'pasteCells', 'fillCells', 'replaceCellText']);
  const violations = [];
  for (const path of files) {
    if (!['state', 'ui'].includes(layer(path))) continue;
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const imported of bindings.elements) {
        const name = imported.propertyName?.text ?? imported.name.text;
        if (!imported.isTypeOnly && mutators.has(name)) violations.push(`${display(path)} → ${name}`);
      }
    }
  }
  assert.deepEqual(violations, [], 'GUI data writes must use the shared command boundary');
});

test('state never imports or re-exports UI modules, including type dependencies', () => {
  const violations = [];
  for (const [path, edges] of dependencies) {
    if (layer(path) !== 'state') continue;
    for (const edge of edges) if (layer(edge.target) === 'ui') violations.push(`${display(path)}:${edge.line} → ${edge.specifier}`);
  }
  assert.deepEqual(violations, [], `State must remain usable without UI modules:\n${violations.join('\n')}`);
});

test('local runtime imports and re-exports have no dependency cycles', () => {
  const completed = new Set(), active = new Set(), stack = [], cycles = new Set();
  const visit = path => {
    if (active.has(path)) {
      cycles.add([...stack.slice(stack.indexOf(path)), path].map(display).join(' → '));
      return;
    }
    if (completed.has(path)) return;
    active.add(path); stack.push(path);
    for (const edge of dependencies.get(path)) if (edge.runtime && localFiles.has(edge.target)) visit(edge.target);
    stack.pop(); active.delete(path); completed.add(path);
  };
  for (const path of files) visit(path);
  assert.deepEqual([...cycles], [], `Runtime dependency cycles:\n${[...cycles].join('\n')}`);
});

test('type-only import and re-export syntax is excluded from the runtime graph', () => {
  const edges = moduleDependencies(join(sourceRoot, 'fixture.ts'), `
    import type { A } from './type-import';
    import { type B } from './named-type-import';
    export type { C } from './type-export';
    export { type D } from './named-type-export';
    type E = import('./import-type-expression').E;
    import { type F, value } from './mixed-import';
    export { type G, anotherValue } from './mixed-export';
    import './side-effect';
    export * from './barrel';
    void import('./dynamic-import');
  `);
  assert.deepEqual(edges.filter(edge => edge.runtime).map(edge => edge.specifier),
    ['./mixed-import', './mixed-export', './side-effect', './barrel', './dynamic-import']);
});
