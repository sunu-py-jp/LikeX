import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fallbackRoot = fileURLToPath(new URL('../license-notices/', import.meta.url));
const permissiveLicenses = new Set([
  'MIT', 'Apache-2.0', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause',
  'BSD-3-Clause-Clear', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense', 'Zlib', 'BSL-1.0',
]);

const metadata = directory => JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));

/** Resolve from the importing package, including nested installs and workspace links. */
export function resolvePackageDirectory(name, fromDirectory) {
  if (!/^(?:@[^/]+\/)?[^/]+$/.test(name) || name.includes('..')) throw new Error(`Invalid package name: ${name}`);
  let directory = realpathSync(fromDirectory);
  for (;;) {
    const candidate = path.join(directory, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) {
      const error = new Error(`Cannot resolve required package ${name} from ${fromDirectory}`);
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    directory = parent;
  }
}

/** Exact-version, reviewed upstream text is used only when the installed archive lacks a notice. */
export function readPackageNotice(directory) {
  const pkg = metadata(directory);
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') throw new Error(`Missing package identity in ${directory}`);
  const notices = readdirSync(directory, { withFileTypes: true })
    .filter(file => file.isFile() && /^(licen[sc]e|notice|copyright|copying)([.-]|$)/i.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(file => readFileSync(path.join(directory, file.name), 'utf8'))
    .filter(text => text.trim());
  if (!notices.length && existsSync(path.join(fallbackRoot, 'registry.json'))) {
    const registry = JSON.parse(readFileSync(path.join(fallbackRoot, 'registry.json'), 'utf8'));
    const fallback = registry[`${pkg.name}@${pkg.version}`];
    if (fallback) {
      if (typeof fallback.file !== 'string' || !/^https:\/\//.test(fallback.source) || path.basename(fallback.file) !== fallback.file || !/^[a-f0-9]{64}$/.test(fallback.sha256))
        throw new Error(`Invalid notice fallback provenance for ${pkg.name}@${pkg.version}`);
      const recovered = readFileSync(path.join(fallbackRoot, fallback.file), 'utf8');
      if (createHash('sha256').update(recovered).digest('hex') !== fallback.sha256)
        throw new Error(`Notice fallback hash mismatch for ${pkg.name}@${pkg.version}`);
      notices.push(recovered);
    }
  }
  return { name: pkg.name, version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : 'UNKNOWN', notices };
}

/** Both sides of compound SPDX expressions must be approved; exceptions require review. */
export function assertPermissiveLicense(entry) {
  const tokens = entry.license.match(/\(|\)|[^\s()]+/g) ?? [];
  let index = 0;
  function term() {
    if (tokens[index] === '(') {
      index++;
      if (!expression() || tokens[index++] !== ')') return false;
      return true;
    }
    return permissiveLicenses.has(tokens[index++]);
  }
  function expression() {
    if (!term()) return false;
    while (tokens[index] === 'AND' || tokens[index] === 'OR') {
      index++;
      if (!term()) return false;
    }
    return true;
  }
  if (!expression() || index !== tokens.length)
    throw new Error(`License policy rejects ${entry.name}@${entry.version}: ${entry.license}`);
  if (!entry.notices.some(text => text.trim().length >= 80 && /copyright|permission|redistribution|public domain|license|licence/i.test(text)))
    throw new Error(`Missing substantive license/notice text for ${entry.name}@${entry.version} (${entry.license})`);
  return entry;
}

/** Installed runtime and peer closure. Build-only tools enter only when explicitly supplied. */
export function collectRuntimeNotices(packageRoot, extraPackageNames = []) {
  const root = realpathSync(packageRoot);
  const seen = new Set([root]);
  const entries = new Map();
  function visit(directory, include) {
    const pkg = metadata(directory);
    if (include) {
      const entry = assertPermissiveLicense(readPackageNotice(directory));
      const key = `${entry.name}@${entry.version}`;
      const previous = entries.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
        throw new Error(`Conflicting installed license notices for ${key}`);
      entries.set(key, entry);
    }
    const edges = new Map();
    for (const name of Object.keys(pkg.dependencies ?? {})) edges.set(name, false);
    for (const name of Object.keys(pkg.peerDependencies ?? {}))
      if (!edges.has(name)) edges.set(name, pkg.peerDependenciesMeta?.[name]?.optional === true);
    for (const name of Object.keys(pkg.optionalDependencies ?? {})) edges.set(name, true);
    if (!include) for (const name of extraPackageNames) edges.set(name, false);
    for (const [name, optional] of edges) {
      let resolved;
      try { resolved = resolvePackageDirectory(name, directory); }
      catch (error) { if (optional && error.code === 'MODULE_NOT_FOUND') continue; throw error; }
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      visit(resolved, true);
    }
  }
  visit(root, false);
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Compare retained text, not only a package's presence in an inventory. */
export function assertNoticesRetained(text, entries, label) {
  const normalized = text.replaceAll('\r\n', '\n');
  for (const entry of entries) {
    if (!normalized.includes(`${entry.name}@${entry.version}`) && !normalized.includes(`${entry.name} ${entry.version}`))
      throw new Error(`${label} omits ${entry.name}@${entry.version}`);
    for (const notice of entry.notices) {
      if (!normalized.includes(notice.replaceAll('\r\n', '\n').trim()))
        throw new Error(`${label} omits license/notice text for ${entry.name}@${entry.version}`);
    }
  }
}

export function assertInventoryRetained(inventory, text, candidates, requiredNames = []) {
  if (!Array.isArray(inventory) || !inventory.length) throw new Error('Playground license inventory is empty or invalid');
  const available = new Map(candidates.map(entry => [`${entry.name}@${entry.version}`, entry]));
  const seen = new Set();
  const entries = inventory.map(item => {
    const key = `${item.name}@${item.version}`;
    const entry = available.get(key);
    if (!entry || item.license !== entry.license) throw new Error(`Playground inventory does not match installed metadata: ${key}`);
    if (seen.has(key)) throw new Error(`Duplicate playground inventory entry: ${key}`);
    seen.add(key);
    return assertPermissiveLicense(entry);
  });
  for (const name of requiredNames)
    if (!entries.some(entry => entry.name === name)) throw new Error(`Playground inventory omits bundled dependency ${name}`);
  assertNoticesRetained(text, entries, 'Playground notices');
  return entries;
}
