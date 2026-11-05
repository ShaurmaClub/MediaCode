// First initialization ONLY, as mediacode-stage; never imports/copies legacy data.
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { validateStaging, STATE } from './config.mjs';
validateStaging(process.env);
if (!process.getuid || process.getuid() === 0 || fs.statSync(STATE).uid !== process.getuid()) {
  throw new Error('Initialize as staging state owner, never root');
}
if (fs.realpathSync(STATE) !== STATE || fs.realpathSync(`${STATE}/data`) !== `${STATE}/data`) {
  throw new Error('Staging state path redirected');
}
if (fs.existsSync(process.env.DB_PATH) || fs.existsSync(`${STATE}/synthetic-accounts.json`)) {
  throw new Error('Refusing to initialize existing state');
}
process.umask(0o077);
const { default: db } = await import('../../server/db.js');
try {
  const credentials = ['ADMIN', 'STAFF', 'STUDENT'].map(role => ({
    login: `stage-${role.toLowerCase()}`, role, password: crypto.randomBytes(24).toString('hex'),
  }));
  db.transaction(() => {
    for (const { login, role, password } of credentials) {
      db.prepare(`INSERT INTO users (login,password_hash,role,first_name,last_name,status,
        must_change_password,privacy_consent_at,privacy_policy_version)
        VALUES (?,?,?,'Synthetic','Staging','ACTIVE',0,CURRENT_TIMESTAMP,'2026-09-25')`)
        .run(login, bcrypt.hashSync(password, 12), role);
    }
    db.prepare(`INSERT INTO tasks (title,creator_id,status) VALUES ('STAGING synthetic task',
      (SELECT id FROM users WHERE login='stage-admin'),'OPEN')`).run();
  })();
  const check = db.pragma('integrity_check', { simple: true });
  if (check !== 'ok') throw new Error('Synthetic SQLite integrity check failed');
  fs.writeFileSync(`${STATE}/synthetic-accounts.json`, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
  console.log('Synthetic staging initialized: integrity_check OK; credentials saved privately, not logged.');
} finally { db.close(); }
