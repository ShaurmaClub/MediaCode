#!/usr/bin/env node
/**
 * Утилита проверки и применения миграций БД SQLite.
 * Использование:
 *   node server/migrate.js --verify
 *   node server/migrate.js --verify-rollback
 */
import fs from 'fs';
import dotenv from 'dotenv';

if (process.env.ENV_FILE && fs.existsSync(process.env.ENV_FILE)) {
  dotenv.config({ path: process.env.ENV_FILE, quiet: true });
} else {
  dotenv.config({ quiet: true });
}

const { default: db, getSchemaState } = await import('./db.js');

try {
  const integrity = db.pragma('quick_check', { simple: true });
  if (integrity !== 'ok') {
    console.error(`❌ [MIGRATE] Ошибка целостности БД (PRAGMA quick_check): ${integrity}`);
    process.exit(1);
  }

  const state = getSchemaState(db);
  if (!state.compatible) {
    console.error('❌ [MIGRATE] Схема БД несовместима с текущей версией приложения:', JSON.stringify(state));
    process.exit(2);
  }

  // Принудительный checkpoint WAL, чтобы все изменения схемы были гарантированно сброшены на диск
  db.pragma('wal_checkpoint(PASSIVE)');

  console.log(
    `✅ [MIGRATE] Схема БД v${state.schemaVersion} (ожидалась v${state.expectedSchemaVersion}, миграций: ${state.migrationsCount}) совместима и проверена.`
  );
  db.close();
  process.exit(0);
} catch (err) {
  console.error('❌ [MIGRATE] Критическая ошибка миграции БД:', err.message);
  process.exit(1);
}
