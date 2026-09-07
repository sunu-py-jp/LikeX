import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read installed metadata even when the package does not export package.json. */
export async function installedPackage(name) {
  let resolved;
  try {
    // Type-only packages such as @types/node do not have a runtime entry.
    resolved = import.meta.resolve(`${name}/package.json`);
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    // Packages with private metadata still expose an entry we can walk up from.
    resolved = import.meta.resolve(name);
  }
  let directory = path.dirname(fileURLToPath(resolved));
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return { directory, manifest };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot find installed metadata for ${name}`);
    directory = parent;
  }
}
