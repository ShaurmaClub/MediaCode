// Real sudoers/systemd security assertions in an explicitly disposable Ubuntu VM.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { inventory } from '../release-integrity.mjs';
const root = '/srv/review';
assert.ok(fs.existsSync('/etc/mediacode-lab-vm'));
assert.equal(fs.readFileSync('/etc/hostname', 'utf8').trim(), 'mediacode-vm-lab');
const broker = '/usr/local/sbin/mediacode-ops';
let negativeCount = 0;
function command(cmd, args, expected = 0, env = {}) {
  const result = spawnSync(cmd === 'runuser' ? '/usr/sbin/runuser' : cmd, args,
    { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 180000 });
  // Do not include args/env/output: some SSH tests carry synthetic private keys in env.
  assert.equal(result.status, expected, `${cmd} status=${result.status}; error=${result.error?.code}; expected=${expected}\n${result.stderr.slice(-1500)}`);
  return result.stdout.trim();
}
function rejected(user, args) {
  const result = spawnSync('/usr/sbin/runuser', ['-u', user, '--', ...args], { cwd: '/', encoding: 'utf8', timeout: 30000 });
  assert.notEqual(result.status, null, 'negative test did not execute');
  assert.notEqual(result.status, 0, 'privilege escalation unexpectedly succeeded');
  negativeCount++;
}
const digest = path => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const before = [broker, '/etc/sudoers.d/mediacode-deploy', '/etc/ssh/sshd_config', '/etc/ssh/mediacode-deploy.conf'].map(digest);
for (const [suffix, contour, other] of [['prod', 'production', 'staging'], ['stage', 'staging', 'production']]) {
  const user = `deploy-${suffix}`, runtime = `mediacode-${suffix}`;
  const otherRuntime = other === 'production' ? 'mediacode-prod' : 'mediacode-stage';
  rejected(user, ['sudo', '-n', '-u', otherRuntime, '/usr/bin/id']);
  for (const interpreter of ['/usr/bin/env', '/usr/bin/node', '/bin/test', '/bin/sh']) {
    rejected(user, ['sudo', '-n', '-u', runtime, interpreter]);
    rejected(user, ['sudo', '-n', interpreter]);
  }
  rejected(user, ['sudo', '-n', broker, other, 'exists-env']);
  rejected(user, ['sudo', '-n', broker, contour, 'migrate', '../staging']);
  rejected(user, ['sudo', '-n', broker, contour, 'restart;touch /tmp/injected']);
  rejected(user, ['sudo', '-n', broker, contour, 'migrate', 'a'.repeat(40), ';touch /tmp/injected']);
  rejected(user, ['sudo', '-n', broker, contour, 'backup-final', '$(touch /tmp/injected)']);
  rejected(user, ['cat', `/var/lib/mediacode/${other}/.env`]);
  rejected(user, ['ln', '-sf', '/bin/sh', broker]);
  for (const file of ['/etc/sudoers.d/mediacode-deploy', '/etc/ssh/sshd_config',
    '/etc/ssh/mediacode-deploy.conf', '/etc/systemd/system/mediacode-prod.service',
    '/etc/systemd/system/mediacode-stage.service', `/usr/local/lib/mediacode-ops/${contour}/server/migrate.js`,
    `/etc/ssh/mediacode-keys/${user}`]) {
    rejected(user, ['/usr/bin/test', '-w', file]);
  }
  command('ln', ['-s', broker, `/home/${user}/broker-link`]);
  rejected(user, ['sudo', '-n', `/home/${user}/broker-link`, contour, 'exists-env']);
  // Separate negative check from each contour's key, only literal id -un remotely.
  const hostKey = fs.readFileSync('/etc/ssh/ssh_host_ed25519_key.pub', 'utf8').trim();
  command('bash', ['deploy/ssh-connectivity.sh'], 0, { DEPLOY_ENV: contour, SSH_USER: user,
    SSH_HOST: 'vm-lab.invalid', SSH_TARGET_IP: '127.0.0.1', SSH_PORT: '22',
    SSH_PRIVATE_KEY: fs.readFileSync(`/tmp/vm-keys/${suffix}`, 'utf8'), SSH_KNOWN_HOSTS: `vm-lab.invalid ${hostKey}` });
}
assert.equal(fs.existsSync('/tmp/injected'), false);
assert.deepEqual([broker, '/etc/sudoers.d/mediacode-deploy', '/etc/ssh/sshd_config', '/etc/ssh/mediacode-deploy.conf'].map(digest), before);
// Release migration script is attacker-writable: broker must reject, never execute it.
const poison = '/opt/mediacode/production/releases/' + 'b'.repeat(40) + '/server/migrate.js';
const original = fs.readFileSync(poison);
fs.writeFileSync(poison, 'import fs from "node:fs"; fs.writeFileSync("/tmp/injected", "executed");\n');
rejected('deploy-prod', ['sudo', '-n', broker, 'production', 'migrate', 'b'.repeat(40)]);
assert.equal(fs.existsSync('/tmp/injected'), false);
fs.writeFileSync(poison, original); // Test fixture reset only.
console.log(`PASS ${negativeCount} real negative privilege assertions; both SSH keys isolated; no configuration changes`);

