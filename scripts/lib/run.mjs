import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const packageRoot = path.join(projectRoot, 'packages/explorer');
export const sourceRoot = path.join(packageRoot, 'src');
export const artifactRoot = path.join(projectRoot, 'artifacts');

/** Run without a shell so paths, including spaces, are passed literally. */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = 180_000, capture = false, ...rest } = options;
    const child = spawn(command, args, {
      cwd: projectRoot, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', ...rest,
    });
    let output = '', errors = '', expired = false;
    child.stdout?.on('data', data => { output += data; });
    child.stderr?.on('data', data => { errors += data; });
    let killTimer;
    const timer = setTimeout(() => {
      expired = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      killTimer.unref();
    }, timeout);
    timer.unref();
    child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (code === 0 && !expired) resolve(output);
      else reject(new Error(`${path.basename(command)} ${args.join(' ')} ${expired ? 'timed out' : `exited ${code}`}\n${output}${errors}`));
    });
  });
}

export function runNpm(args, options) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run this command through npm run so the active npm CLI can be reused.');
  return run(process.execPath, [cli, ...args], options);
}
