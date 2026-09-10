import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, runNpm } from './lib/run.mjs';
import { dependencyOrder, libraryModule, requestedModules } from './lib/modules.mjs';
import { consumerDevDependencies, consumerDependencies, copyConsumerFixtures,
  checkConsumerTypes, checkConsumerStyles, checkConsumerNext } from './lib/consumer.mjs';
import { checkSpreadsheetModelConsumer } from './lib/spreadsheet-model-consumer.mjs';

async function testConsumer(module) {
  const { artifactRoot, packageRoot, npmCacheRoot, ui } = libraryModule(module);
  const consumer = path.join(artifactRoot, 'package-consumer');
  const withNext = ui && process.argv.includes('--next');
  const online = process.argv.includes('--online');
  const packed = JSON.parse(await readFile(path.join(artifactRoot, 'library-pack.json'), 'utf8'));
  const packageName = packed.name;
  assert.ok(typeof packageName === 'string' && packageName.length <= 214 &&
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName), 'Invalid packed npm package name');
  const installed = path.join(consumer, 'node_modules', ...packageName.split('/'));
  assert.equal(path.basename(packed.filename), packed.filename, 'tarball filename must stay inside artifacts');
  const tarball = path.join(artifactRoot, packed.filename);
  const bytes = await readFile(tarball);
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, packed.integrity);
  const archiveFiles = (await run('tar', ['-tzf', tarball], { capture: true })).trim().split('\n');
  for (const file of archiveFiles) {
    assert.ok(file.startsWith('package/') && !file.includes('\\') && !file.split('/').includes('..'), `Unsafe packed path: ${file}`);
    assert.match(file, /^package\/(?:(?:package\.json|README\.md|src\/README\.md|src\/docs\/[^/]+\.md|THIRD_PARTY_NOTICES\.md|LICENSE)$|dist(?:\/|$))/);
  }
  const dependenciesToInstall = [];
  for (const dependencyName of dependencyOrder([module]).filter(name => name !== module)) {
    const dependency = libraryModule(dependencyName);
    const metadata = JSON.parse(await readFile(path.join(dependency.artifactRoot, 'library-pack.json'), 'utf8'));
    assert.equal(path.basename(metadata.filename), metadata.filename, 'Dependency tarball filename must stay inside artifacts');
    const dependencyTarball = path.join(dependency.artifactRoot, metadata.filename);
    assert.equal(`sha512-${createHash('sha512').update(await readFile(dependencyTarball)).digest('base64')}`, metadata.integrity);
    const files = (await run('tar', ['-tzf', dependencyTarball], { capture: true })).trim().split('\n');
    for (const file of files) assert.ok(file.startsWith('package/') && !file.includes('\\') && !file.split('/').includes('..'), `Unsafe dependency path: ${file}`);
    const dependencyManifest = JSON.parse(await run('tar', ['-xOzf', dependencyTarball, 'package/package.json'], { capture: true }));
    assert.equal(dependencyManifest.name, `@likex/${dependencyName}`);
    dependenciesToInstall.push({ name: dependencyManifest.name, tarball: dependencyTarball,
      installed: path.join(consumer, 'node_modules', ...dependencyManifest.name.split('/')) });
  }

  // Check the packaged documents, not the checkout: relative links must still
  // work after installation. Code examples are not document navigation links.
  const documentFiles = archiveFiles.filter(file => /^package\/(?:README\.md|src\/README\.md|src\/docs\/[^/]+\.md)$/.test(file));
  const documents = await Promise.all(documentFiles.map(async file => ({ file,
    markdown: await run('tar', ['-xOzf', tarball, file], { capture: true }),
  })));
  const archived = new Set(archiveFiles);
  let documentationLinks = 0;
  for (const { file, markdown } of documents) {
    const prose = markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '').replace(/`[^`\n]*`/g, '');
    const links = [...prose.matchAll(/\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g),
      ...prose.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm)];
    for (const match of links) {
      const href = match[1] ?? match[2];
      if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) continue;
      const pathname = decodeURIComponent(href.split(/[?#]/, 1)[0]);
      if (!pathname) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), pathname)).replace(/\/$/, '');
      assert.ok(target === 'package' || target.startsWith('package/'), `Documentation link leaves the package: ${file}: ${href}`);
      assert.ok(archived.has(target) || archiveFiles.some(item => item.startsWith(target + '/')),
        `Documentation link is missing from the tarball: ${file}: ${href}`);
      documentationLinks++;
    }
  }

  await rm(consumer, { recursive: true, force: true });
  await mkdir(consumer, { recursive: true });
  const consumerManifest = { name: 'likex-packed-consumer', private: true, type: 'module',
    devDependencies: await consumerDevDependencies({ ui }) };
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify(consumerManifest, null, 2));
  let installMode = online ? 'npm-online' : 'npm-offline';
  try {
    await runNpm(['install', ...(online ? ['--offline=false', '--prefer-online'] : ['--offline']), '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
      '--cache', npmCacheRoot, ...dependenciesToInstall.map(dependency => dependency.tarball), tarball], { cwd: consumer, capture: true, timeout: online ? 180_000 : 45_000 });
  } catch (error) {
    await writeFile(path.join(artifactRoot, `package-install-${online ? 'online' : 'offline'}.log`), String(error) + '\n');
    if (online) throw error;
    installMode = 'tarball-with-workspace-dependencies';
    await rm(path.join(consumer, 'node_modules'), { recursive: true, force: true });
    await mkdir(path.join(consumer, 'node_modules'), { recursive: true });
    await run('tar', ['-xzf', tarball, '-C', path.join(consumer, 'node_modules')]);
    await mkdir(path.dirname(installed), { recursive: true });
    await rename(path.join(consumer, 'node_modules/package'), installed);
    for (const dependency of dependenciesToInstall) {
      await run('tar', ['-xzf', dependency.tarball, '-C', path.join(consumer, 'node_modules')]);
      await mkdir(path.dirname(dependency.installed), { recursive: true });
      await rename(path.join(consumer, 'node_modules/package'), dependency.installed);
    }
  }
  const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.name, packed.name);
  const declared = { ...manifest.dependencies, ...manifest.peerDependencies };
  for (const dependency of Object.keys(declared)) {
    assert.ok(!/(?:^next$|vinext|vite|wrangler|cloudflare|drizzle|worker)/i.test(dependency), `Demo-only dependency leaked: ${dependency}`);
    assert.ok(!/^(?:tailwindcss|postcss|@tailwindcss\/)/.test(dependency), `A CSS build dependency leaked into the runtime package: ${dependency}`);
  }
  if (ui) {
    assert.equal(manifest.exports['./styles.css'], './dist/styles.css');
    assert.ok(Array.isArray(manifest.sideEffects) && manifest.sideEffects.includes('**/*.css'), 'Bundlers must retain imported styles');
  } else {
    assert.equal(manifest.exports['./styles.css'], undefined);
    assert.equal(manifest.sideEffects, false);
    assert.deepEqual(declared, {}, 'Core must not require React or any other runtime dependency');
  }
  const { linkedDependencies, testedVersions, dependencyLocations } = await consumerDependencies(consumer, declared, {
    fallback: installMode === 'tarball-with-workspace-dependencies', online, ui,
  });
  // Verify that the runtime came from this exact tarball, not a source checkout.
  const main = path.join(installed, manifest.main);
  const javascript = await readFile(main, 'utf8');
  const packedMain = await run('tar', ['-xOzf', tarball, `package/${manifest.main.replace(/^\.\//, '')}`], { capture: true });
  assert.equal(javascript, packedMain);
  for (const dependency of dependenciesToInstall) {
    const dependencyManifest = JSON.parse(await readFile(path.join(dependency.installed, 'package.json'), 'utf8'));
    assert.equal(await readFile(path.join(dependency.installed, dependencyManifest.main), 'utf8'),
      await run('tar', ['-xOzf', dependency.tarball, `package/${dependencyManifest.main.replace(/^\.\//, '')}`], { capture: true }),
      'Runtime dependencies must also come from the corresponding tarball');
  }
  if (ui) assert.match(javascript, /^['"]use client['"];/);
  else assert.doesNotMatch(javascript, /^['"]use client['"];/);
  assert.doesNotMatch(javascript, /from\s*["'](?:next(?:\/|["'])|vinext|wrangler|@cloudflare|drizzle-orm)/);

  await copyConsumerFixtures(consumer, { module, packageName });
  const tsconfig = await checkConsumerTypes(consumer, { module });
  const ssr = JSON.parse((await run(process.execPath, ['ssr.mjs'], { cwd: consumer, capture: true })).trim());
  assert.equal(fileURLToPath(ssr.resolved), main);
  const cssFile = path.join(installed, 'dist/styles.css');
  if (ui) assert.equal(await readFile(cssFile, 'utf8'), await run('tar', ['-xOzf', tarball, 'package/dist/styles.css'], { capture: true }));
  const styles = ui ? await checkConsumerStyles(consumer, { module, cssFile,
    originCss: await readFile(path.join(packageRoot, 'dist/styles.css'), 'utf8'), reportPrefix: 'package-consumer' }) : {};
  const nextStyles = withNext ? await checkConsumerNext(consumer, { module,
    tsconfig, testedVersions, reportPrefix: 'package-consumer', dependencies: { [packageName]: `file:${tarball}` },
  }) : undefined;
  const headlessModel = module === 'spreadsheet' ? await checkSpreadsheetModelConsumer({ installed }) : undefined;
  const report = { packageName, tarball: packed.filename, integrity: packed.integrity, installMode, linkedDependencies, testedVersions, dependencyLocations,
    documentationFiles: documentFiles.length, documentationLinks,
    source: 'unpacked tarball', dependencyTarballs: dependenciesToInstall.map(dependency => dependency.name), networkInstallationTested: online,
    typeResolution: 'NodeNext, strict, skipLibCheck=false', ...(headlessModel ? { headlessModel } : {}),
    ...(ui ? { ssrBytes: ssr.renderedBytes, stylesheetImport: `${packageName}/styles.css` } : { nodeImport: 'passed without React or browser globals' }), ...styles, ...nextStyles,
    nextProductionBuild: !ui ? 'not applicable (headless core)' : withNext ? 'passed (standard Next App Router, webpack, Next default skipLibCheck=true)' : 'not requested; add --next',
  };
  await writeFile(path.join(artifactRoot, 'package-consumer-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));

}

for (const moduleName of requestedModules()) await testConsumer(moduleName);
