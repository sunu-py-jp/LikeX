import { build } from 'esbuild';
import ts from 'typescript';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { projectRoot } from './lib/run.mjs';
import { installedPackage } from './lib/packages.mjs';
import { assertSourceBoundary } from './lib/source-boundary.mjs';
import { dependencyOrder, libraryModule, requestedModules } from './lib/modules.mjs';

async function declarationFiles(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await declarationFiles(file));
    else if (file.endsWith('.d.ts')) files.push(file);
  }
  return files;
}

export async function buildLibrary({ module = 'explorer' } = {}) {
  const profile = libraryModule(module);
  const { artifactRoot, packageRoot, sourceRoot } = profile;
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  await assertSourceBoundary(sourceRoot, manifest);
  const licensePath = path.join(packageRoot, 'LICENSE');
  if (!manifest.private && (manifest.license === 'UNLICENSED' || !existsSync(licensePath)))
    throw new Error(`Choose the distribution license and add packages/${module}/LICENSE before enabling public publishing.`);
  const css = !profile.ui ? '' : profile.generatedStyles
    ? (await (await import('./build-styles.mjs')).buildStyles()).css
    : await readFile(path.join(sourceRoot, 'styles.css'), 'utf8');
  // The package directory contains maintained source/docs: replace only dist.
  await rm(path.join(packageRoot, 'dist'), { recursive: true, force: true });
  await mkdir(path.join(packageRoot, 'dist'), { recursive: true });
  if (profile.ui) await writeFile(path.join(packageRoot, 'dist/styles.css'), css);
  await mkdir(artifactRoot, { recursive: true });
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(sourceRoot, 'index.ts')],
    outfile: path.join(packageRoot, 'dist/index.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    packages: 'external', jsx: 'automatic', metafile: true,
    sourcemap: true, sourcesContent: true, minify: false,
    // The source entry begins with "use client"; esbuild preserves that boundary.
    legalComments: 'eof',
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!path.resolve(projectRoot, input).startsWith(sourceRoot + path.sep))
      throw new Error(`Library imports a file outside packages/${module}/src: ${input}`);
  }
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
  for (const output of Object.values(result.metafile.outputs)) for (const imported of output.imports) {
    if (!imported.external) continue;
    const parts = imported.path.split('/');
    const dependency = imported.path.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    if (!declared.has(dependency)) throw new Error(`Undeclared runtime dependency: ${imported.path}`);
  }
  const javascript = await readFile(path.join(packageRoot, 'dist/index.js'), 'utf8');
  if (profile.ui && !/^['"]use client['"];/.test(javascript)) throw new Error('The distributed entry lost its use client directive.');
  if (!profile.ui && /^['"]use client['"];/.test(javascript)) throw new Error('The core entry must remain usable outside React clients.');

  const declarationRoot = path.join(packageRoot, 'dist/types');
  const program = ts.createProgram([path.join(sourceRoot, 'index.ts')], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, esModuleInterop: true,
    declaration: true, emitDeclarationOnly: true, noEmitOnError: true,
    rootDir: sourceRoot, outDir: declarationRoot, types: profile.ui ? ['react', 'react-dom'] : [],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => projectRoot, getCanonicalFileName: name => name, getNewLine: () => '\n',
  }));
  const emitted = program.emit();
  if (emitted.emitSkipped) throw new Error('Type declaration generation failed.');
  // ESM .js specifiers resolve to .d.ts in both bundler and NodeNext consumers.
  for (const file of await declarationFiles(declarationRoot)) {
    const contents = await readFile(file, 'utf8');
    await writeFile(file, contents.replace(/((?:from\s+|import\s*\()\s*["'])(\.[^"']+)(["'])/g, (match, before, specifier, after) => {
      const target = path.resolve(path.dirname(file), specifier);
      if (existsSync(`${target}.d.ts`)) return `${before}${specifier}.js${after}`;
      if (existsSync(path.join(target, 'index.d.ts'))) return `${before}${specifier}/index.js${after}`;
      if (specifier.endsWith('.js')) return match;
      throw new Error(`Unresolved declaration import ${specifier} in ${file}`);
    }));
  }
  const notices = ['# Third-party dependencies', '',
    'Runtime dependencies are external imports. Their own distributions carry notices for transitive dependencies.', ''];
  if (profile.generatedStyles) notices.push('The distributed styles.css includes compiled Tailwind CSS utilities and Preflight. Its MIT license is also retained in styles.css for source-copy consumers.', '');
  for (const name of [...new Set([...declared, ...profile.bundledDependencies])].sort()) {
    const { directory: root, manifest: metadata } = await installedPackage(name);
    notices.push(`## ${name} ${metadata.version}`, '',
      profile.bundledDependencies.includes(name) ? 'Bundled CSS generated at build time; consumers do not install its compiler.' : 'External runtime dependency.', '',
      `Declared license: ${metadata.license}`, '');
    for (const file of await readdir(root, { withFileTypes: true })) {
      if (file.isFile() && /^(licen[sc]e|notice|copyright)([.-]|$)/i.test(file.name))
        notices.push(await readFile(path.join(root, file.name), 'utf8'), '');
    }
  }
  await writeFile(path.join(packageRoot, 'THIRD_PARTY_NOTICES.md'), notices.join('\n'));
  const report = { name: manifest.name, version: manifest.version, javascriptBytes: Buffer.byteLength(javascript),
    gzipBytes: gzipSync(javascript).length, declarationFiles: (await declarationFiles(declarationRoot)).length,
    stylesheetBytes: Buffer.byteLength(css), stylesheetGzipBytes: profile.ui ? gzipSync(css).length : 0,
    publishBlocked: manifest.private === true, license: manifest.license, dependencies: [...declared].sort(),
    sourceFiles: Object.keys(result.metafile.inputs).length };
  await writeFile(path.join(artifactRoot, 'library-build.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  for (const moduleName of dependencyOrder(requestedModules())) await buildLibrary({ module: moduleName });
