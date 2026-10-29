import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory, verify } from '../deploy/release-integrity.mjs';
const root = path.resolve(import.meta.dirname, '..');
function fixture(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-immutable-'));
  try {
    const code = path.join(tmp, 'releases', 'a'.repeat(40));
    fs.mkdirSync(path.join(code, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(code, 'node_modules'));
    fs.writeFileSync(path.join(code, 'dist/index.html'), 'verified build');
    fs.writeFileSync(path.join(code, 'node_modules/module.js'), 'export default 1;');
    fs.writeFileSync(path.join(code, '.release-sha'), 'a'.repeat(40));
    fs.writeFileSync(path.join(code, '.release-inventory.json'), JSON.stringify(inventory(code)));
    fn(code, tmp);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
test('Inventory verifies immutable dist, dependencies, metadata and unexpected files', () => {
  fixture(code => {
    assert.equal(verify(code), true);
    for (const file of ['dist/index.html', 'node_modules/module.js', '.release-sha']) {
      const full = path.join(code, file), original = fs.readFileSync(full);
      fs.writeFileSync(full, 'changed'); assert.equal(verify(code), false); fs.writeFileSync(full, original);
    }
    fs.writeFileSync(path.join(code, 'unexpected.js'), 'changed'); assert.equal(verify(code), false);
  });
});
test('Inventory never reads live data/uploads and rejects escaping code links', () => {
  fixture((code, tmp) => {
    fs.symlinkSync(tmp, path.join(code, 'data'), 'dir');
    fs.symlinkSync(tmp, path.join(code, 'uploads'), 'dir');
    assert.equal(verify(code), true);
    fs.symlinkSync(tmp, path.join(code, 'outside'), 'dir');
    assert.throws(() => inventory(code), /Escaping/);
  });
});
test('Inventory cannot be re-recorded over existing or referenced active release', () => {
  fixture((code, tmp) => {
    const before = fs.readFileSync(path.join(code, '.release-inventory.json'));
    let result = spawnSync(process.execPath, ['deploy/release-integrity.mjs', '--record', code], { cwd: root });
    assert.equal(result.status, 21);
    fs.symlinkSync(code, path.join(tmp, 'current'), 'dir');
    result = spawnSync(process.execPath, ['deploy/release-integrity.mjs', '--record', code], { cwd: root });
    assert.equal(result.status, 21);
    assert.deepEqual(fs.readFileSync(path.join(code, '.release-inventory.json')), before);
  });
});
test('No general runtime interpreter sudo remains; broker never executes release code', () => {
  for (const script of ['provision-vavilon.sh', 'install.sh']) {
    const content = fs.readFileSync(path.join(root, 'deploy', script), 'utf8');
    assert.equal(/NOPASSWD:.*(?:\/usr\/bin\/(?:env|node)|\/bin\/test)/.test(content), false);
  }
  const broker = fs.readFileSync(path.join(root, 'deploy/mediacode-ops.py'), 'utf8');
  assert.ok(broker.includes('cwd=helper'));
  assert.ok(broker.includes('user=runtime.pw_uid'));
  assert.equal(broker.includes('shell=True'), false);
  assert.ok(broker.includes('SUDO_UID'));
  const deploy = fs.readFileSync(path.join(root, 'deploy/remote-deploy.sh'), 'utf8');
  assert.equal(deploy.includes('rsync'), false);
  assert.equal(deploy.includes('sudo -n -u'), false);
  assert.ok(deploy.includes('runtime_op policy'));
});
test('Real systemd security VM gates both deploy jobs and has no tailnet/secrets/Environment', () => {
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const vm = ci.split('  systemd-security:')[1].split('\n  notify-ci-failure:')[0];
  assert.match(vm, /runs-on: ubuntu-22.04/);
  assert.equal(/secrets\.|id-token:|tailscale\/|environment:/.test(vm), false);
  assert.ok(vm.includes('persist-credentials: false'));
  for (const contour of ['staging', 'production']) {
    const job = ci.split(`  deploy-${contour}:`)[1].split('\n  #')[0];
    assert.match(job, /needs: \[security-and-packages, lint-and-build, tests, systemd-security\]/);
  }
});
