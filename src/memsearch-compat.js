import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const packageName = '@zilliz/memsearch-dsh';
const supportedVersions = new Set(['0.1.8', '0.1.9']);
const originalHash = '12f7f6781c213d6fd0402e9e79132445a896aeee8424b78079b93b6c4117db8f';
const patchedHash = 'b9d5308d81264444850ab8d18a78ded54d8dfa699f3305540f31a869fb0ae3d9';
const originalSpawn = '  const child = spawn(file, [...prefix, ...args], { windowsHide: true, ...spawnOptions })';
const silentSpawn = [
  '  // A detached child creates a new console on Windows, even with windowsHide.',
  "  const childOptions = process.platform === 'win32'",
  '    ? { ...spawnOptions, windowsHide: true, detached: false }',
  '    : { windowsHide: true, ...spawnOptions }',
  '  const child = spawn(file, [...prefix, ...args], childOptions)',
].join('\n');

const digest = data => createHash('sha256').update(data).digest('hex');

export function patchMemsearch(profileDir) {
  const modules = join(profileDir, 'node_modules');
  const expectedDir = join(modules, packageName);
  let packageDir;
  try {
    packageDir = realpathSync(expectedDir);
  } catch (error) {
    if (error.code === 'ENOENT') return 'absent';
    throw error;
  }

  const location = relative(realpathSync(profileDir), packageDir);
  if (isAbsolute(location) || !location.startsWith('node_modules' + sep)) return 'outside-profile';
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  if (manifest.name !== packageName || !supportedVersions.has(manifest.version)) return 'unsupported';

  const runtime = join(packageDir, 'runtime.js');
  if (!lstatSync(runtime).isFile()) return 'unsupported';
  const source = readFileSync(runtime);
  const hash = digest(source);
  if (hash === patchedHash) return 'already-patched';
  if (hash !== originalHash) return 'unsupported';
  const patched = source.toString('utf8').replace(originalSpawn, silentSpawn);
  if (digest(patched) !== patchedHash) throw new Error('MemSearch patch checksum mismatch');

  // Replace the directory entry to leave any pnpm store hard link untouched.
  const staged = join(packageDir, 'runtime.js.' + randomUUID() + '.tmp');
  try {
    writeFileSync(staged, patched, { flag: 'wx' });
    if (!readFileSync(runtime).equals(source)) return 'changed';
    renameSync(staged, runtime);
  } finally {
    rmSync(staged, { force: true });
  }
  return 'patched';
}

export const name = 'dsh-chatgpt-memsearch-compat';
export const inject = ['profileContext', 'hmr'];

export async function apply(ctx) {
  if (process.platform !== 'win32' || ctx.profileContext.name !== 'desktop') return;

  const runtime = join(ctx.profileContext.dir, 'node_modules', packageName, 'runtime.js');
  const hmr = ctx.hmr;
  try {
    // watchConfig waits for application readiness and calls us within the HMR queue.
    const unwatch = await hmr.watchConfig(runtime, async () => {
      const result = patchMemsearch(ctx.profileContext.dir);
      if (result === 'patched') {
        const reload = await hmr.reconcileProfile();
        if (reload.restartReason !== undefined || reload.pending.length > 0) {
          ctx.logger.warn('MemSearch was patched on disk. Restart Desktop to load the silent runtime.');
        } else {
          ctx.logger.info('MemSearch Windows background launch patched.');
        }
      } else if (result === 'unsupported' || result === 'outside-profile') {
        ctx.logger.info('MemSearch Windows patch skipped (%s).', result);
      }
    });
    ctx.effect(() => unwatch);
  } catch (error) {
    ctx.logger.warn('Could not watch the MemSearch runtime: %s', error.message);
  }
}
