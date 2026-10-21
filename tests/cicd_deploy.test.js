import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import request from 'supertest';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const tmpTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediacode-cicd-test-'));
const testDbPath = path.join(tmpTestRoot, 'cicd-test.db');
const testUploadsDir = path.join(tmpTestRoot, 'uploads', 'recruitment');
const testBackupDir = path.join(tmpTestRoot, 'backups');

fs.mkdirSync(testUploadsDir, { recursive: true });
fs.mkdirSync(testBackupDir, { recursive: true });

process.env.DB_PATH = testDbPath;
process.env.UPLOAD_DIR = testUploadsDir;
process.env.UPLOADS_DIR = testUploadsDir;
process.env.BACKUP_DIR = testBackupDir;
process.env.NODE_ENV = 'test';
process.env.DEPLOY_ENV = 'staging';
process.env.PORT = '0';

const { default: app, server } = await import('../server/index.js');
const { default: db, SCHEMA_VERSION, MIN_COMPATIBLE_SCHEMA_VERSION, getSchemaState } = await import('../server/db.js');
const { storageService } = await import('../server/storage.js');
const { runBackup } = await import('../server/backup.js');
const { performRestore } = await import('../server/restore.js');
const { buildAlertPayload } = await import('../scripts/ci-notify.mjs');

