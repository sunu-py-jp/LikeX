import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactRoot, packageRoot, sourceRoot, run, runNpm } from './lib/run.mjs';
import { assertSourceBoundary } from './lib/source-boundary.mjs';
import { consumerDevDependencies, consumerDependencies, copyConsumerFixtures,
  checkConsumerTypes, checkConsumerStyles, checkConsumerNext } from './lib/consumer.mjs';

const withNext = process.argv.includes('--next');
const online = process.argv.includes('--online');
const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
await mkdir(artifactRoot, { recursive: true });
// Outside the repository: module resolution cannot silently find its workspace
// package or tsconfig. Only the copied directory and declared dependencies exist.
const consumer = await realpath(await mkdtemp(path.join(tmpdir(), 'likex-copy-consumer-')));
const copiedSource = path.join(consumer, 'components/explorer');
let passed = false;
try {
  await cp(sourceRoot, copiedSource, { recursive: true });
  const copiedSourceFiles = await assertSourceBoundary(copiedSource, manifest);
  assert.match(await readFile(path.join(copiedSource, 'index.ts'), 'utf8'), /^['"]use client['"];/);
  const declared = { ...manifest.dependencies, ...manifest.peerDependencies };
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'likex-source-copy-consumer', private: true, type: 'module',
    dependencies: declared, devDependencies: await consumerDevDependencies(),
  }, null, 2));
  let installMode = online ? 'npm-online' : 'npm-offline';
  try {
    await runNpm(['install', ...(online ? ['--offline=false', '--prefer-online'] : ['--offline']),
      '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', path.join(artifactRoot, 'npm-cache')],
    { cwd: consumer, capture: true, timeout: online ? 180_000 : 45_000 });
  } catch (error) {
    await writeFile(path.join(artifactRoot, `copy-install-${online ? 'online' : 'offline'}.log`), String(error) + '\n');
    if (online) throw error;
    installMode = 'copied-source-with-workspace-dependencies';
    await rm(path.join(consumer, 'node_modules'), { recursive: true, force: true });
  }
  const { linkedDependencies, testedVersions, dependencyLocations } = await consumerDependencies(consumer, declared, {
    fallback: installMode === 'copied-source-with-workspace-dependencies', online,
  });
  const consumerRequire = createRequire(path.join(consumer, 'package.json'));
  assert.throws(() => consumerRequire.resolve(manifest.name), { code: 'MODULE_NOT_FOUND' },
    'Source-copy consumer must not resolve the LikeX npm package');
  await copyConsumerFixtures(consumer, { sourceDirectory: copiedSource });
  const tsconfig = await checkConsumerTypes(consumer, { source: true });
  // Bundle only the copied TS/TSX for Node SSR; keep the consumer's actual React
  // dependencies external. No workspace source or library artifact is an input.
  const ssrEntry = path.join(consumer, 'ssr.mjs');
  const bundle = await build({ absWorkingDir: consumer, entryPoints: [ssrEntry],
    outfile: path.join(consumer, 'ssr-bundled.mjs'), bundle: true, format: 'esm', platform: 'node',
    target: 'es2022', jsx: 'automatic', packages: 'external', metafile: true, logLevel: 'silent' });
  for (const input of Object.keys(bundle.metafile.inputs)) {
    const filename = path.resolve(consumer, input);
    assert.ok(filename === ssrEntry || filename.startsWith(copiedSource + path.sep), `SSR bundled source outside the copied directory: ${input}`);
  }
  const ssr = JSON.parse((await run(process.execPath, ['ssr-bundled.mjs'], { cwd: consumer, capture: true })).trim());
  assert.equal(fileURLToPath(ssr.resolved), path.join(copiedSource, 'index.ts'));
  const styles = await checkConsumerStyles(consumer, { cssFile: path.join(copiedSource, 'styles.css'),
    originCss: await readFile(path.join(sourceRoot, 'styles.css'), 'utf8'), reportPrefix: 'copy-consumer' });
  const nextStyles = withNext ? await checkConsumerNext(consumer, { tsconfig, testedVersions, reportPrefix: 'copy-consumer' }) : undefined;
  const report = {
    source: 'packages/explorer/src copied unchanged to components/explorer in a temporary project outside the repository',
    copiedSourceFiles, packageImportAvailable: false, installMode, linkedDependencies, testedVersions, dependencyLocations,
    networkInstallationTested: online, typeResolution: 'Bundler, strict, skipLibCheck=false; no aliases',
    ssrBytes: ssr.renderedBytes, stylesheetImport: 'components/explorer/styles.css', ...styles, ...nextStyles,
    nextProductionBuild: withNext ? 'passed (standard Next App Router, webpack, Next default skipLibCheck=true)' : 'not requested; add --next',
  };
  await writeFile(path.join(artifactRoot, 'copy-consumer-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  passed = true;
} finally {
  if (passed) await rm(consumer, { recursive: true, force: true });
  else console.error(`Failed source-copy consumer retained for inspection: ${consumer}`);
}
