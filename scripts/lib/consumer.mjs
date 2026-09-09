import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import { projectRoot, run } from './run.mjs';
import { installedPackage } from './packages.mjs';
import { libraryModule } from './modules.mjs';

// The host uses standard Next CSS support. Tailwind and PostCSS plugins belong
// only to the library build, never to either consumer's setup.
export const development = ['next', 'typescript', '@types/node', '@types/react', '@types/react-dom'];

export async function consumerDevDependencies({ ui = true } = {}) {
  const workspace = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const dependencies = {};
  for (const name of ui ? development : ['typescript']) {
    dependencies[name] = workspace.dependencies?.[name] ?? workspace.devDependencies?.[name] ?? (await installedPackage(name)).manifest.version;
  }
  return dependencies;
}

/** Keep the offline fallback explicit; a real installation must be independent. */
export async function consumerDependencies(consumer, declared, { fallback, online, ui = true }) {
  const dependencies = new Set([...Object.keys(declared), ...(ui ? development : ['typescript'])]);
  const linkedDependencies = [];
  const testedVersions = {};
  const dependencyLocations = {};
  for (const dependency of dependencies) {
    const directory = path.join(consumer, 'node_modules', dependency);
    if (!existsSync(directory)) {
      assert.ok(fallback, `The consumer install did not provide ${dependency}; partial workspace fallback is disabled`);
      const { directory: source } = await installedPackage(dependency);
      await mkdir(path.dirname(directory), { recursive: true });
      await symlink(source, directory, 'dir');
      linkedDependencies.push(dependency);
    }
    dependencyLocations[dependency] = await realpath(directory);
    if (online) assert.ok(dependencyLocations[dependency].startsWith(path.join(consumer, 'node_modules') + path.sep),
      `Online consumer unexpectedly shares the workspace dependency: ${dependency}`);
    testedVersions[dependency] = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).version;
  }
  return { linkedDependencies, testedVersions, dependencyLocations };
}

/** One fixture exercises the same public API from the tarball and copied source. */
export async function copyConsumerFixtures(consumer, { module = 'explorer', packageName, sourceDirectory }) {
  const fixtures = path.join(libraryModule(module).packageRoot, 'tests/fixtures/package-consumer');
  async function copy(source, target) {
    await mkdir(target, { recursive: true });
    for (const item of await readdir(source, { withFileTypes: true })) {
      const destination = path.join(target, item.name.replace(/\.template$/, ''));
      if (item.isDirectory()) { await copy(path.join(source, item.name), destination); continue; }
      let imported = packageName;
      if (sourceDirectory) {
        imported = path.relative(path.dirname(destination), sourceDirectory).split(path.sep).join('/');
        if (!imported.startsWith('.')) imported = `./${imported}`;
      }
      const contents = (await readFile(path.join(source, item.name), 'utf8'))
        .replaceAll('__LIBRARY_IMPORT__', imported)
        .replaceAll('__LIBRARY_RESOLVE__', sourceDirectory ? `${imported}/index.ts` : packageName)
        .replaceAll('__LIBRARY_STYLES__', `${imported}/styles.css`)
        .replaceAll('__EXPLORER_IMPORT__', imported)
        .replaceAll('__EXPLORER_RESOLVE__', sourceDirectory ? `${imported}/index.ts` : packageName)
        .replaceAll('__EXPLORER_STYLES__', `${imported}/styles.css`);
      assert.doesNotMatch(contents, /__(?:EXPLORER|LIBRARY)_\w+__/, `Unresolved fixture placeholder in ${destination}`);
      await writeFile(destination, contents);
    }
  }
  await copy(fixtures, consumer);
}

export async function checkConsumerTypes(consumer, { source = false, module = 'explorer' } = {}) {
  const { ui } = libraryModule(module);
  const tsconfig = { compilerOptions: {
    target: 'ES2022', lib: ['DOM', 'DOM.Iterable', 'ES2022'],
    module: source ? 'ESNext' : 'NodeNext', moduleResolution: source ? 'Bundler' : 'NodeNext',
    jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: false, esModuleInterop: true, types: ui ? ['node', 'react'] : [],
  }, include: ['types.tsx', 'app/client.tsx', ...(source ? [`components/${module}/**/*.ts`, `components/${module}/**/*.tsx`] : [])] };
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  await run(process.execPath, [path.join(consumer, 'node_modules/typescript/bin/tsc'), '--project', path.join(consumer, 'tsconfig.json')], { cwd: consumer, capture: true });
  return tsconfig;
}

