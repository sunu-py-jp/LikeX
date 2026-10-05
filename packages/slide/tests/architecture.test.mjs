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

test('core.ts is the sole Core package reference, including type-only imports', async () => {
  const references = [];
  for (const path of await sourceFiles(sourceRoot)) {
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const add = specifier => {
      if (specifier && ts.isStringLiteralLike(specifier) && /^@likex\/core(?:\/|$)/.test(specifier.text))
        references.push({ file: relative(sourceRoot, path).split(sep).join('/'), specifier: specifier.text });
    };
    const visit = node => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(references, [{ file: 'core.ts', specifier: '@likex/core' }],
    'Source-copy installation must require changing only core.ts');
});
