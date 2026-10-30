#!/usr/bin/env node
/**
 * Утилита проверки и применения миграций БД SQLite.
 * Использование:
 *   node server/migrate.js --verify
 *   node server/migrate.js --verify-rollback
 */
import fs from 'fs';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { inspectSchemaState } from './config/schema.js';

if (process.env.ENV_FILE && fs.existsSync(process.env.ENV_FILE)) {
  dotenv.config({ path: process.env.ENV_FILE, quiet: true });
} else {
  dotenv.config({ quiet: true });
}

// Rollback inspection must not import db.js: importing it applies migrations.
const rollbackCheck = process.argv.includes('--verify-rollback');
const migrationModule = rollbackCheck ? null : await import('./db.js');
const db = rollbackCheck
  ? new Database(process.env.DB_PATH || './data/media.db', { readonly: true, fileMustExist: true })
  : migrationModule.default;
const getSchemaState = rollbackCheck ? inspectSchemaState : migrationModule.getSchemaState;

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
  if (!rollbackCheck) db.pragma('wal_checkpoint(PASSIVE)');

  console.log(
    `✅ [MIGRATE] Схема БД v${state.schemaVersion} (ожидалась v${state.expectedSchemaVersion}, миграций: ${state.migrationsCount}) совместима и проверена.`
  );
  db.close();
  process.exit(0);
} catch (err) {
  console.error('❌ [MIGRATE] Критическая ошибка миграции БД:', err.message);
  process.exit(1);
}
