import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { narrowDeclarationBridge } from '../lib/declaration-bridges.mjs';
import { libraryModule } from '../lib/modules.mjs';

for (const moduleName of ['spreadsheet', 'slide', 'document']) test(`${moduleName} declaration bridges use pure Core subpaths, preserving their complete export lists`, async () => {
  const { declarationBridgeTargets, sourceRoot } = libraryModule(moduleName);
  assert.deepEqual(Object.keys(declarationBridgeTargets), ['json.d.ts', 'ooxml.d.ts', 'model/core-connectors.d.ts',
    'model/core-office-shapes.d.ts', 'model/core-image-assets.d.ts', ...(moduleName === 'spreadsheet' ? ['model/core-text-search.d.ts'] : [])]);
  for (const [file, target] of Object.entries(declarationBridgeTargets)) {
    // These maintained bridges contain only the named re-exports emitted into their declarations.
    const contents = await readFile(path.join(sourceRoot, file.replace(/\.d\.ts$/, '.ts')), 'utf8');
    const narrowed = narrowDeclarationBridge(file, contents, declarationBridgeTargets);
    assert.equal(narrowed, contents.replaceAll(`"${target.from}"`, `"${target.to}"`), file);
    assert.equal(narrowDeclarationBridge(file, contents), contents, 'Other module profiles are unchanged');
  }
  const root = 'export * from "@likex/core";\n';
  assert.equal(narrowDeclarationBridge('core.d.ts', root, declarationBridgeTargets), root);
  const other = 'export { createTextSearchMatcher } from "../core";\n';
  assert.equal(narrowDeclarationBridge('model/unrelated.d.ts', other, declarationBridgeTargets), other);
});

test('narrowing changes only known module specifiers, retaining comments, aliases and type-only exports', () => {
  const targets = { 'bridge.d.ts': { from: './core', to: '@likex/core/json', expectedExports: 2 } };
  const contents = `// The string "./core" in a comment stays unchanged.
export { serializeStableJson as stableJson } from "./core";
export type { StableJsonOptions as Options } from './core';
export { unrelated } from "./other";
`;
  assert.equal(narrowDeclarationBridge('bridge.d.ts', contents, targets), `// The string "./core" in a comment stays unchanged.
export { serializeStableJson as stableJson } from "@likex/core/json";
export type { StableJsonOptions as Options } from '@likex/core/json';
export { unrelated } from "./other";
`);
});

test('changed or wildcard declaration bridges fail instead of silently broadening model dependencies', () => {
  const targets = libraryModule('spreadsheet').declarationBridgeTargets;
  for (const contents of ['', 'export { value } from "./other";', 'export { value } from "./core";',
    'export { one } from "./core"; export type { Two } from "./core"; export { three } from "./core";'])
    assert.throws(() => narrowDeclarationBridge('json.d.ts', contents, targets), /Expected 2 named exports/);
  for (const contents of ['export * from "./core";', 'export type * from "./core";', 'export * as core from "./core";'])
    assert.throws(() => narrowDeclarationBridge('json.d.ts', contents, targets), /explicit named exports/);
});