function selectorBranches(selector) {
  const branches = [];
  let start = 0, depth = 0, quote = null;
  for (let index = 0; index < selector.length; index++) {
    const character = selector[index];
    if (character === '\\') { index++; continue; }
    if (quote) { if (character === quote) quote = null; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if ('(['.includes(character)) depth++;
    else if (')]'.includes(character)) depth--;
    else if (character === ',' && depth === 0) { branches.push(selector.slice(start, index).trim()); start = index + 1; }
  }
  branches.push(selector.slice(start).trim());
  return branches;
}

/** Parse with the repository's verification tool only; the consumer never runs
 * Tailwind or a PostCSS plugin to produce component styles. */
export async function checkConsumerStyles(consumer, { cssFile, originCss, reportPrefix, module = 'explorer' }) {
  const profile = libraryModule(module);
  const { artifactRoot } = profile;
  const manifest = JSON.parse(await readFile(path.join(consumer, 'package.json'), 'utf8'));
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
    assert.ok(!/^(?:tailwindcss|postcss|@tailwindcss\/)/.test(name), `Consumer requires a CSS build dependency: ${name}`);
  assert.ok(!existsSync(path.join(consumer, 'postcss.config.mjs')), 'The host must not configure a PostCSS plugin');
  assert.ok(!existsSync(path.join(consumer, 'node_modules/tailwindcss')), 'The consumer installed Tailwind unnecessarily');
  assert.ok(!existsSync(path.join(consumer, 'node_modules/@tailwindcss/postcss')), 'The consumer installed the Tailwind PostCSS plugin unnecessarily');
  const css = await readFile(cssFile, 'utf8');
  assert.equal(css, originCss, 'The consumer stylesheet must be identical to the generated distribution source');
  const parsed = postcss.parse(css, { from: cssFile });
  const selectors = [], declarations = [];
  parsed.walkAtRules(rule => {
    assert.ok(!['import', 'tailwind', 'source', 'apply', 'reference'].includes(rule.name), `Styles require an unresolved build directive: @${rule.name}`);
    if (rule.name === 'property') assert.ok(rule.params.startsWith(profile.propertyPrefix), `A registered CSS property is not namespaced: ${rule.params}`);
    if (rule.name.endsWith('keyframes')) assert.ok(rule.params.startsWith(profile.keyframePrefix + '-') || rule.params.startsWith(profile.keyframePrefix + '_'), `A keyframe is not namespaced: ${rule.params}`);
  });
  parsed.walkRules(rule => {
    const ancestors = [];
    for (let parent = rule.parent; parent; parent = parent.parent) ancestors.push(parent);
    if (ancestors.some(parent => parent.type === 'atrule' && parent.name.endsWith('keyframes'))) return;
    selectors.push(rule.selector);
    // Nested selectors inherit their containing rule's already-checked scope.
    if (ancestors.some(parent => parent.type === 'rule')) return;
    for (const selector of selectorBranches(rule.selector)) assert.ok(
      selector.includes(`[${profile.marker}`) || selector.includes(profile.classPrefix),
      `A selector escapes the ${module} scope: ${selector}`,
    );
  });
  parsed.walkDecls(declaration => { declarations.push([declaration.prop, declaration.value]); });
  for (const selector of profile.requiredClasses)
    assert.ok(selectors.some(value => value.includes(selector)), `Missing ${module} stylesheet class: ${selector}`);
  assert.ok(selectors.some(selector => selector.includes(`[${profile.marker}`)), 'The stylesheet has no scoped foundation');
  assert.ok(declarations.some(([name, value]) => /^background(?:-color)?$/.test(name) && value.includes(`var(${profile.background})`)));
  assert.ok(declarations.some(([name, value]) => name === 'color' && value.includes(`var(${profile.foreground})`)));
  assert.doesNotMatch(css, /--tw-/, 'Tailwind internal properties must not collide with the host');
  await writeFile(path.join(artifactRoot, `${reportPrefix}.css`), css);
  return { stylesheetBytes: Buffer.byteLength(css), stylesheetSha256: createHash('sha256').update(css).digest('hex'),
    cssBuildRequired: false, scopedStylesheet: true };
}

export async function checkConsumerNext(consumer, { tsconfig, testedVersions, reportPrefix, dependencies = {}, module = 'explorer' }) {
  const profile = libraryModule(module);
  const { artifactRoot } = profile;
  // Run the standard App Router build from the consumer's own toolchain.
  Object.assign(tsconfig.compilerOptions, {
    module: 'ESNext', moduleResolution: 'Bundler', lib: ['DOM', 'DOM.Iterable', 'ESNext'],
    // Strict types were already checked above. Next's declarations require newer
    // URLPattern globals than our supported TS 5.9 / @types/node 22 provide.
    skipLibCheck: true, plugins: [{ name: 'next' }],
  });
  tsconfig.include = ['next-env.d.ts', 'types.tsx', 'app/**/*.tsx', 'components/**/*.ts', 'components/**/*.tsx', '.next/types/**/*.ts'];
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  const manifest = JSON.parse(await readFile(path.join(consumer, 'package.json'), 'utf8'));
  const devDependencies = { ...manifest.devDependencies,
    typescript: testedVersions.typescript, '@types/react': testedVersions['@types/react'], '@types/node': testedVersions['@types/node'] };
  delete devDependencies.next;
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ ...manifest,
    dependencies: { ...manifest.dependencies, ...dependencies, next: testedVersions.next,
      react: testedVersions.react, 'react-dom': testedVersions['react-dom'] }, devDependencies }, null, 2));
  const nextLog = path.join(artifactRoot, `${reportPrefix}-next.log`);
  try {
    const log = await run(process.execPath, [path.join(consumer, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
      cwd: consumer, capture: true, timeout: 180_000, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
    await writeFile(nextLog, log);
  } catch (error) { await writeFile(nextLog, String(error) + '\n'); throw error; }
  assert.ok(existsSync(path.join(consumer, '.next/BUILD_ID')));
  const html = await readFile(path.join(consumer, '.next/server/app/index.html'), 'utf8');
  assert.ok(html.includes(profile.serverText), `Server-imported ${module} content was not rendered`);
  const stylesheets = [...new Set([...html.matchAll(/href="(\/_next\/static\/css\/[^"?]+\.css)(?:\?[^\"]*)?"/g)].map(match => match[1]))];
  assert.ok(stylesheets.length, 'The production page does not load any stylesheet');
  const emittedCss = (await Promise.all(stylesheets.map(url => readFile(path.join(consumer, '.next', url.slice('/_next/'.length)), 'utf8')))).join('\n');
  assert.ok(emittedCss.includes(profile.requiredClasses[0]), 'The production CSS lost the component classes');
  assert.ok(emittedCss.includes(profile.marker), 'The production CSS lost the component foundation');
  assert.ok(emittedCss.includes(profile.background), 'The production CSS lost the component theme');
  return { loadedStylesheets: stylesheets.length, productionCssBytes: Buffer.byteLength(emittedCss) };
}
