import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactRoot, projectRoot } from './lib/run.mjs';
import { libraryModule, moduleNames } from './lib/modules.mjs';
import { assertInventoryRetained, assertNoticesRetained, assertPermissiveLicense,
  collectRuntimeNotices, readPackageNotice } from './lib/licenses.mjs';

const read = file => readFileSync(file, 'utf8');
const json = file => JSON.parse(read(file));
const describe = ({ name, version, license }) => ({ name, version, license });

export function checkLicenses({ artifacts = false } = {}) {
  const report = {
    checkedAt: new Date().toISOString(), status: 'failed', artifactsChecked: artifacts,
    scope: 'LikeX licenses, installed library runtime dependencies and peers, and explicitly bundled CSS dependencies. Development/compiler-only dependencies and their transitive MPL/LGPL licenses are outside this distribution allowlist; this is not an audit of all installed tooling.',
    modules: [],
  };
  try {
    const rootLicense = read(path.join(projectRoot, 'LICENSE'));
    if (!/MIT License/.test(rootLicense) || !rootLicense.includes('Permission is hereby granted, free of charge') || !rootLicense.includes('THE SOFTWARE IS PROVIDED "AS IS"'))
      throw new Error('Root LICENSE must contain the complete MIT license');
    const profiles = moduleNames.map(libraryModule);
    const playgroundRoot = path.join(projectRoot, 'apps/playground');
    for (const directory of [projectRoot, ...profiles.map(profile => profile.packageRoot), playgroundRoot]) {
      const pkg = json(path.join(directory, 'package.json'));
      if (pkg.license !== 'MIT') throw new Error(`${pkg.name} must declare MIT in package.json`);
      if (read(path.join(directory, 'LICENSE')) !== rootLicense) throw new Error(`${pkg.name}/LICENSE does not match the root MIT license`);
      assertPermissiveLicense(readPackageNotice(directory));
    }
    const all = new Map();
    for (const profile of profiles) {
      const entries = collectRuntimeNotices(profile.packageRoot, profile.bundledDependencies);
      for (const entry of entries) all.set(`${entry.name}@${entry.version}`, entry);
      if (read(path.join(profile.sourceRoot, 'LICENSE')) !== rootLicense)
        throw new Error(`${profile.name}/src/LICENSE does not match the root MIT license`);
      const sourceNotices = read(path.join(profile.sourceRoot, 'THIRD_PARTY_NOTICES.md'));
      assertNoticesRetained(sourceNotices, entries, `${profile.name}/src/THIRD_PARTY_NOTICES.md (regenerate with build:library)`);
      report.modules.push({ name: profile.name, packages: entries.map(describe), bundledDependencies: profile.bundledDependencies });
      if (artifacts) {
        const notices = read(path.join(profile.packageRoot, 'THIRD_PARTY_NOTICES.md'));
        assertNoticesRetained(notices, entries, `${profile.name}/THIRD_PARTY_NOTICES.md`);
        if (sourceNotices !== notices)
          throw new Error(`${profile.name} source-copy notices differ from package notices`);
        if (profile.generatedStyles) {
          const css = read(path.join(profile.packageRoot, 'dist/styles.css'));
          for (const dependency of profile.bundledDependencies) {
            const entry = entries.find(item => item.name === dependency);
            for (const notice of entry.notices)
              if (!css.includes(notice.trim())) throw new Error(`${profile.name}/dist/styles.css omits ${dependency} notice text`);
          }
        }
      }
    }
    const bundledNames = [...new Set(profiles.flatMap(profile => profile.bundledDependencies))];
    const playgroundEntries = collectRuntimeNotices(playgroundRoot, bundledNames);
    for (const entry of playgroundEntries) all.set(`${entry.name}@${entry.version}`, entry);
    report.playgroundRuntime = playgroundEntries.map(describe);
    if (artifacts) {
      const dist = path.join(playgroundRoot, 'dist');
      const ownEntry = readPackageNotice(projectRoot);
      const appEntry = readPackageNotice(playgroundRoot);
      report.playgroundBundled = assertInventoryRetained(json(path.join(dist, 'third-party-inventory.json')),
        read(path.join(dist, 'third-party-notices.txt')), [...all.values(), ownEntry, appEntry], bundledNames).map(describe);
      const playgroundNotices = read(path.join(dist, 'third-party-notices.txt'));
      if (!playgroundNotices.includes(rootLicense.trim())) throw new Error('Playground notices omit the LikeX MIT license');
    }
    const runtimeNames = new Set([...all.values()].map(entry => entry.name));
    report.developmentDependenciesOutsideScope = [...new Set([projectRoot, playgroundRoot]
      .flatMap(directory => Object.keys(json(path.join(directory, 'package.json')).devDependencies ?? {})))]
      .filter(name => !runtimeNames.has(name)).sort();
    report.status = 'passed';
    return report;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(path.join(artifactRoot, 'license-check.json'), JSON.stringify(report, null, 2) + '\n');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const unknown = process.argv.slice(2).filter(arg => arg !== '--artifacts');
  if (unknown.length) throw new Error(`Unknown license-check arguments: ${unknown.join(', ')}`);
  const report = checkLicenses({ artifacts: process.argv.includes('--artifacts') });
  console.log(`License check passed for ${report.modules.length} libraries${report.artifactsChecked ? ' and generated distribution notices' : ''}.`);
  console.log(report.scope);
}