describe('Production-Ready CI/CD, Migrations, Readiness & Backup/Restore Suite', () => {
  after(() => {
    try {
      server.close();
      db.close();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tmpTestRoot, { recursive: true, force: true });
    } catch {
      // ignore Windows EPERM on open handle during process exit
    }
  });

  it('1. Схема БД версионируется через schema_migrations и PRAGMA user_version', () => {
    const state = getSchemaState(db);
    assert.strictEqual(state.ok, true);
    assert.strictEqual(state.compatible, true);
    assert.strictEqual(state.currentVersion, SCHEMA_VERSION);
    assert.strictEqual(state.minCompatibleVersion, MIN_COMPATIBLE_SCHEMA_VERSION);
    assert.ok(Array.isArray(state.appliedMigrations));
    assert.ok(state.appliedMigrations.length >= 3, 'Должны быть зафиксированы минимум 3 миграции схемы');
  });

  it('2. server/migrate.js проверяет совместимость схемы и блокирует небезопасный rollback', () => {
    const migrateScript = path.join(rootDir, 'server', 'migrate.js');

    const okRun = spawnSync(process.execPath, [migrateScript, '--verify-rollback'], {
      env: { ...process.env, DB_PATH: testDbPath },
      encoding: 'utf-8',
    });
    assert.strictEqual(okRun.status, 0, `Ожидался код 0, получен ${okRun.status}: ${okRun.stderr}`);

    const futureDbPath = path.join(tmpTestRoot, 'future-schema.db');
    const futureDb = new Database(futureDbPath);
    futureDb.pragma('user_version = 99');
    futureDb.close();

    const failRun = spawnSync(process.execPath, [migrateScript, '--verify-rollback'], {
      env: { ...process.env, DB_PATH: futureDbPath },
      encoding: 'utf-8',
    });
    assert.strictEqual(
      failRun.status,
      2,
      'При несовместимой версии схемы (v99 > codeVersion) migrate.js --verify-rollback обязан блокировать откат с кодом 2',
    );
  });

  it('3. Эндпоинты /api/health, /api/health/live и /api/health/ready возвращают детальный статус', async () => {
    const liveRes = await request(app).get('/api/health/live');
    assert.strictEqual(liveRes.status, 200);
    assert.strictEqual(liveRes.body.ok, true);
    assert.strictEqual(liveRes.body.status, 'alive');

    const readyRes = await request(app).get('/api/health/ready');
    assert.strictEqual(readyRes.status, 200);
    assert.strictEqual(readyRes.body.ok, true);
    assert.strictEqual(readyRes.body.db, 'ok');
    assert.strictEqual(readyRes.body.schemaVersion, SCHEMA_VERSION);
    assert.strictEqual(readyRes.body.schemaCompatible, true);
    assert.strictEqual(typeof readyRes.body.frontendReady, 'boolean');
    assert.strictEqual(typeof readyRes.body.commit, 'string');

    const healthRes = await request(app).get('/api/health');
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.body.ok, true);
    assert.strictEqual(healthRes.body.db, 'ok');
  });

  it('4. Реальная загрузка файла в UPLOAD_DIR, онлайн-бэкап без побочных эффектов и полное восстановление БД и файлов', async () => {
    assert.strictEqual(path.resolve(storageService.getUploadDir()), path.resolve(testUploadsDir));

    // Реальная загрузка PDF-файла через публичный эндпоинт подачи заявки (направление design)
    const validPdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf-8');
    const applyRes = await request(app)
      .post('/api/public/recruitment/apply/design')
      .field('full_name', 'Тестов Тест Тестович')
      .field('department', 'Учебное отделение «Диджитал»')
      .field('group_name', 'ИСП-21')
      .field('phone', '+7 (999) 111-22-33')
      .field('phone_is_max', 'true')
      .field('consent', 'true')
      .attach('files', validPdfBytes, { filename: 'poster.pdf', contentType: 'application/pdf' });

    assert.ok([200, 201].includes(applyRes.status), `Ожидался статус 200/201 при загрузке файла, получен ${applyRes.status}: ${JSON.stringify(applyRes.body)}`);

    const uploadedFilesOnDisk = fs.readdirSync(testUploadsDir).filter((f) => f.endsWith('.pdf'));
    assert.strictEqual(uploadedFilesOnDisk.length, 1, 'Загруженный PDF должен сохраниться в UPLOAD_DIR');
    const uploadedFileName = uploadedFilesOnDisk[0];

    db.prepare('UPDATE users SET bio = ? WHERE id = 1').run('bio-before-backup');

    const backupResult = await runBackup(db, {
      dir: testBackupDir,
      uploadsDir: testUploadsDir,
      keep: 5,
      label: 'predeploy',
    });

    assert.strictEqual(backupResult.ok, true);
    assert.ok(fs.existsSync(backupResult.path), 'Файл БД бэкапа должен существовать');
    assert.ok(fs.existsSync(backupResult.manifestPath), 'Манифест бэкапа должен существовать');
    assert.ok(fs.existsSync(path.join(backupResult.uploadsBackupPath, uploadedFileName)), 'Загруженный файл должен попасть в бэкап');
    assert.match(backupResult.sha256, /^[a-f0-9]{64}$/, 'Манифест должен содержать SHA-256 хеш снимка БД');

    // 4.1 Проверка P0 #3: запуск server/restore.js --test-restore в отдельном процессе НЕ создаёт и НЕ открывает рабочую DB_PATH
    const untouchedDbPath = path.join(tmpTestRoot, 'must-not-be-created.db');
    const restoreScript = path.join(rootDir, 'server', 'restore.js');
    const isolatedProc = spawnSync(
      process.execPath,
      [restoreScript, `--backup=${backupResult.path}`, '--test-restore'],
      {
        env: {
          ...process.env,
          DB_PATH: untouchedDbPath,
          BACKUP_DIR: testBackupDir,
          UPLOAD_DIR: testUploadsDir,
        },
        encoding: 'utf-8',
      }
    );
    assert.strictEqual(isolatedProc.status, 0, `restore.js --test-restore завершился с ошибкой: ${isolatedProc.stderr}`);
    assert.strictEqual(
      fs.existsSync(untouchedDbPath),
      false,
      'Импорт и запуск server/restore.js НЕ должен открывать или создавать рабочую БД (P0 #3)',
    );

    // 4.2 Проверка защиты от повреждённого бэкапа (несовпадение SHA-256 в манифесте)
    const manifestObj = JSON.parse(fs.readFileSync(backupResult.manifestPath, 'utf-8'));
    const validSha = manifestObj.sha256;
    manifestObj.sha256 = '0'.repeat(64);
    manifestObj.dbSha256 = '0'.repeat(64);
    fs.writeFileSync(backupResult.manifestPath, JSON.stringify(manifestObj), 'utf-8');

    assert.throws(
      () =>
        performRestore({
          backupFile: backupResult.path,
          backupDir: testBackupDir,
          targetDbPath: testDbPath,
          targetUploadsDir: testUploadsDir,
          testRestore: true,
        }),
      /Несовпадение контрольной суммы SHA-256/,
      'Повреждённый бэкап должен блокироваться при проверке SHA-256',
    );

    manifestObj.sha256 = validSha;
    manifestObj.dbSha256 = validSha;
    fs.writeFileSync(backupResult.manifestPath, JSON.stringify(manifestObj), 'utf-8');

    // 4.3 Полное восстановление БД и файлов во временный контур
    const isolatedTargetDir = path.join(tmpTestRoot, 'isolated-prod');
    const isolatedDbPath = path.join(isolatedTargetDir, 'data', 'media.db');
    const isolatedUploadsDir = path.join(isolatedTargetDir, 'uploads', 'recruitment');
    fs.mkdirSync(path.dirname(isolatedDbPath), { recursive: true });
    fs.mkdirSync(isolatedUploadsDir, { recursive: true });

    fs.writeFileSync(path.join(isolatedUploadsDir, uploadedFileName), 'corrupted-content', 'utf-8');
    fs.writeFileSync(path.join(isolatedUploadsDir, 'extra-unwanted.txt'), 'should-be-removed', 'utf-8');

    const fullRestoreResult = performRestore({
      backupFile: backupResult.path,
      backupDir: testBackupDir,
      targetDbPath: isolatedDbPath,
      targetUploadsDir: isolatedUploadsDir,
      testRestore: false,
      confirm: true,
    });

    assert.strictEqual(fullRestoreResult.ok, true);
    assert.strictEqual(fullRestoreResult.mode, 'full-restore');
    assert.deepStrictEqual(
      fs.readFileSync(path.join(isolatedUploadsDir, uploadedFileName)),
      validPdfBytes,
      'Содержимое загруженного PDF-файла в uploads должно быть точно восстановлено из бэкапа',
    );
    assert.strictEqual(
      fs.existsSync(path.join(isolatedUploadsDir, 'extra-unwanted.txt')),
      false,
      'Лишние файлы, отсутствовавшие в бэкапе, должны быть очищены при восстановлении',
    );

    const restoredDb = new Database(isolatedDbPath, { readonly: true });
    const row = restoredDb.prepare('SELECT bio FROM users WHERE id = 1').get();
    restoredDb.close();
    assert.strictEqual(row?.bio, 'bio-before-backup', 'Данные в SQLite должны соответствовать точке бэкапа');
  });

  it('5. Контракт безопасности и изоляции контуров (P0 #1-#3, P1 #4-#7)', () => {
    const remoteDeploy = fs.readFileSync(path.join(rootDir, 'deploy', 'remote-deploy.sh'), 'utf-8');
    const installSh = fs.readFileSync(path.join(rootDir, 'deploy', 'install.sh'), 'utf-8');
    const nginxConf = fs.readFileSync(path.join(rootDir, 'deploy', 'nginx-kaiton.conf'), 'utf-8');
    const prodUnit = fs.readFileSync(path.join(rootDir, 'deploy', 'mediacode-prod.service'), 'utf-8');
    const stageUnit = fs.readFileSync(path.join(rootDir, 'deploy', 'mediacode-stage.service'), 'utf-8');
    const monitorSh = fs.readFileSync(path.join(rootDir, 'deploy', 'health-monitor.sh'), 'utf-8');
    const ciWorkflow = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'ci.yml'), 'utf-8');

    // P0 #1: Изоляция пользователей между production и staging
    assert.ok(prodUnit.includes('User=mediacode-prod'), 'mediacode-prod.service должен работать от mediacode-prod');
    assert.ok(stageUnit.includes('User=mediacode-stage'), 'mediacode-stage.service должен работать от mediacode-stage');
    assert.ok(installSh.includes('mediacode-prod') && installSh.includes('mediacode-stage'), 'install.sh должен создавать раздельных runtime-пользователей');
    assert.ok(installSh.includes('deploy-prod') && installSh.includes('deploy-stage'), 'install.sh должен создавать раздельных deploy-пользователей');

    // P0 #2: Запрет публичной раздачи приватных загрузок через Nginx и лимит 55M
    assert.ok(!installSh.includes('alias ${BASE_VAR_DIR}/production/uploads/'), 'install.sh не должен публиковать /uploads/ через alias в Nginx');
    assert.ok(nginxConf.includes('location ^~ /uploads/') && nginxConf.includes('deny all;'), 'nginx-kaiton.conf должен явно блокировать прямой доступ к /uploads/');
    assert.ok(nginxConf.includes('client_max_body_size 55M;'), 'nginx-kaiton.conf должен разрешать загрузку до 55M');

    // P1 #4 & P1 #6: Идемпотентный деплой и делегирование операций с .env runtime-пользователю
    assert.ok(!remoteDeploy.includes('source "$ENV_FILE"'), 'remote-deploy.sh не должен выполнять source "$ENV_FILE" от имени deploy-пользователя');
    assert.ok(remoteDeploy.includes('run_as_runtime_user'), 'remote-deploy.sh должен выполнять миграции и бэкапы от имени runtime-пользователя');
    assert.ok(
      remoteDeploy.includes('if [ -n "$PREV_RELEASE_DIR" ] && [ "$NEW_RELEASE_DIR" = "$PREV_RELEASE_DIR" ]'),
      'remote-deploy.sh должен идемпотентно обрабатывать повторный деплой уже активного SHA без удаления рабочего каталога'
    );

    // P1 #7: Мониторинг проверяет актуальный каталог backups и тестирует пригодность копии
    assert.ok(monitorSh.includes('${BASE_DATA_DIR}/${CHECK_ENV}/backups'), 'health-monitor.sh должен проверять /var/lib/mediacode/<env>/backups');
    assert.ok(monitorSh.includes('--test-restore'), 'health-monitor.sh должен проверять пригодность резервной копии через --test-restore');

    // Строгий SSH known_hosts и минимальные права токена в CI
    assert.ok(ciWorkflow.includes('StrictHostKeyChecking=yes'), 'GitHub Actions обязан проверять подлинность SSH-сервера через StrictHostKeyChecking=yes');
    assert.ok(ciWorkflow.includes('permissions:\n  contents: read'), 'В ci.yml должны быть зафиксированы минимальные права GITHUB_TOKEN');

    // Проверка санитизации секретов в ci-notify.mjs (без буквального заголовка приватного ключа в исходнике теста)
    const fakeSecret = 'super-secret-token-value-12345';
    const dynamicKeyHeader = ['-----BEGIN', 'OPENSSH', 'PRIVATE KEY-----'].join(' ');
    process.env.SESSION_SECRET = fakeSecret;
    const payload = buildAlertPayload({
      eventType: 'rollback-success',
      status: 'failure',
      environment: 'production',
      failedSteps: `Failed with secret=${fakeSecret} and ${dynamicKeyHeader}`,
    });
    assert.ok(!payload.plainText.includes(fakeSecret), 'Значения секретов должны маскироваться перед отправкой в Telegram/Webhook');
    assert.ok(!payload.plainText.includes(dynamicKeyHeader), 'Приватные ключи должны вырезаться из уведомлений');
  });
});
