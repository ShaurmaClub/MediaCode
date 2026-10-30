// Fault injection against synthetic data INSIDE the disposable lab only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
if (!fs.existsSync('/.dockerenv') || !fs.existsSync('/tmp/mediacode-lab-authorized')) process.exit(90);
const root = '/lab';
function run(cmd, args = [], env = {}, expected = 0) {
  const r = spawnSync(cmd, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 240000 });
  if (r.status !== expected) throw new Error(`${cmd} expected=${expected} actual=${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}
const git = (...args) => run('git', ['-C', '/tmp/mc-release-src', ...args]);
const source = '/tmp/mc-release-src';
run('git', ['clone', '--quiet', root, source]);
git('config', 'user.email', 'lab@example.invalid');
git('config', 'user.name', 'Lab');
run('git', ['config', '--system', '--add', 'safe.directory', source]);
run('git', ['config', '--system', '--add', 'safe.directory', `${source}/.git`]);
function commit(file, content) {
  fs.writeFileSync(path.join(source, file), content);
  git('add', file); git('commit', '-qm', `Synthetic fixture ${file}`);
  return git('rev-parse', 'HEAD');
}
const state = '/var/lib/mediacode/production';
const current = '/opt/mediacode/production/current';
const initial = fs.readFileSync(path.join(current, '.release-sha'), 'utf8').trim();
run('tar', ['-czf', '/tmp/mc-dist.tar.gz', '-C', '/lab/dist', '.']);
run('cp', ['-a', '/lab/.npm-cache/.', '/home/deploy-prod/.npm-cache/']);
run('chown', ['-R', 'deploy-prod:deploy-prod', '/home/deploy-prod/.npm-cache']);
function deploy(sha, expected = 0, more = {}) {
  fs.rmSync('/tmp/mc-next-dist.tar.gz', { force: true });
  fs.copyFileSync('/tmp/mc-dist.tar.gz', '/tmp/mc-next-dist.tar.gz');
  run('chown', ['deploy-prod:deploy-prod', '/tmp/mc-next-dist.tar.gz']);
  return run('runuser', ['-u', 'deploy-prod', '--', 'bash', 'deploy/remote-deploy.sh'], {
    DEPLOY_ENV: 'production', TARGET_SHA: sha, REPO_URL: source, DIST_ARCHIVE: '/tmp/mc-next-dist.tar.gz',
    VERIFY_RETRIES: '3', VERIFY_WAIT_SEC: '1', npm_config_cache: '/home/deploy-prod/.npm-cache', npm_config_offline: 'true', ...more,
  }, expected);
}
const hash = (dir) => run('bash', ['-c', 'find "$1" -type f ! -path "*/data/*" ! -path "*/uploads/*" -exec sha256sum {} + | sort | sha256sum', 'lab', dir]);
const before = hash(fs.realpathSync(current));
deploy(initial);
assert.equal(hash(fs.realpathSync(current)), before);
console.log('PASS identical SHA leaves release files unchanged');
const good = commit('lab-release.txt', 'synthetic v2');
deploy(good);
assert.equal(path.basename(fs.realpathSync(current)), good);
console.log('PASS update, real npm ci, schema migration, readiness and atomic switch');
const brokenDeps = commit('package-lock.json', '{"lockfileVersion":3,"packages":{}}');
deploy(brokenDeps, 21);
assert.equal(path.basename(fs.realpathSync(current)), good);
console.log('PASS dependency failure leaves current release running');
git('checkout', good, '--', 'package-lock.json'); git('commit', '-qm', 'Restore synthetic lock');
const badMigration = commit('server/migrate.js', 'process.exit(2);\n');
deploy(badMigration, 21);
assert.equal(path.basename(fs.realpathSync(current)), good);
run('curl', ['-fsS', 'http://127.0.0.1:4000/api/health/ready']);
console.log('PASS migration failure restarts compatible previous version');
git('checkout', good, '--', 'server/migrate.js'); git('commit', '-qm', 'Restore migration');
const badReady = commit('server/index.js', 'throw new Error("Synthetic readiness failure");\n');
deploy(badReady, 30);
assert.equal(path.basename(fs.realpathSync(current)), good);
console.log('PASS readiness failure automatically rolls back without replacing data');
fs.writeFileSync('/tmp/mc-fail-restart-sha', good);
deploy(badReady, 31);
assert.equal(path.basename(fs.realpathSync(current)), good);
fs.unlinkSync('/tmp/mc-fail-restart-sha');
run('systemctl', ['restart', 'mediacode-prod.service']);
console.log('PASS rollback failure reports code 31; operator can recover');
function withoutBackup(fn) {
  const config = `${state}/.env`;
  const original = fs.readFileSync(config);
  try {
    fs.appendFileSync(config, '\nBACKUP_MIN_FREE_MB=999999999\n');
    fn();
  } finally { fs.writeFileSync(config, original); }
}
withoutBackup(() => deploy(badReady, 20));
console.log('PASS backup failure blocks deployment');
// Real restore safety gate, with an intact existing backup.
run('bash', ['deploy/restore.sh', '--env=production', '--backup=latest', '--test-restore']);
withoutBackup(() => run('bash', ['deploy/restore.sh', '--env=production', '--backup=latest', '--confirm'], {}, 20));
run('curl', ['-fsS', 'http://127.0.0.1:4000/api/health/ready']);
console.log('PASS failed safety backup blocks restore before service stop');
run('bash', ['deploy/restore.sh', '--env=production', '--backup=latest', '--confirm']);
console.log('PASS full backup restore and readiness after service restart');
run('systemctl', ['stop', 'mediacode-prod']);
const db = new Database(`${state}/data/media.db`);
assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
db.close();
run('systemctl', ['start', 'mediacode-prod']);

// Real sshd and independent deployment accounts; no host port is published.
run('ssh-keygen', ['-A']);
fs.mkdirSync('/run/sshd', { recursive: true });
run('/usr/sbin/sshd', ['-p', '2222', '-o', 'ListenAddress=127.0.0.1', '-o', 'PasswordAuthentication=no']);
fs.mkdirSync('/tmp/mc-keys', { mode: 0o700 });
for (const short of ['prod', 'stage']) {
  const key = `/tmp/mc-keys/${short}`;
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  const user = `deploy-${short}`;
  fs.writeFileSync(`/home/${user}/.ssh/authorized_keys`, fs.readFileSync(key + '.pub'), { mode: 0o600 });
  run('chown', [`${user}:${user}`, `/home/${user}/.ssh/authorized_keys`]);
  // The account must be usable for pubkey authentication in the disposable image.
  run('usermod', ['-p', '*', user]);
}
// Trust established directly from the server's public key, not from a network scan.
const pub = fs.readFileSync('/etc/ssh/ssh_host_ed25519_key.pub', 'utf8').trim().split(' ').slice(0, 2).join(' ');
fs.writeFileSync('/tmp/mc-keys/hosts', `[127.0.0.1]:2222 ${pub}\n`);
const fingerprint = run('ssh-keygen', ['-lf', '/etc/ssh/ssh_host_ed25519_key.pub']).split(' ')[1];
const setupArgs = ['deploy/setup-github.sh', '--host', '127.0.0.1', '--port', '2222', '--prod-key', '/tmp/mc-keys/prod',
  '--stage-key', '/tmp/mc-keys/stage', '--known-hosts', '/tmp/mc-keys/hosts', '--host-fingerprint', fingerprint, '--check'];
run('bash', setupArgs);
const secrets = { SSH_HOST: '127.0.0.1', SSH_PORT: '2222', SSH_USER: 'deploy-prod',
  SSH_PRIVATE_KEY: fs.readFileSync('/tmp/mc-keys/prod', 'utf8'),
  SSH_KNOWN_HOSTS: fs.readFileSync('/tmp/mc-keys/hosts', 'utf8'),
  DEPLOY_PATH: '/opt/mediacode/production', SERVICE_NAME: 'mediacode-prod' };
run('bash', ['deploy/validate-secrets.sh'], secrets);
run('bash', ['deploy/validate-secrets.sh'], { ...secrets, SSH_PORT: 'bad-port' }, 10);
console.log('PASS valid secrets accepted; invalid secrets fail without echoing values');
const sshDeploy = spawnSync('ssh', ['-p', '2222', '-i', '/tmp/mc-keys/prod', '-o', 'IdentitiesOnly=yes',
  '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=/tmp/mc-keys/hosts',
  'deploy-prod@127.0.0.1', `DEPLOY_ENV=production TARGET_SHA=${good} bash -s`], {
  input: fs.readFileSync('/lab/deploy/remote-deploy.sh'), encoding: 'utf8', timeout: 30000,
});
assert.equal(sshDeploy.status, 0, sshDeploy.stderr + sshDeploy.stdout);
console.log('PASS SSH deployment command under real deploy-prod account');
run('bash', [...setupArgs.slice(0, -3), '--host-fingerprint', 'SHA256:InvalidFingerprint', '--check'], {}, 10);
fs.writeFileSync('/home/deploy-stage/.ssh/authorized_keys', '');
run('bash', setupArgs, {}, 10);
console.log('PASS real SSH keys accepted; bad fingerprint and uninstalled key rejected');