// Complete staging contour: synthetic DB/env/uploads and an actual deploy-stage run.
const sha = 'e'.repeat(40), code = `/opt/mediacode/staging/releases/${sha}`, state = '/var/lib/mediacode/staging';
fs.mkdirSync(code);
command('bash', ['-c', 'tar --exclude=.git --exclude=node_modules --exclude=.npm-cache --exclude=data --exclude=uploads -cf - . | tar -xf - -C "$1"', 'copy', code]);
command('cp', ['-a', '--reflink=auto', `${root}/node_modules`, `${code}/node_modules`]);
fs.symlinkSync(`${state}/data`, `${code}/data`); fs.symlinkSync(`${state}/uploads`, `${code}/uploads`);
fs.writeFileSync(`${code}/.release-sha`, sha + '\n');
fs.writeFileSync(`${code}/.release-meta.json`, JSON.stringify({ sha, env: 'staging' }));
fs.writeFileSync(`${code}/.release-inventory.json`, JSON.stringify(inventory(code)));
command('chown', ['-R', 'deploy-stage:mediacode-stage', code]); command('chmod', ['-R', 'u=rwX,g=rX,o=', code]);
fs.writeFileSync(`${state}/.env`, `NODE_ENV=production\nHOST=127.0.0.1\nPORT=4001\nDB_PATH=${state}/data/media.db\nUPLOAD_DIR=${state}/uploads/recruitment\nBACKUP_DIR=${state}/backups\nSESSION_SECRET=${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
command('chown', ['mediacode-stage:mediacode-stage', `${state}/.env`]);
const productionPid = command('systemctl', ['show', 'mediacode-prod', '-p', 'MainPID', '--value']);
command('runuser', ['-u', 'deploy-stage', '--', 'bash', 'deploy/remote-deploy.sh'], 0,
  { DEPLOY_ENV: 'staging', TARGET_SHA: sha, VERIFY_RETRIES: '8', VERIFY_WAIT_SEC: '1', PATH: '/usr/local/bin:/usr/bin:/bin' });
const ready = JSON.parse(command('curl', ['-fsS', 'http://127.0.0.1:4001/api/health/ready']));
assert.equal(ready.commit, sha); assert.equal(ready.ok, true);
assert.equal(command('systemctl', ['show', 'mediacode-prod', '-p', 'MainPID', '--value']), productionPid);
assert.equal(fs.statSync(`${state}/.env`).mode & 0o777, 0o600);
assert.equal(fs.statSync(`${state}/data/media.db`).mode & 0o777, 0o600);
assert.equal(fs.readlinkSync('/opt/mediacode/staging/current'), code);
console.log('PASS full synthetic staging deployment through deploy-stage/broker/systemd; production PID unchanged');

// Fresh preparation path too: local synthetic Git origin and lockfile/offline npm,
// actual artifact extraction, dependencies/native build, inventory and atomic publish.
const fixture = '/srv/stage-fixture'; fs.mkdirSync(fixture);
command('bash', ['-c', 'tar --exclude=.git --exclude=node_modules --exclude=.npm-cache --exclude=data --exclude=uploads -cf - . | tar -xf - -C "$1"', 'copy', fixture]);
command('chown', ['-R', 'deploy-stage:deploy-stage', fixture]);
const git = (...args) => command('runuser', ['-u', 'deploy-stage', '--', 'git', '-C', fixture, ...args]);
git('init', '-q'); git('config', 'user.name', 'Synthetic VM fixture'); git('config', 'user.email', 'lab@example.invalid');
git('add', '.'); git('commit', '-qm', 'Synthetic reviewed source');
const fresh = git('rev-parse', 'HEAD');
assert.equal(fs.existsSync(`/opt/mediacode/staging/releases/${fresh}`), false);
command('cp', ['-a', `${root}/.npm-cache`, '/home/deploy-stage/.npm-cache']);
command('chown', ['-R', 'deploy-stage:deploy-stage', '/home/deploy-stage/.npm-cache']);
command('tar', ['-czf', '/tmp/stage-dist.tar.gz', '-C', `${root}/dist`, '.']);
command('chmod', ['644', '/tmp/stage-dist.tar.gz']);
command('runuser', ['-u', 'deploy-stage', '--', 'bash', 'deploy/remote-deploy.sh'], 0, {
  DEPLOY_ENV: 'staging', TARGET_SHA: fresh, REPO_URL: `file://${fixture}`, DIST_ARCHIVE: '/tmp/stage-dist.tar.gz',
  PATH: '/usr/local/bin:/usr/bin:/bin', VERIFY_RETRIES: '8', VERIFY_WAIT_SEC: '1',
  npm_config_cache: '/home/deploy-stage/.npm-cache', npm_config_offline: 'true', npm_config_build_from_source: 'true',
  npm_config_nodedir: process.env.MEDIACODE_TEST_NODE_DIR || '/usr/local',
});
assert.equal(JSON.parse(command('curl', ['-fsS', 'http://127.0.0.1:4001/api/health/ready'])).commit, fresh);
assert.equal(fs.realpathSync('/opt/mediacode/staging/previous'), code);
assert.ok(fs.existsSync(`/opt/mediacode/staging/releases/${fresh}/.release-inventory.json`));
assert.equal(command('systemctl', ['show', 'mediacode-prod', '-p', 'MainPID', '--value']), productionPid);
console.log('PASS fresh synthetic staging: local Git, offline lockfile/native install, CI dist artifact, inventory, backup, atomic switch, readiness');
