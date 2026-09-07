import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { buildLibrary } from './build-library.mjs';
import { artifactRoot, packageRoot, runNpm } from './lib/run.mjs';

await buildLibrary();
const output = await runNpm(['pack', packageRoot, '--json', '--ignore-scripts', '--pack-destination', artifactRoot,
  '--cache', path.join(artifactRoot, 'npm-cache')], { capture: true });
const [packed] = JSON.parse(output);
const allowed = /^(package\.json|README\.md|src\/README\.md|THIRD_PARTY_NOTICES\.md|LICENSE|dist\/.+)$/;
for (const file of packed.files) if (!allowed.test(file.path)) throw new Error(`Unexpected packed file: ${file.path}`);
await writeFile(path.join(artifactRoot, 'library-pack.json'), JSON.stringify(packed, null, 2) + '\n');
console.log(`Packed ${packed.filename}: ${packed.entryCount} files, ${packed.size} bytes (${packed.unpackedSize} unpacked)`);
