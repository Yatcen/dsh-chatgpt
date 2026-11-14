import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

const dpapi = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
$result = [Security.Cryptography.ProtectedData]::__OPERATION__($bytes, $null, $scope)
[Console]::Out.Write([Convert]::ToBase64String($result))
`;

function protect(operation, bytes) {
  if (process.platform !== 'win32') return Promise.resolve(bytes);
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = Buffer.from(dpapi.replace('__OPERATION__', operation), 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = execFile(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
      windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout) => {
      if (error || !stdout.trim()) reject(new Error('Windows could not access the protected ChatGPT credentials.'));
      else resolve(Buffer.from(stdout.trim(), 'base64'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes.toString('base64'));
  });
}

export async function openStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, process.platform === 'win32' ? 'accounts.dpapi' : 'accounts.json');
  let compromised = false;
  const release = await lockfile.lock(file, {
    realpath: false,
    retries: { retries: 4, minTimeout: 300, maxTimeout: 600 },
    onCompromised: () => { compromised = true; },
  }).catch(() => { throw new Error('ChatGPT credentials are in use by another Harness process.'); });

  const store = {
    async read() {
      let data;
      try {
        data = await readFile(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      }
      return JSON.parse((await protect('Unprotect', data)).toString('utf8'));
    },
    async write(document) {
      if (compromised) throw new Error('The ChatGPT credential store lost its lock. Restart Harness.');
      const bytes = await protect('Protect', Buffer.from(JSON.stringify(document)));
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, bytes, { mode: 0o600, flag: 'wx' });
        if (compromised) throw new Error('The ChatGPT credential store lost its lock. Restart Harness.');
        await rename(temp, file);
      } finally {
        await rm(temp, { force: true });
      }
    },
    async close() {
      if (!compromised) await release();
    },
  };
  return store;
}
