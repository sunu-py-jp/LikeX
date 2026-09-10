import assert from 'node:assert/strict';
import path from 'node:path';
import { artifactRoot, projectRoot } from './run.mjs';

// Distribution differences live here; build/pack/consumer checks are shared.
const modules = {
  core: { ui: false, generatedStyles: false, bundledDependencies: [], moduleDependencies: [] },
  explorer: {
    ui: true,
    moduleDependencies: ['core'],
    generatedStyles: true, bundledDependencies: ['tailwindcss'],
    marker: 'data-likex-explorer', classPrefix: '.lxe\\:', propertyPrefix: '--lxe-', keyframePrefix: 'lxe',
    requiredClasses: ['.lxe\\:flex', '.lxe\\:min-h-0', '.lxe\\:h-8', '.lxe\\:resize-none'],
    background: '--explorer-background', foreground: '--explorer-foreground', serverText: 'Server-readonly.txt',
  },
  spreadsheet: {
    ui: true,
    headlessEntries: { model: 'model-entry.ts' },
    moduleDependencies: ['core'],
    generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-spreadsheet', classPrefix: '.lxs-', propertyPrefix: '--lxs-', keyframePrefix: 'lxs',
    requiredClasses: ['.lxs-root', '.lxs-grid', '.lxs-cell'],
    background: '--lxs-background', foreground: '--lxs-foreground', serverText: 'Spreadsheet consumer cell',
  },
};
export const moduleNames = Object.freeze(Object.keys(modules));

export function libraryModule(name = 'explorer') {
  assert.ok(Object.hasOwn(modules, name), `Unknown library module: ${name}`);
  const packageRoot = path.join(projectRoot, 'packages', name);
  return { ...modules[name], name, packageRoot, sourceRoot: path.join(packageRoot, 'src'),
    npmCacheRoot: path.join(artifactRoot, 'npm-cache'),
    // Keep existing Explorer artifact paths for current scripts and consumers.
    artifactRoot: name === 'explorer' ? artifactRoot : path.join(artifactRoot, name),
  };
}

export function requestedModules(args = process.argv.slice(2)) {
  const selected = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--module') {
      assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), '--module requires a module name');
      selected.push(args[++index]);
    } else if (args[index].startsWith('--module=')) selected.push(args[index].slice('--module='.length));
  }
  assert.ok(selected.length <= 1, 'Specify --module only once');
  assert.ok(!(args.includes('--all') && selected.length), 'Use --all or --module, not both');
  const names = args.includes('--all') ? moduleNames : selected.length ? selected : ['explorer'];
  names.forEach(name => libraryModule(name));
  return names;
}

/** Build and pack ordinary workspace dependencies before their dependants. */
export function dependencyOrder(names) {
  const ordered = new Set();
  const visiting = new Set();
  function visit(name) {
    if (ordered.has(name)) return;
    assert.ok(!visiting.has(name), `Circular module dependency: ${name}`);
    visiting.add(name);
    libraryModule(name).moduleDependencies.forEach(visit);
    visiting.delete(name);
    ordered.add(name);
  }
  names.forEach(visit);
  return [...ordered];
}
