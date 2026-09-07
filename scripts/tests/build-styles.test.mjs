import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import tailwind from '@tailwindcss/postcss';
import { buildStyles } from '../build-styles.mjs';
import { explorerMarker, scopeExplorerStyles } from '../lib/explorer-styles.mjs';
import { packageRoot, sourceRoot } from '../lib/run.mjs';

const marker = explorerMarker;
const native = await postcss([tailwind({ base: packageRoot, optimize: false })]).process(`
  @import "tailwindcss" prefix(lxe) source(none);
  @source inline("lxe:flex lxe:h-8 lxe:p-2 lxe:border lxe:animate-spin lxe:before:content-['copy'] lxe:group-hover:bg-black lxe:focus-visible:outline-none lxe:[&>svg]:size-4 lxe:[&+button]:m-0");
`, { from: path.join(packageRoot, 'styles/test-input.css'), map: false });
const css = scopeExplorerStyles(native.css);
const stylesheet = postcss.parse(css);
const rules = [];
stylesheet.walkRules(rule => { rules.push(rule); });

test('native prefixed utilities compile into scoped CSS without consumer build directives or layers', () => {
  assert.match(css, /\.lxe\\:flex/);
  assert.match(css, /\.lxe\\:h-8/);
  assert.doesNotMatch(css, /@(?:import|source|tailwind|theme|layer)\b/);
  for (const rule of rules) {
    if (rule.parent.type === 'atrule' && rule.parent.name === 'keyframes') continue;
    // Every nested variant is guarded as well: a root's sibling selector must
    // never style a host element outside an Explorer marker.
    selectorParser().astSync(rule.selector).each(selector => {
      assert.ok(selector.toString().includes(marker), `Unscoped selector: ${selector}`);
    });
  }
});

test('Preflight includes the root, descendants, and pseudo-elements at utility-compatible specificity', () => {
  const boxSizing = rules.find(rule => rule.nodes.some(node => node.type === 'decl' && node.prop === 'box-sizing'));
  assert.ok(boxSizing.selector.includes(`:is(${marker}, ${marker} *)`));
  assert.ok(boxSizing.selector.includes(`:is(${marker}, ${marker} *)::before`));
  const controls = rules.find(rule => rule.nodes.some(node => node.type === 'decl' && node.prop === 'font' && node.value === 'inherit'));
  assert.ok(controls.selector.includes(`:where(button):is(${marker}, ${marker} *)`));
  assert.ok(controls.selector.includes(`:where(input):is(${marker}, ${marker} *)`));
  const padding = rules.find(rule => rule.selector.startsWith('.lxe\\:p-2'));
  assert.equal(padding.selector, `.lxe\\:p-2:where(${marker}, ${marker} *)`);
  assert.ok(rules.indexOf(boxSizing) < rules.indexOf(padding), 'Reset must precede utilities with equal specificity.');
  // Tailwind's HTML hidden semantics are intentionally retained; there is no
  // blanket important selector strategy that would block host customization.
  stylesheet.walkDecls(declaration => {
    if (declaration.important) {
      assert.equal(declaration.prop, 'display');
      assert.ok(declaration.parent.selector.includes('[hidden]'));
    }
  });
});

test('document theme is local and nested marker surfaces inherit root typography', () => {
  const theme = rules.find(rule => rule.nodes.some(node => node.type === 'decl' && node.prop === '--lxe-spacing'));
  assert.equal(theme.selector, marker);
  const typography = rules.find(rule => rule.nodes.some(node => node.type === 'decl' && node.prop === 'tab-size'));
  assert.equal(typography.selector, `${marker}:not(:where(${marker} ${marker}))`);
  assert.ok(typography.nodes.some(node => node.type === 'decl' && node.prop === 'font-family'));
  for (const rule of rules) {
    selectorParser().astSync(rule.selector).walk(node => {
      assert.ok(!(node.type === 'tag' && node.value === 'html'));
      assert.ok(!(node.type === 'pseudo' && [':root', ':host'].includes(node.value)));
    });
  }
});

