import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Read installed metadata even when the package does not export package.json. */
export async function installedPackage(name, from) {
  const localRequire = from ? createRequire(path.join(from, 'package.json')) : undefined;
  const resolve = localRequire ? specifier => pathToFileURL(localRequire.resolve(specifier)).href
    : specifier => import.meta.resolve(specifier);
  let resolved;
  try {
    // Type-only packages such as @types/node do not have a runtime entry.
    resolved = resolve(`${name}/package.json`);
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    // Packages with private metadata still expose an entry we can walk up from.
    resolved = resolve(name);
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
