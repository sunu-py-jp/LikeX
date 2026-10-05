import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:[cm]?ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat().sort();
}

test('core.ts is the sole Core package reference for both runtime and type-only dependencies', async () => {
  const references = [], violations = [];
  for (const path of await sourceFiles(sourceRoot)) {
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const file = relative(sourceRoot, path).split(sep).join('/');
    const check = (node, specifier) => {
      if (!specifier || !ts.isStringLiteralLike(specifier) || !/^@likex\/core(?:\/|$)/.test(specifier.text)) return;
      references.push({ file, specifier: specifier.text });
      if (file !== 'core.ts' || specifier.text !== '@likex/core')
        violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} → ${specifier.text}`);
    };
    const visit = node => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) check(node, node.moduleSpecifier);
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
        check(node, node.moduleReference.expression);
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) check(node, node.argument.literal);
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) check(node, node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, [], `Source-copy installation must require changing only core.ts:\n${violations.join('\n')}`);
  assert.deepEqual(references, [{ file: 'core.ts', specifier: '@likex/core' }]);
});
