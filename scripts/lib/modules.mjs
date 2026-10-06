import assert from 'node:assert/strict';
import path from 'node:path';
import { artifactRoot, projectRoot } from './run.mjs';

// Distribution differences live here; build/pack/consumer checks are shared.
const coreSourceCopyAdapters = {
  'core.ts': '../core',
  'browser.ts': '../core/browser',
  'ooxml.ts': '../core/ooxml',
  'json.ts': '../core/json',
  'model/core-connectors.ts': '../../core/connectors',
  'model/core-office-shapes.ts': '../../core/office-shapes',
  'model/core-text-search.ts': '../../core/text-search',
};
// Package model declarations retain narrow, DOM-free dependencies even though
// maintained source uses the single core.ts adapter for copy installation.
const officeDeclarationBridgeTargets = {
  'json.d.ts': { from: './core', to: '@likex/core/json', expectedExports: 2 },
  'ooxml.d.ts': { from: './core', to: '@likex/core/ooxml', expectedExports: 2 },
  'model/core-connectors.d.ts': { from: '../core', to: '@likex/core/connectors', expectedExports: 2 },
  'model/core-office-shapes.d.ts': { from: '../core', to: '@likex/core/office-shapes', expectedExports: 2 },
  'model/core-image-assets.d.ts': { from: '../core', to: '@likex/core/image-assets', expectedExports: 2 },
  'model/core-text-search.d.ts': { from: '../core', to: '@likex/core/text-search', expectedExports: 2 },
};
const modules = {
  core: { ui: false, generatedStyles: false, bundledDependencies: [], moduleDependencies: [], headlessDependencies: ['re2js'], headlessEntries: { ooxml: 'ooxml.ts', json: 'json.ts', connectors: 'connectors.ts', 'office-shapes': 'office-shapes.ts', 'text-search': 'text-search.ts', 'image-assets': 'image-assets.ts' }, browserEntries: { browser: 'browser.ts' } },
  explorer: {
    ui: true,
    headlessEntries: { model: 'model-entry.ts' },
    headlessDependencies: ['@likex/core', '@likex/core/json', '@likex/core/text-search', 'pdf-lib'],
    modelRuntimeDependencies: ['pdf-lib', 're2js'],
    modelTypeLibraries: ['ES2022', 'DOM'],
    moduleDependencies: ['core'],
    generatedStyles: true, bundledDependencies: ['tailwindcss'],
    marker: 'data-likex-explorer', classPrefix: '.lxe\\:', propertyPrefix: '--lxe-', keyframePrefix: 'lxe',
    requiredClasses: ['.lxe\\:flex', '.lxe\\:min-h-0', '.lxe\\:h-8', '.lxe\\:resize-none'],
    background: '--explorer-background', foreground: '--explorer-foreground', serverText: 'Server-readonly.txt',
  },
  spreadsheet: {
    ui: true,
    uiEntries: { thumbnail: 'thumbnail.ts' },
    skillName: 'likex-spreadsheet',
    headlessEntries: { model: 'model-entry.ts' },
    modelRuntimeDependencies: ['re2js'],
    headlessDependencies: ['@likex/core'],
    sourceCopyAdapters: { 'core.ts': '../core' },
    declarationBridgeTargets: {
      ...officeDeclarationBridgeTargets,
      'model/core-text-search.d.ts': { from: '../core', to: '@likex/core/text-search', expectedExports: 2 },
    },
    moduleDependencies: ['core'],
    generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-spreadsheet', classPrefix: '.lxs-', propertyPrefix: '--lxs-', keyframePrefix: 'lxs',
    requiredClasses: ['.lxs-root', '.lxs-grid', '.lxs-cell'],
    background: '--lxs-background', foreground: '--lxs-foreground', serverText: 'Spreadsheet consumer cell',
  },
  slide: {
    ui: true,
    uiEntries: { thumbnail: 'thumbnail.ts' },
    skillName: 'likex-slide',
    headlessEntries: { model: 'model-entry.ts', pdf: 'pdf-entry.ts' },
    browserEntries: { render: 'render-entry.ts' },
    headlessDependencies: ['@likex/core'],
    sourceCopyAdapters: { 'core.ts': '../core' },
    declarationBridgeTargets: officeDeclarationBridgeTargets,
    moduleDependencies: ['core'],
    generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-slide', classPrefix: '.lxp-', propertyPrefix: '--lxp-', keyframePrefix: 'lxp',
    requiredClasses: ['.lxp-root', '.lxp-ribbon'],
    background: '--lxp-background', foreground: '--lxp-foreground', serverText: 'LikeSlide consumer',
  },
  document: {
    ui: true,
    uiEntries: { thumbnail: 'thumbnail.ts' },
    skillName: 'likex-document',
    headlessEntries: { model: 'model-entry.ts' },
    headlessDependencies: ['@likex/core', 'prosemirror-model',
      'prosemirror-state', 'prosemirror-transform', 'prosemirror-commands', 'prosemirror-schema-list'],
    sourceCopyAdapters: { 'core.ts': '../core' },
    declarationBridgeTargets: officeDeclarationBridgeTargets,
    modelRuntimeDependencies: ['prosemirror-model', 'prosemirror-state', 'prosemirror-transform', 'prosemirror-schema-list'],
    modelTypeLibraries: ['ES2022', 'DOM'],
    moduleDependencies: ['core'],
    generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-document', classPrefix: '.lxd-', propertyPrefix: '--lxd-', keyframePrefix: 'lxd',
    requiredClasses: ['.lxd-root', '.lxd-ribbon', '.lxd-editor'],
    background: '--lxd-background', foreground: '--lxd-foreground', serverText: 'LikeDocument consumer',
  },
  board: {
    ui: true, skillName: 'likex-board', headlessEntries: { model: 'model-entry.ts' },
    headlessDependencies: ['@likex/core', '@likex/core/json'], modelTypeLibraries: ['ES2022', 'DOM'],
    moduleDependencies: ['core'], generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-board', classPrefix: '.lxb-', propertyPrefix: '--lxb-', keyframePrefix: 'lxb',
    requiredClasses: ['.lxb-root'],
    background: '--lxb-background', foreground: '--lxb-foreground', serverText: 'Board consumer content',
  },
  dataview: {
    ui: true, skillName: 'likex-dataview', headlessEntries: { model: 'model-entry.ts' },
    headlessDependencies: ['@likex/core', '@likex/core/json'], modelTypeLibraries: ['ES2022', 'DOM'],
    moduleDependencies: ['core'], generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-dataview', classPrefix: '.lxv-', propertyPrefix: '--lxv-', keyframePrefix: 'lxv',
    requiredClasses: ['.lxv-root'],
    background: '--lxv-background', foreground: '--lxv-foreground', serverText: 'DataView consumer content',
  },
  diagram: {
    ui: true, skillName: 'likex-diagram', headlessEntries: { model: 'model-entry.ts' },
    headlessDependencies: ['@likex/core', '@likex/core/json'], modelTypeLibraries: ['ES2022', 'DOM'],
    moduleDependencies: ['core'], generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-diagram', classPrefix: '.lxg-', propertyPrefix: '--lxg-', keyframePrefix: 'lxg',
    requiredClasses: ['.lxg-root'],
    background: '--lxg-background', foreground: '--lxg-foreground', serverText: 'LikeDiagram consumer',
  },
  whiteboard: {
    ui: true, skillName: 'likex-whiteboard', headlessEntries: { model: 'model-entry.ts' },
    headlessDependencies: ['@likex/core', '@likex/core/json'], modelTypeLibraries: ['ES2022', 'DOM'],
    moduleDependencies: ['core'], generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-whiteboard', classPrefix: '.lxw-', propertyPrefix: '--lxw-', keyframePrefix: 'lxw',
    requiredClasses: ['.lxw-root'],
    background: '--lxw-background', foreground: '--lxw-foreground', serverText: 'LikeWhiteboard consumer',
  },
  calendar: {
    ui: true, skillName: 'likex-calendar', headlessEntries: { model: 'model-entry.ts' },
    headlessDependencies: ['@likex/core', '@likex/core/json'], modelTypeLibraries: ['ES2022', 'DOM'],
    moduleDependencies: ['core'], generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-calendar', classPrefix: '.lxc-', propertyPrefix: '--lxc-', keyframePrefix: 'lxc',
    requiredClasses: ['.lxc-root'],
    background: '--lxc-bg', foreground: '--lxc-text', serverText: 'LikeCalendar consumer',
  },
  aichat: {
    ui: true, skillName: 'likex-aichat', headlessEntries: { model: 'model-entry.ts' },
    headlessDependencies: ['@likex/core', '@likex/core/json'], modelTypeLibraries: ['ES2022', 'DOM'],
    moduleDependencies: ['core'], generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-aichat', classPrefix: '.lxai-', propertyPrefix: '--lxai-', keyframePrefix: 'lxai',
    requiredClasses: ['.lxai-root'],
    background: '--lxai-bg', foreground: '--lxai-fg', serverText: 'LikeAIChat consumer',
  },
  chat: {
    ui: true, skillName: 'likex-chat', headlessEntries: { model: 'model-entry.ts' },
    headlessDependencies: ['@likex/core', '@likex/core/json'], modelTypeLibraries: ['ES2022', 'DOM'],
    moduleDependencies: ['core'], generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-chat', classPrefix: '.lxh-', propertyPrefix: '--lxh-', keyframePrefix: 'lxh',
    requiredClasses: ['.lxh-root'],
    background: '--lxh-bg', foreground: '--lxh-fg', serverText: 'LikeChat consumer',
  },
  form: {
    ui: true, skillName: 'likex-form', headlessEntries: { model: 'model-entry.ts' },
    headlessDependencies: ['@likex/core', '@likex/core/json'], modelTypeLibraries: ['ES2022', 'DOM'],
    moduleDependencies: ['core'], generatedStyles: false, bundledDependencies: [],
    marker: 'data-likex-form', classPrefix: '.lxf-', propertyPrefix: '--lxf-', keyframePrefix: 'lxf',
    requiredClasses: ['.lxf-root'],
    background: '--lxf-background', foreground: '--lxf-foreground', serverText: 'LikeForm consumer',
  },
};
export const moduleNames = Object.freeze(Object.keys(modules));

export function libraryModule(name = 'explorer') {
  assert.ok(Object.hasOwn(modules, name), `Unknown library module: ${name}`);
  const packageRoot = path.join(projectRoot, 'packages', name);
  return { sourceCopyAdapters: modules[name].ui ? coreSourceCopyAdapters : {}, ...modules[name], name, packageRoot, sourceRoot: path.join(packageRoot, 'src'),
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
