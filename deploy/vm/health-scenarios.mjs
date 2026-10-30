import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
assert.equal(fs.readFileSync('/etc/hostname', 'utf8').trim(), 'mediacode-vm-lab');
assert.ok(fs.existsSync('/etc/mediacode-lab-vm'));
const temp = fs.mkdtempSync('/tmp/mc-health-'); fs.chmodSync(temp, 0o700);
const fixture = spawn('/usr/bin/python3', ['-I', '/srv/review/deploy/vm/health-fixture.py', `${temp}/port`], { stdio: 'ignore' });
const state = '/var/lib/mediacode/production', root = '/opt/mediacode/production';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function businessData() {
  const db = new Database(`${state}/data/media.db`, { readonly: true });
  try {
    return ['lab_preserve', 'users', 'tasks', 'applications', 'points'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  } finally { db.close(); }
}
const snapshot = () => JSON.stringify({
  pid: spawnSync('/bin/systemctl', ['show', 'mediacode-prod', '-p', 'MainPID', '--value'], { encoding: 'utf8' }).stdout,
  env: hash(`${state}/.env`), upload: hash(`${state}/uploads/recruitment/synthetic.txt`),
  current: fs.readlinkSync(`${root}/current`), inventory: hash(`${root}/current/.release-inventory.json`),
  backups: fs.readdirSync(`${state}/backups`).sort(),
  business: businessData(),
});
try {
  for (let i = 0; i < 100 && !fs.existsSync(`${temp}/port`); i++) await new Promise(resolve => setTimeout(resolve, 50));
  const port = Number(fs.readFileSync(`${temp}/port`, 'utf8'));
  const refused = await new Promise(resolve => {
    const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); });
  });
  const before = snapshot();
  for (const name of ['refused', 'timeout', '500', 'empty', 'bad', 'wrong', 'partial']) {
    const url = `http://127.0.0.1:${name === 'refused' ? refused : port}/${name}`;
    const result = spawnSync('/usr/sbin/runuser', ['-u', 'deploy-prod', '--', 'bash', '-s'], {
      input: fs.readFileSync('/srv/review/deploy/remote-deploy.sh', 'utf8'), encoding: 'utf8', timeout: 30000,
      env: { ...process.env, DEPLOY_ENV: 'production', TARGET_SHA: 'a'.repeat(40), HEALTH_URL: url },
    });
    assert.equal(result.status, 21, `health case=${name}; code=${result.status}`);
    assert.equal(snapshot(), before, `health case=${name} must not change service/release/data`);
  }
  console.log('PASS 7 real loopback HTTP/curl failure cases: fail-closed active SHA with unchanged PID/files/data');
} finally { fixture.kill('SIGTERM'); fs.rmSync(temp, { recursive: true, force: true }); }