test('pseudo-element and sibling variants keep their guard on the target element', () => {
  const before = rules.find(rule => rule.selector.includes('.lxe') && rule.selector.includes('::before'));
  assert.ok(before, 'Expected a generated before variant.');
  assert.ok(before.selector.includes(`:where(${marker}, ${marker} *)::before`));
  assert.doesNotMatch(before.selector, /::before:where/);
  const sibling = rules.find(rule => rule.selector.includes('.lxe') && rule.selector.includes('+button'));
  assert.ok(sibling, 'Expected a generated sibling variant.');
  assert.ok(sibling.selector.endsWith(`button:where(${marker}, ${marker} *)`));
  // Preserve the same invariant if a compiler version leaves CSS nesting intact.
  const nested = scopeExplorerStyles('@layer utilities { .lxe\\:variant { &::before { content: "x"; } &+button { margin: 0; } } }');
  assert.ok(nested.includes(`&:where(${marker}, ${marker} *)::before`));
  assert.ok(nested.includes(`&+button:where(${marker}, ${marker} *)`));
});

test('Tailwind properties and keyframes are private, including animation theme references', () => {
  assert.doesNotMatch(css, /--tw-/);
  assert.match(css, /@property --lxe-tw-/);
  assert.match(css, /@keyframes lxe-spin\b/);
  assert.match(css, /--lxe-animate-spin: lxe-spin 1s linear infinite/);
  assert.match(css, /animation: var\(--lxe-animate-spin\)/);
  assert.ok(rules.some(rule => rule.selector === 'to'), 'Keyframe steps must remain valid unscoped steps.');
});

test('namespacing uses parsed values and leaves unrelated strings untouched', () => {
  const transformed = scopeExplorerStyles(`
    @layer utilities {
      .lxe\\:animate { --tw-translate-x: 2px; transform: translateX(var(--tw-translate-x));
        animation: spin 1s linear infinite; animation-name: spin; content: "spin"; }
    }
    @property --tw-translate-x { syntax: "<length>"; inherits: false; initial-value: 0px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `);
  assert.match(transformed, /@property --lxe-tw-translate-x/);
  assert.match(transformed, /var\(--lxe-tw-translate-x\)/);
  assert.match(transformed, /animation: lxe-spin 1s linear infinite/);
  assert.match(transformed, /animation-name: lxe-spin/);
  assert.match(transformed, /content: "spin"/);
});

test('fallback initialization is moved before utilities when removing native layers', () => {
  const transformed = scopeExplorerStyles(`
    @layer properties;
    @layer utilities { .lxe\\:translate { --tw-translate-x: 2px; } }
    @layer properties { @supports (display: block) { * { --tw-translate-x: 0px; } } }
  `);
  assert.ok(transformed.indexOf('--lxe-tw-translate-x: 0px') < transformed.indexOf('--lxe-tw-translate-x: 2px'));
  assert.doesNotMatch(transformed, /@layer/);
  assert.throws(() => scopeExplorerStyles('button { padding: 0; }'), /known Tailwind layer/);
});

test('the checked-in copy stylesheet is deterministic and unchanged output is not rewritten', async () => {
  const input = await readFile(path.join(packageRoot, 'styles/input.css'), 'utf8');
  assert.match(input, /source\(none\)/);
  assert.match(input, /@source "\.\.\/src\/\*\*\/\*\.ts"/);
  assert.match(input, /@source "\.\.\/src\/\*\*\/\*\.tsx"/);
  assert.doesNotMatch(input, /@source[^;]*(?:README|\.css)/);
  const before = await stat(path.join(sourceRoot, 'styles.css'));
  const generated = await buildStyles({ check: true });
  const repeated = await buildStyles();
  assert.equal(generated.css, repeated.css);
  assert.equal(repeated.changed, false);
  assert.equal((await stat(repeated.outputFile)).mtimeMs, before.mtimeMs);
  assert.match(generated.css, /Copyright \(c\) Tailwind Labs, Inc\./);
  assert.match(generated.css, /Permission is hereby granted, free of charge/);
});
