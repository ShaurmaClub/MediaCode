import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { inventory } from '../release-integrity.mjs';
const root = '/srv/review';
if (!fs.existsSync('/etc/mediacode-lab-vm') || fs.readFileSync('/etc/hostname', 'utf8').trim() !== 'mediacode-vm-lab') process.exit(90);
function run(cmd, args = [], env = {}, expected = 0) {
  const r = spawnSync(cmd, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, expected, `${cmd} expected=${expected} actual=${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}
const legacy = '/srv/legacy-lab';
fs.mkdirSync(`${legacy}/data`, { recursive: true });
fs.mkdirSync(`${legacy}/uploads`, { recursive: true });
fs.writeFileSync(`${legacy}/.env`, 'SESSION_SECRET=' + crypto.randomBytes(32).toString('hex'));
const legacyDb = new Database(`${legacy}/data/media.db`); legacyDb.close();
fs.chmodSync(legacy, 0o755); fs.chmodSync(`${legacy}/.env`, 0o644);
// Keep an unrelated legacy unit and prove provisioning never restarts it.
fs.writeFileSync('/etc/systemd/system/mediacode.service', '[Service]\nExecStart=/usr/bin/sleep infinity\n');
run('systemctl', ['daemon-reload']); run('systemctl', ['start', 'mediacode']);
const legacyPid = run('systemctl', ['show', 'mediacode', '-p', 'MainPID', '--value']);
fs.mkdirSync('/tmp/vm-keys', { mode: 0o700 });
for (const user of ['prod', 'stage']) run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', `/tmp/vm-keys/${user}`]);
const provision = ['deploy/provision-vavilon.sh', '--legacy-dir', legacy, '--prod-key', '/tmp/vm-keys/prod.pub', '--stage-key', '/tmp/vm-keys/stage.pub', '--runtime-source', root];
run('bash', [...provision, '--check']);
run('bash', ['deploy/provision-vavilon.sh', '--check', '--legacy-dir', legacy, '--prod-key', '/tmp/vm-keys/prod.pub', '--stage-key', '/tmp/vm-keys/prod.pub'], {}, 10);
run('bash', [...provision, '--apply'], {}, 10);
fs.chmodSync(legacy, 0o700); // Separate, explicit administrator permission change in synthetic lab only.
const { faultStage, verifyReruns } = await import('./provision-scenarios.mjs');
faultStage('users', provision);
run('bash', [...provision, '--apply']);
run('bash', [...provision, '--apply']);
verifyReruns(provision);
assert.equal(run('systemctl', ['show', 'mediacode', '-p', 'MainPID', '--value']), legacyPid);
run('sshd', ['-t']);
const policy = run('sshd', ['-T', '-C', 'user=deploy-stage,host=localhost,addr=127.0.0.1']);
assert.match(policy, /passwordauthentication no/);
assert.match(policy, /authenticationmethods publickey/);
run('runuser', ['-u', 'deploy-stage', '--', 'test', '!', '-r', `${legacy}/.env`]);
run('runuser', ['-u', 'deploy-stage', '--', 'sudo', '-n', '/bin/systemctl', 'stop', 'mediacode-prod.service'], {}, 1);
console.log('PASS real provisioning check/apply/idempotence, legacy gate, deploy-only sshd policy, cross-contour sudo denial and untouched legacy unit');

// Private-key material and synthetic host keys remain inside this disposable VM.
// Loopback is a fixture only; workflow tailnet-check explicitly rejects loopback.
const hostKey = fs.readFileSync('/etc/ssh/ssh_host_ed25519_key.pub', 'utf8').trim();
const sshEnv = { DEPLOY_ENV: 'production', SSH_USER: 'deploy-prod', SSH_HOST: 'vm-lab.invalid',
  SSH_TARGET_IP: '127.0.0.1', SSH_PORT: '22', SSH_PRIVATE_KEY: fs.readFileSync('/tmp/vm-keys/prod', 'utf8'),
  SSH_KNOWN_HOSTS: `vm-lab.invalid ${hostKey}` };
run('bash', ['deploy/ssh-connectivity.sh'], sshEnv);
run('bash', ['deploy/ssh-connectivity.sh'], { ...sshEnv,
  SSH_KNOWN_HOSTS: `vm-lab.invalid ${fs.readFileSync('/tmp/vm-keys/stage.pub', 'utf8').trim()}` }, 10);
console.log('PASS actual OpenSSH: correct identity; other account, wrong private key and wrong host key denied');

const opt = '/opt/mediacode/production';
const data = '/var/lib/mediacode/production';
const old = 'a'.repeat(40), next = 'b'.repeat(40), bad = 'c'.repeat(40);
for (const sha of [old, next, bad]) {
  const dest = `${opt}/releases/${sha}`;
  fs.mkdirSync(dest);
  run('bash', ['-c', 'tar --exclude=.git --exclude=node_modules --exclude=.npm-cache --exclude=data --exclude=uploads -cf - . | tar -xf - -C "$1"', 'copy', dest]);
  run('cp', ['-a', '--reflink=auto', `${root}/node_modules`, `${dest}/node_modules`]);
  fs.symlinkSync(`${data}/data`, `${dest}/data`); fs.symlinkSync(`${data}/uploads`, `${dest}/uploads`);
  fs.writeFileSync(`${dest}/.release-sha`, sha + '\n');
  fs.writeFileSync(`${dest}/.release-meta.json`, JSON.stringify({ sha, env: 'production' }));
  run('chown', ['-R', 'deploy-prod:mediacode-prod', dest]); run('chmod', ['-R', 'u=rwX,g=rX,o=', dest]);
}
fs.writeFileSync(`${opt}/releases/${bad}/server/index.js`, 'throw new Error("VM readiness failure");\n');
for (const sha of [old, next, bad]) {
  fs.writeFileSync(`${opt}/releases/${sha}/.release-inventory.json`, JSON.stringify(inventory(`${opt}/releases/${sha}`)));
  run('chown', ['deploy-prod:mediacode-prod', `${opt}/releases/${sha}/.release-inventory.json`]);
}
const envFile = `${data}/.env`;
fs.writeFileSync(envFile, `NODE_ENV=production\nHOST=127.0.0.1\nPORT=4000\nDB_PATH=${data}/data/media.db\nUPLOAD_DIR=${data}/uploads/recruitment\nUPLOADS_DIR=${data}/uploads/recruitment\nBACKUP_DIR=${data}/backups\nSESSION_SECRET=${crypto.randomBytes(32).toString('hex')}\n`);
fs.writeFileSync('/var/lib/mediacode/staging/.env', 'LAB_ONLY=synthetic\n', { mode: 0o600 });
run('chown', ['mediacode-stage:mediacode-stage', '/var/lib/mediacode/staging/.env']);
run('chown', ['mediacode-prod:mediacode-prod', envFile]); fs.chmodSync(envFile, 0o600);
run('runuser', ['-u', 'mediacode-prod', '--', 'env', `ENV_FILE=${envFile}`, `DB_PATH=${data}/data/media.db`, '/usr/bin/node', `${opt}/releases/${old}/server/migrate.js`, '--verify']);
const db = new Database(`${data}/data/media.db`); db.exec('CREATE TABLE lab_preserve(n INTEGER); INSERT INTO lab_preserve VALUES (1)');
const user = db.prepare("INSERT INTO users(login,password_hash,role,bio) VALUES ('vm-synthetic-user','not-a-real-password','STUDENT','synthetic profile')").run().lastInsertRowid;
const task = db.prepare("INSERT INTO tasks(title,creator_id,points) VALUES ('Synthetic preservation task',?,7)").run(user).lastInsertRowid;
db.prepare("INSERT INTO applications(task_id,user_id,comment) VALUES (?,?,'synthetic application')").run(task, user);
db.prepare("INSERT INTO points(user_id,amount,reason,task_id) VALUES (?,7,'synthetic ledger',?)").run(user, task);
db.close();
run('chown', ['mediacode-prod:mediacode-prod', `${data}/data/media.db`]);
const baseline = '/root/mediacode-lab-baseline.db';
fs.chmodSync(`${data}/data/media.db`, 0o600);
fs.writeFileSync(`${data}/uploads/recruitment/synthetic.txt`, 'synthetic upload; must survive every deployment\n');
run('chown', ['mediacode-prod:mediacode-prod', `${data}/uploads/recruitment/synthetic.txt`]);
fs.chmodSync(`${data}/uploads/recruitment/synthetic.txt`, 0o600);
fs.copyFileSync(`${data}/data/media.db`, baseline);
for (const unit of ['mediacode-prod', 'mediacode-stage']) fs.copyFileSync(`${root}/deploy/${unit}.service`, `/etc/systemd/system/${unit}.service`);
run('systemctl', ['daemon-reload']);
const health = () => { const d = JSON.parse(run('curl', ['-fsS', '--retry', '8', '--retry-connrefused', '--retry-delay', '1', 'http://127.0.0.1:4000/api/health/ready'])); assert.equal(d.ok, true); return d; };
function reset() {
  run('/bin/systemctl', ['stop', 'mediacode-prod']);
  for (const f of ['media.db', 'media.db-wal', 'media.db-shm', 'hidden.db']) fs.rmSync(`${data}/data/${f}`, { force: true });
  fs.copyFileSync(baseline, `${data}/data/media.db`);
  run('chown', ['mediacode-prod:mediacode-prod', `${data}/data/media.db`]);
  run('/bin/ln', ['-sfn', `${opt}/releases/${old}`, `${opt}/current`]);
  fs.rmSync('/tmp/mediacode-fault-hit', { force: true });
  run('/bin/systemctl', ['start', 'mediacode-prod']); health();
}
reset();
const sandbox = run('systemctl', ['show', 'mediacode-prod', '-p', 'ProtectSystem', '-p', 'ProtectHome', '-p', 'ReadWritePaths', '-p', 'NoNewPrivileges']);
assert.match(sandbox, /ProtectSystem=strict/); assert.match(sandbox, /NoNewPrivileges=yes/); assert.match(sandbox, /ProtectHome=yes/);
// Attempt writes from within the SAME service sandbox via ExecStartPost.
fs.mkdirSync('/etc/systemd/system/mediacode-prod.service.d', { recursive: true });
fs.writeFileSync('/etc/systemd/system/mediacode-prod.service.d/lab.conf', '[Service]\nExecStartPost=/bin/sh -c "touch /var/lib/mediacode/production/data/sandbox-ok; ! touch /srv/review/sandbox-denied; ! touch /opt/mediacode/production/current/sandbox-denied; ! cat /var/lib/mediacode/staging/.env"\n');
run('systemctl', ['daemon-reload']); run('systemctl', ['restart', 'mediacode-prod']); health();
assert.ok(fs.existsSync(`${data}/data/sandbox-ok`)); assert.equal(fs.existsSync(`${root}/sandbox-denied`), false);
fs.rmSync('/etc/systemd/system/mediacode-prod.service.d/lab.conf'); run('systemctl', ['daemon-reload']);
const pid = run('systemctl', ['show', 'mediacode-prod', '-p', 'MainPID', '--value']);
run('kill', ['-KILL', pid]);
run('sleep', ['4']); health();
assert.notEqual(run('systemctl', ['show', 'mediacode-prod', '-p', 'MainPID', '--value']), pid);
assert.ok(run('journalctl', ['-u', 'mediacode-prod', '-n', '10', '--no-pager']).length);
console.log('PASS real systemd sandbox, allowed/denied writes, journal, automatic Restart and actual stop/start');

fs.mkdirSync('/tmp/vm-fault-bin');
for (const cmd of ['ln', 'mv', 'sudo', 'curl']) fs.symlinkSync(`${root}/deploy/vm/fault-command.sh`, `/tmp/vm-fault-bin/${cmd}`);
run('chmod', ['755', `${root}/deploy/vm/fault-command.sh`]);
function deploy(sha, fault, expected, extra = {}) {
  const command = fault ? 'bash' : 'runuser';
  const args = fault ? ['deploy/remote-deploy.sh'] : ['-u', 'deploy-prod', '--', 'bash', 'deploy/remote-deploy.sh'];
  run(command, args, { DEPLOY_ENV: 'production', TARGET_SHA: sha, FAULT_CASE: fault,
    PATH: `/tmp/vm-fault-bin:${process.env.PATH}`, VERIFY_RETRIES: '2', VERIFY_WAIT_SEC: '1', ...extra }, expected);
}
function userData() {
  const file = fs.existsSync(`${data}/data/media.db`) ? `${data}/data/media.db` : `${data}/data/hidden.db`;
  const db = new Database(file, { readonly: true });
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  const snapshot = JSON.stringify(db.prepare('SELECT n FROM lab_preserve ORDER BY n').all());
  const business = crypto.createHash('sha256').update(JSON.stringify([
    db.prepare('SELECT id,login,role,bio FROM users ORDER BY id').all(),
    db.prepare('SELECT id,title,creator_id,points,status FROM tasks ORDER BY id').all(),
    db.prepare('SELECT id,task_id,user_id,status,comment FROM applications ORDER BY id').all(),
    db.prepare('SELECT id,user_id,amount,reason,task_id,is_reversed FROM points ORDER BY id').all(),
  ])).digest('hex'); db.close();
  for (const privateFile of [file, envFile, `${data}/uploads/recruitment/synthetic.txt`]) assert.equal(fs.statSync(privateFile).mode & 0o777, 0o600);
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return { snapshot, business, env: hash(envFile), upload: hash(`${data}/uploads/recruitment/synthetic.txt`) };
}
const expectedData = userData();
function unchanged() { assert.deepEqual(userData(), expectedData); }
function releaseState() {
  return JSON.stringify({ tree: inventory(`${opt}/releases/${old}`), current: fs.readlinkSync(`${opt}/current`),
    pid: run('systemctl', ['show', 'mediacode-prod', '-p', 'MainPID', '--value']),
    backups: fs.readdirSync(`${data}/backups`).sort(),
    marker: fs.statSync(`${opt}/releases/${old}/.release-meta.json`).mtimeMs });
}
const beforeNoop = releaseState();
await import('./health-scenarios.mjs');
deploy(old, '', 0); assert.equal(health().commit, old); unchanged(); assert.equal(releaseState(), beforeNoop);
for (const name of ['data', 'uploads']) for (const replacement of ['missing', 'file', 'directory', 'other', 'outside', 'relative']) {
  const link = `${opt}/releases/${old}/${name}`, marker = fs.readFileSync(`${opt}/releases/${old}/.release-inventory.json`);
  const activePid = run('systemctl', ['show', 'mediacode-prod', '-p', 'MainPID', '--value']);
  fs.unlinkSync(link);
  if (replacement === 'file') fs.writeFileSync(link, 'not runtime data');
  if (replacement === 'directory') fs.mkdirSync(link);
  if (replacement === 'other') fs.symlinkSync(`/var/lib/mediacode/staging/${name}`, link);
  if (replacement === 'outside') fs.symlinkSync('/tmp', link);
  if (replacement === 'relative') fs.symlinkSync(`../../../../var/lib/mediacode/production/${name}`, link);
  deploy(old, '', 21); unchanged();
  assert.equal(run('systemctl', ['show', 'mediacode-prod', '-p', 'MainPID', '--value']), activePid);
  assert.deepEqual(fs.readFileSync(`${opt}/releases/${old}/.release-inventory.json`), marker);
  if (replacement === 'directory') { assert.ok(fs.lstatSync(link).isDirectory()); fs.rmdirSync(link); }
  else if (replacement !== 'missing') { assert.ok(fs.lstatSync(link)); fs.unlinkSync(link); }
  else assert.equal(fs.existsSync(link), false);
  fs.symlinkSync(`${data}/${name}`, link); // Explicit lab reset only, never deploy repair.
}
assert.equal(releaseState(), beforeNoop);
console.log('PASS 12 real active-release external-link mutations: exit 21, preserve damage/inventory/PID/data; no target-data inventory reads');
const entry = `${opt}/releases/${old}/dist/index.html`, originalEntry = fs.readFileSync(entry);
fs.writeFileSync(entry, 'damaged synthetic artifact');
const damaged = releaseState();
deploy(old, '', 21); assert.equal(releaseState(), damaged); unchanged();
fs.writeFileSync(entry, originalEntry); // Explicit lab-fixture repair only, never in deployment.
const nextState = JSON.stringify(inventory(`${opt}/releases/${next}`));
reset(); deploy(next, '', 0); assert.equal(health().commit, next); unchanged();
assert.equal(JSON.stringify(inventory(`${opt}/releases/${next}`)), nextState);
assert.ok(fs.existsSync(`${opt}/releases/${old}`));
console.log('PASS healthy repeated SHA and normal release as actual non-root deploy-prod');
reset(); fs.mkdirSync(`${opt}/releases/${'d'.repeat(40)}`);
deploy('d'.repeat(40), '', 21); assert.equal(health().commit, old); unchanged();
console.log('PASS active healthy/damaged SHA, existing inactive SHA, prepare failure, immutable files/data');
reset();
const inactiveEntry = `${opt}/releases/${next}/dist/index.html`, inactiveOriginal = fs.readFileSync(inactiveEntry);
fs.writeFileSync(inactiveEntry, 'damaged inactive release');
deploy(next, '', 21); assert.equal(fs.readFileSync(inactiveEntry, 'utf8'), 'damaged inactive release');
assert.equal(health().commit, old); unchanged(); fs.writeFileSync(inactiveEntry, inactiveOriginal);
fs.renameSync(`${opt}/releases/${next}`, `${opt}/releases/${next}.saved-fixture`);
fs.symlinkSync(`${opt}/releases/${old}`, `${opt}/releases/${next}`);
deploy(next, '', 21); assert.equal(health().commit, old); unchanged();
fs.unlinkSync(`${opt}/releases/${next}`); fs.renameSync(`${opt}/releases/${next}.saved-fixture`, `${opt}/releases/${next}`);
console.log('PASS damaged inactive release and symlink substitution refused without changing files/service/data');
for (const fault of ['previous-ln', 'previous-mv', 'current-ln', 'current-mv', 'stop', 'restart', 'interrupt']) {
  reset(); deploy(next, fault, fault === 'restart' ? 30 : 21);
  assert.equal(health().commit, old); unchanged();
  deploy(next, '', 0); assert.equal(health().commit, next); unchanged();
  assert.ok(fs.existsSync(`${opt}/releases/${old}`));
  console.log(`PASS ${fault}: previous service restored, data retained, subsequent retry succeeds`);
}
reset(); deploy(bad, 'readiness', 30); assert.equal(health().commit, old);
const preserved = new Database(`${data}/data/media.db`, { readonly: true });
assert.equal(preserved.prepare('SELECT COUNT(*) AS n FROM lab_preserve WHERE n=999').get().n, 1); preserved.close();
assert.equal(userData().env, expectedData.env); assert.equal(userData().upload, expectedData.upload);
assert.equal(userData().business, expectedData.business);
console.log('PASS readiness rollback keeps writes made after final backup (no DB restore)');
for (const fault of ['db-unavailable', 'future-schema', 'restart-all', 'health']) {
  reset(); deploy(next, fault, 31); unchanged();
  if (fault === 'health') assert.equal(health().commit, old);
  else run('/bin/systemctl', ['is-active', 'mediacode-prod'], {}, 3);
  console.log(`PASS ${fault}: explicit emergency 31, no destructive restore`);
}
reset();
assert.equal(run('systemctl', ['show', 'mediacode', '-p', 'MainPID', '--value']), legacyPid);
deploy(next, '', 0, { KEEP_RELEASES: '1' }); unchanged();
assert.ok(fs.existsSync(`${opt}/releases/${old}`)); assert.ok(fs.existsSync(`${opt}/releases/${next}`));
assert.equal(fs.realpathSync(`${opt}/previous`), `${opt}/releases/${old}`);
console.log('PASS cleanup with keep=1 preserves both current and previous releases');
console.log('PASS all VM fault scenarios; unrelated legacy service PID preserved');
await import('./security-scenarios.mjs');
const { verifyUnixAccess } = await import('./unix-access-scenarios.mjs');
verifyUnixAccess(provision);
