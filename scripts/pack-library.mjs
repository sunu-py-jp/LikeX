import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { buildLibrary } from './build-library.mjs';
import { runNpm } from './lib/run.mjs';
import { dependencyOrder, libraryModule, requestedModules } from './lib/modules.mjs';
import { allowedPackageFile } from './lib/package-files.mjs';

const requested = requestedModules();
if (requested.some(module => libraryModule(module).skillName)) await runNpm(['run', 'check:skills']);
for (const moduleName of dependencyOrder(requested)) {
  const { artifactRoot, packageRoot, npmCacheRoot } = libraryModule(moduleName);
  await buildLibrary({ module: moduleName });
  const output = await runNpm(['pack', packageRoot, '--json', '--ignore-scripts', '--pack-destination', artifactRoot,
    '--cache', npmCacheRoot], { capture: true });
  const [packed] = JSON.parse(output);
  for (const file of packed.files) if (!allowedPackageFile(file.path, moduleName)) throw new Error(`Unexpected packed file: ${file.path}`);
  await writeFile(path.join(artifactRoot, 'library-pack.json'), JSON.stringify(packed, null, 2) + '\n');
  console.log(`Packed ${packed.filename}: ${packed.entryCount} files, ${packed.size} bytes (${packed.unpackedSize} unpacked)`);
}
