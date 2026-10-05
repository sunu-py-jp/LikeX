import assert from 'node:assert/strict';
import ts from 'typescript';

/** Narrow declaration dependencies without changing the maintained export lists. */
export function narrowDeclarationBridge(file, contents, targets = {}) {
  const target = targets[file];
  if (!target) return contents;
  const source = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);
  const replacements = [];
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) || statement.moduleSpecifier.text !== target.from) continue;
    assert.ok(statement.exportClause && ts.isNamedExports(statement.exportClause),
      `Declaration bridge must preserve explicit named exports: ${file}`);
    replacements.push({ start: statement.moduleSpecifier.getStart(source) + 1, end: statement.moduleSpecifier.end - 1 });
  }
  assert.equal(replacements.length, target.expectedExports,
    `Expected ${target.expectedExports} named exports from ${target.from} in declaration bridge ${file}`);
  // Replace just the specifier contents; comments, aliases and type-only flags stay intact.
  for (const { start, end } of replacements.reverse()) contents = contents.slice(0, start) + target.to + contents.slice(end);
  return contents;
}
