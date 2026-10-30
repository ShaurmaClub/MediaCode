import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
assert.equal(fs.readFileSync('/etc/hostname', 'utf8').trim(), 'mediacode-vm-lab');
assert.ok(fs.existsSync('/etc/mediacode-lab-vm'));
function run(cmd, args, expected = 0) {
  const r = spawnSync(cmd, args, { cwd: '/srv/review', encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, expected, `${cmd}: ${r.status}\n${r.stderr}`); return r.stdout.trim();
}
const as = (user, args, expected = 0) => run('/usr/sbin/runuser', ['-u', user, '--', ...args], expected);
const pid = () => run('/bin/systemctl', ['show', 'mediacode-prod', '-p', 'MainPID', '--value']);
export function verifyUnixAccess(provision) {
  let denials = 0;
  for (const [contour, suffix, other] of [['production', 'prod', 'stage'], ['staging', 'stage', 'prod']]) {
    const root = `/opt/mediacode/${contour}`, data = `/var/lib/mediacode/${contour}`;
    const deploy = `deploy-${suffix}`, runtime = `mediacode-${suffix}`, group = `mediacode-code-${suffix}`;
    const runtimeId = Number(run('id', ['-u', runtime])), runtimeGid = Number(run('id', ['-g', runtime]));
    const deployId = Number(run('id', ['-u', deploy]));
    for (const user of [deploy, runtime]) assert.ok(run('id', ['-nG', user]).split(' ').includes(group));
    assert.equal(run('id', ['-nG', deploy]).split(' ').includes(runtime), false);
    // A harmless synthetic upload in staging too; create as runtime with restrictive umask.
    as(runtime, ['bash', '-c', 'umask 077; printf synthetic > "$1"', 'fixture', `${data}/uploads/recruitment/access-test.txt`]);
    const backup = fs.readdirSync(`${data}/backups`).find(name => fs.statSync(`${data}/backups/${name}`).isFile());
    assert.ok(backup, `${contour} must have a real broker-generated backup`);
    const privateFiles = ['.env', 'data/media.db', 'data/media.db-wal', 'data/media.db-shm',
      'uploads/recruitment/access-test.txt', `backups/${backup}`];
    assert.equal(fs.statSync(data).mode & 0o777, 0o700);
    for (const name of ['', 'data', 'uploads', 'uploads/recruitment', 'backups', ...privateFiles]) {
      const file = name ? `${data}/${name}` : data, info = fs.lstatSync(file);
      assert.equal(info.uid, runtimeId); assert.equal(info.gid, runtimeGid);
      assert.equal(info.isSymbolicLink(), false);
      assert.equal(info.mode & 0o007, 0);
      if (info.isFile()) assert.equal(info.mode & 0o077, 0);
      assert.doesNotMatch(run('getfacl', ['-cp', '--', file]), /^(default:|user:[^:]|group:[^:])/m);
      run('/usr/bin/test', ['-r', file]); as(runtime, ['/usr/bin/test', '-r', file]);
    }
    for (const name of privateFiles) for (const user of [deploy, `deploy-${other}`, `mediacode-${other}`]) {
      as(user, ['cat', `${data}/${name}`], 1); denials++;
    }
    for (const link of ['current', 'previous']) {
      const file = `${root}/${link}`;
      assert.ok(fs.lstatSync(file).isSymbolicLink());
      const release = fs.realpathSync(file), info = fs.statSync(release);
      assert.equal(info.uid, deployId); assert.equal(info.mode & 0o027, 0);
      assert.doesNotMatch(run('getfacl', ['-cp', '--', release]), /^(default:|user:[^:]|group:[^:])/m);
      as(runtime, ['/usr/bin/test', '-r', `${release}/server/index.js`]);
      as(runtime, ['/usr/bin/test', '!', '-w', release]);
      as(`mediacode-${other}`, ['/usr/bin/test', '-r', `${release}/server/index.js`], 1); denials++;
      console.log(`ACCESS ${contour}/${link} uid=${info.uid} gid=${info.gid} mode=${(info.mode & 0o777).toString(8)} linkMode=777 (parent traversal enforced)`);
    }
    // Preparation is private until publish; no stale world-readable temporary files.
    const temp = `${root}/releases/.mc-access.tmp`;
    as(deploy, ['bash', '-c', 'umask 077; mkdir "$1"; printf synthetic > "$1/private"', 'fixture', temp]);
    assert.equal(fs.statSync(temp).mode & 0o777, 0o700);
    assert.equal(fs.statSync(`${temp}/private`).mode & 0o777, 0o600);
    as(runtime, ['cat', `${temp}/private`], 1); denials++;
    fs.unlinkSync(`${temp}/private`); fs.rmdirSync(temp);
    as(deploy, ['sudo', '-n', '/usr/local/sbin/mediacode-ops', contour, 'is-active']);
    console.log(`ACCESS ${contour}: state=${runtime}:700 files=600 no extended/default ACL; deploy own/cross denied, runtime own allowed/cross denied`);
  }
  // Upgrade a legacy account while an actual runtime is live, including old cached groups.
  const beforePid = pid(), beforeCurrent = fs.readlinkSync('/opt/mediacode/production/current');
  for (const [contour, suffix] of [['production', 'prod'], ['staging', 'stage']]) {
    run('usermod', ['-a', '-G', `mediacode-${suffix}`, `deploy-${suffix}`]);
    for (const name of ['', '/releases', '/repo']) run('chgrp', [`mediacode-${suffix}`, `/opt/mediacode/${contour}${name}`]);
    // Legacy membership alone did not bypass the existing 0700 state-root barrier.
    for (const file of ['.env', 'data/media.db']) as(`deploy-${suffix}`, ['cat', `/var/lib/mediacode/${contour}/${file}`], 1);
  }
  run('bash', [...provision, '--apply']);
  assert.equal(pid(), beforePid); assert.equal(fs.readlinkSync('/opt/mediacode/production/current'), beforeCurrent);
  for (const suffix of ['prod', 'stage']) assert.equal(run('id', ['-nG', `deploy-${suffix}`]).split(' ').includes(`mediacode-${suffix}`), false);
  run('setpriv', ['--reuid=mediacode-prod', '--regid=mediacode-prod', '--clear-groups', '/usr/bin/test', '-r', '/opt/mediacode/production/current/server/index.js']);
  assert.equal(fs.statSync(fs.realpathSync('/opt/mediacode/staging/current')).gid, Number(run('getent', ['group', 'mediacode-code-stage']).split(':')[2]));
  // Unexpected ACL is blocked before any mutation and retained for administrator review.
  const state = '/var/lib/mediacode/production';
  run('setfacl', ['-m', 'u:deploy-prod:r-x', state]);
  const acl = run('getfacl', ['-cp', state]);
  run('bash', [...provision, '--apply'], 10);
  assert.equal(run('getfacl', ['-cp', state]), acl); assert.equal(pid(), beforePid);
  run('setfacl', ['-b', state]); fs.chmodSync(state, 0o700); // Explicit lab reset, never deployment repair.
  const codeRoot = '/opt/mediacode/production';
  run('setfacl', ['-m', 'u:vm-admin:r-x', codeRoot]);
  const codeAcl = run('getfacl', ['-cp', codeRoot]);
  run('bash', [...provision, '--apply'], 10);
  assert.equal(run('getfacl', ['-cp', codeRoot]), codeAcl); assert.equal(pid(), beforePid);
  run('setfacl', ['-b', codeRoot]); fs.chmodSync(codeRoot, 0o750); // Explicit fixture reset only.
  console.log(`PASS ${denials} Unix access denials, real DB/WAL/SHM/backups, ACL/modes, legacy group upgrade without runtime restart; fresh staging uses code group`);
}
