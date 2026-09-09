import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

/** Include type-only and otherwise unbundled modules in the copyability check. */
export async function assertSourceBoundary(directory, manifest) {
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
  let sourceFiles = 0;
  async function visitDirectory(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, item.name);
      assert.ok(!item.isSymbolicLink(), `Source must be copyable without symlinks: ${filename}`);
      if (item.isDirectory()) { await visitDirectory(filename); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(filename)) continue;
      sourceFiles++;
      const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true);
      function checkSpecifier(specifier) {
        if (!specifier || !ts.isStringLiteralLike(specifier)) return;
        const imported = specifier.text;
        if (imported.startsWith('.')) {
          const target = path.resolve(path.dirname(filename), imported);
          assert.ok(target.startsWith(directory + path.sep), `Source import escapes its directory: ${filename}: ${imported}`);
        } else {
          const parts = imported.split('/');
          const dependency = imported.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
          assert.ok(declared.has(dependency), `Source imports an undeclared dependency or application alias: ${filename}: ${imported}`);
          assert.notEqual(dependency, manifest.name, `Copied source must not import its npm package: ${filename}`);
        }
      }
      function visit(node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) checkSpecifier(node.moduleSpecifier);
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) checkSpecifier(node.argument.literal);
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) checkSpecifier(node.moduleReference.expression);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          assert.ok(node.arguments.length && ts.isStringLiteralLike(node.arguments[0]), `Source imports must have a static path: ${filename}`);
          checkSpecifier(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  await visitDirectory(directory);
  assert.ok(sourceFiles > 0, 'The library source directory is empty.');
  return sourceFiles;
}
