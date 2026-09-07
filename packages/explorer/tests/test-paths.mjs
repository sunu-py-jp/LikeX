import { fileURLToPath } from 'node:url';

// Resolve every virtual test entry from the package, independently of npm's cwd.
export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
