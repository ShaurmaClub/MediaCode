import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
assert.equal(fs.readFileSync('/etc/hostname', 'utf8').trim(), 'mediacode-vm-lab');
assert.ok(fs.existsSync('/etc/mediacode-lab-vm'));
const bin = '/root/mc-provision-fault-bin'; fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
for (const cmd of ['useradd', 'usermod', 'install', 'sshd', 'systemctl']) {
  if (!fs.existsSync(`${bin}/${cmd}`)) fs.symlinkSync('/srv/review/deploy/vm/provision-fault.sh', `${bin}/${cmd}`);
}
fs.chmodSync('/srv/review/deploy/vm/provision-fault.sh', 0o755);
function run(cmd, args, expected = 0, env = {}) {
  const r = spawnSync(cmd, args, { cwd: '/srv/review', env: { ...process.env, ...env }, encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, expected, `${cmd}: ${r.status}\n${r.stderr}`); return r.stdout.trim();
}
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'absent';
export function faultStage(name, provision) {
  const before = ['/etc/ssh/sshd_config', '/etc/ssh/mediacode-deploy.conf'].map(hash);
  fs.rmSync('/root/mc-provision-fault-hit', { force: true });
  const r = spawnSync('bash', [...provision, '--apply'], { cwd: '/srv/review', encoding: 'utf8', timeout: 300000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MC_PROVISION_FAULT: name } });
  assert.notEqual(r.status, null); assert.notEqual(r.status, 0);
  assert.ok(fs.existsSync('/root/mc-provision-fault-hit'), `fault ${name} never executed`);
  assert.match(r.stderr, /phase=/);
  assert.deepEqual(['/etc/ssh/sshd_config', '/etc/ssh/mediacode-deploy.conf'].map(hash), before);
  run('/usr/sbin/sshd', ['-t']);
}
export function verifyReruns(provision) {
  // A separate ordinary administrator remains able to log in after every failure/retry.
  run('useradd', ['-m', '-s', '/bin/bash', 'vm-admin']);
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', '/tmp/vm-keys/admin']);
  run('install', ['-d', '-m', '700', '-o', 'vm-admin', '-g', 'vm-admin', '/home/vm-admin/.ssh']);
  run('install', ['-m', '600', '-o', 'vm-admin', '-g', 'vm-admin', '/tmp/vm-keys/admin.pub', '/home/vm-admin/.ssh/authorized_keys']);
  fs.writeFileSync('/tmp/vm-keys/hosts', `vm-review.local ${fs.readFileSync('/etc/ssh/ssh_host_ed25519_key.pub', 'utf8')}`, { mode: 0o600 });
  const adminLogin = () => assert.equal(run('ssh', ['-F', '/dev/null', '-i', '/tmp/vm-keys/admin', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'HostKeyAlias=vm-review.local', '-o', 'UserKnownHostsFile=/tmp/vm-keys/hosts', 'vm-admin@127.0.0.1', 'id', '-un']), 'vm-admin');
  adminLogin();
  for (const phase of ['groups', 'directories', 'keys', 'ssh-validation', 'ssh-files', 'ssh-reload']) {
    faultStage(phase, provision); adminLogin();
    run('bash', [...provision, '--apply']); adminLogin();
  }
  run('/usr/bin/python3', ['-I', 'deploy/vm/provision-install-faults.py']); adminLogin();
  console.log('PASS 9 partial provisioning faults: users/groups/dirs/keys/broker/sudoers/sshd/reload; admin SSH and retries verified');
}
