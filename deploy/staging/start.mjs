import fs from 'node:fs';
import { validateStaging, STATE } from './config.mjs';
validateStaging(process.env);
if (!process.getuid || process.getuid() === 0 || fs.statSync(STATE).uid !== process.getuid()) {
  throw new Error('Run as staging state owner, never root');
}
for (const path of [STATE, `${STATE}/data`, process.env.DB_PATH, `${STATE}/uploads`, process.env.UPLOAD_DIR]) {
  if (fs.realpathSync(path) !== path) throw new Error('Staging state path redirected');
}
const commit = fs.readFileSync(new URL('../../.release-sha', import.meta.url), 'utf8').trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Staging release SHA missing');
process.env.APP_COMMIT = commit;
await import('../../server/index.js');
