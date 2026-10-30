/**
 * Единая декларация версии схемы SQLite и списка обязательных таблиц.
 * Модуль не открывает соединение с БД при импорте (без побочных эффектов),
 * поэтому безопасно используется в server/restore.js, server/migrate.js и server/db.js.
 */

export const SCHEMA_VERSION = 3;
export const MIN_COMPATIBLE_SCHEMA_VERSION = 2;

export const ORDERED_MIGRATIONS = [
  { version: 1, name: 'v1_initial_core_tables', backwardCompatible: 1 },
  { version: 2, name: 'v2_consent_max_and_completion_triggers', backwardCompatible: 1 },
  { version: 3, name: 'v3_application_versions_and_resubmission', backwardCompatible: 1 },
];

export const REQUIRED_TABLES = [
  'users',
  'tasks',
  'applications',
  'application_versions',
  'points',
  'notifications',
  'audit_logs',
  'recruitment_tracks',
  'recruitment_applications',
  'schema_migrations',
];

export function inspectSchemaState(targetDb) {
  const existing = new Set(
    targetDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name)
  );
  const missingTables = REQUIRED_TABLES.filter((t) => !existing.has(t));
  const userVersion = Number(targetDb.pragma('user_version', { simple: true }) || 0);
  const migrations = existing.has('schema_migrations')
    ? targetDb
        .prepare('SELECT version, name, backward_compatible, applied_at FROM schema_migrations ORDER BY version ASC')
        .all()
    : [];
  const latestMigration = migrations.length ? migrations[migrations.length - 1].version : 0;
  const effectiveVersion = Math.max(userVersion, latestMigration);

  const futureMigrations = migrations.filter((m) => m.version > SCHEMA_VERSION);
  const futureIncompatible =
    futureMigrations.some((m) => Number(m.backward_compatible) === 0) ||
    (userVersion > SCHEMA_VERSION && futureMigrations.length === 0);

  const compatible =
    missingTables.length === 0 &&
    effectiveVersion >= MIN_COMPATIBLE_SCHEMA_VERSION &&
    !futureIncompatible;

  return {
    ok: compatible,
    schemaVersion: effectiveVersion,
    currentVersion: effectiveVersion,
    expectedSchemaVersion: SCHEMA_VERSION,
    minCompatibleVersion: MIN_COMPATIBLE_SCHEMA_VERSION,
    compatible,
    missingTables,
    migrationsCount: migrations.length,
    appliedMigrations: migrations,
  };
}
