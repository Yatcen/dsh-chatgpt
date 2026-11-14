import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { patchMemsearch } from '../src/memsearch-compat.js';

const packageName = '@zilliz/memsearch-dsh';

function profile(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memsearch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('leaves profiles without MemSearch alone', t => {
  assert.equal(patchMemsearch(profile(t)), 'absent');
});

test('preserves unknown MemSearch versions and locally modified source', t => {
  const dir = profile(t);
  const installed = join(dir, 'node_modules', packageName);
  mkdirSync(installed, { recursive: true });
  const manifest = join(installed, 'package.json');
  const runtime = join(installed, 'runtime.js');
  const source = '  const child = spawn(file, [...prefix, ...args], { windowsHide: true, ...spawnOptions })\n';

  writeFileSync(runtime, source);
  for (const version of ['0.2.0', '0.1.9']) {
    writeFileSync(manifest, JSON.stringify({ name: packageName, version }));
    assert.equal(patchMemsearch(dir), 'unsupported');
    assert.equal(readFileSync(runtime, 'utf8'), source);
  }
});

test('does not follow a linked MemSearch checkout outside this profile', t => {
  const dir = profile(t);
  const checkout = profile(t);
  const scope = join(dir, 'node_modules', '@zilliz');
  mkdirSync(scope, { recursive: true });
  symlinkSync(checkout, join(scope, 'memsearch-dsh'), 'junction');
  assert.equal(patchMemsearch(dir), 'outside-profile');
});
