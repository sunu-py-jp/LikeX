import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const playground = fileURLToPath(new URL('../', import.meta.url));
const configPath = path.join(playground, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, playground);
assert.deepEqual(parsed.errors, []);

// Core is built by pretypecheck; UI package output must not hide missing source mappings.
const isUiPackageOutput = file => /\/(?:packages|node_modules\/@likex)\/(?!core\/)[^/]+\/dist(?:\/|$)/.test(file.replaceAll('\\', '/'));
const host = {
  ...ts.sys,
  fileExists: file => !isUiPackageOutput(file) && ts.sys.fileExists(file),
  directoryExists: directory => !isUiPackageOutput(directory) && ts.sys.directoryExists(directory),
};

test('Playground library imports resolve without prebuilt UI packages', () => {
  const unresolved = [];
  for (const file of parsed.fileNames) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports = new Set();
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.add(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
        imports.add(node.arguments[0].text);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        imports.add(node.argument.literal.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const specifier of imports) {
      if (!specifier.startsWith('@likex/')) continue;
      const { resolvedModule } = ts.resolveModuleName(specifier, file, parsed.options, host);
      if (!resolvedModule || isUiPackageOutput(resolvedModule.resolvedFileName)) {
        unresolved.push(`${path.relative(playground, file)}: ${specifier}`);
      }
    }
  }
  assert.deepEqual(unresolved, [], 'Workspace imports need source paths for a clean checkout');
});
