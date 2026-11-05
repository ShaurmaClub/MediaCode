// Validate before importing db.js (which initializes/migrates its configured DB).
export const STATE = '/var/lib/mediacode/staging';
export function validateStaging(env) {
  const expected = {
    APP_ENV: 'staging', NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '4001',
    DB_PATH: `${STATE}/data/media.db`, UPLOAD_DIR: `${STATE}/uploads/recruitment`,
    DOTENV_CONFIG_PATH: '/dev/null',
  };
  for (const [name, value] of Object.entries(expected)) {
    if (env[name] !== value) throw new Error(`Staging configuration rejected: ${name}`);
  }
  if (!/^[a-f0-9]{64}$/.test(env.SESSION_SECRET || '')) throw new Error('Staging session secret rejected');
  if (env.MAX_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || env.ALERT_WEBHOOK_URL) {
    throw new Error('External notification credentials forbidden in initial staging');
  }
}
