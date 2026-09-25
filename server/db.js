import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const file = process.env.DB_PATH || (process.env.NODE_ENV === 'test' ? ':memory:' : './data/media.db');
if (file !== ':memory:') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

const db = new Database(file);
if (file !== ':memory:') {
  db.pragma('journal_mode = WAL');
}
db.pragma('foreign_keys = ON');

import { DEPARTMENTS } from './config/departments.js';
import { RECRUITMENT_TRACKS } from './config/recruitmentTracks.js';
export { DEPARTMENTS, RECRUITMENT_TRACKS };

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN','STAFF','STUDENT')),
    first_name TEXT,
    last_name TEXT,
    middle_name TEXT,
    email TEXT,
    group_name TEXT,
    department TEXT,
    year INTEGER,
    bio TEXT,
    phone TEXT,
    max_contact TEXT,
    skills TEXT,
    status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PENDING_ACTIVATION','PENDING_APPROVAL','REJECTED','DISABLED')),
    theme TEXT DEFAULT 'system' CHECK(theme IN ('light','dark','system','violet','red')),
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    max_user_id INTEGER,
    max_username TEXT,
    max_contact_verified INTEGER DEFAULT 0,
    phone_verified INTEGER DEFAULT 0,
    must_change_password INTEGER DEFAULT 0,
    activation_token TEXT,
    activation_expires_at TEXT,
    privacy_consent_at TEXT DEFAULT NULL,
    privacy_policy_version TEXT DEFAULT NULL,
    privacy_consent_source TEXT DEFAULT NULL,
    activation_attempts INTEGER DEFAULT 0,
    activation_locked_until TEXT DEFAULT NULL
  );

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  creator_id INTEGER,
  event_date TEXT,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  required_volunteers INTEGER DEFAULT 1,
  skills TEXT,
  points INTEGER DEFAULT 0,
  priority TEXT DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),
  deadline TEXT,
  status TEXT DEFAULT 'OPEN' CHECK(status IN ('DRAFT','OPEN','ASSIGNMENT_IN_PROGRESS','COMPLETED','CANCELLED','ARCHIVED')),
  equipment TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(creator_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  user_id INTEGER,
  status TEXT DEFAULT 'APPLIED' CHECK(status IN ('APPLIED','SELECTED','REJECTED','WITHDRAWN','IN_PROGRESS','COMPLETION_SUBMITTED','COMPLETED','NO_SHOW')),
  comment TEXT,
  submission_notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, user_id),
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  category TEXT DEFAULT 'OTHER',
  task_id INTEGER,
  issued_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY(issued_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS recruitment_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  materials_url TEXT,
  deadline TEXT,
  is_open INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recruitment_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT UNIQUE NOT NULL,
  track_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  department TEXT NOT NULL,
  group_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  max_contact TEXT,
  portfolio_url TEXT,
  submission_url TEXT,
  submission_text TEXT,
  comment TEXT,
  status TEXT DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','IN_REVIEW','APPROVED','REJECTED','WITHDRAWN')),
  consent_version TEXT DEFAULT '1.0',
  consent_accepted_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by INTEGER,
  student_user_id INTEGER,
  FOREIGN KEY(track_id) REFERENCES recruitment_tracks(id) ON DELETE CASCADE,
  FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(student_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS recruitment_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(application_id) REFERENCES recruitment_applications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(event_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_points_user ON points(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_task ON applications(task_id);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_recruitment_track ON recruitment_applications(track_id);
CREATE INDEX IF NOT EXISTS idx_recruitment_status ON recruitment_applications(status);
`);

// Safe column migrations
function ensureColumn(table, colName, colDef) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
    }
  } catch (err) {
    console.error(`Migration error adding ${colName} to ${table}:`, err.message);
  }
}

ensureColumn('users', 'skills', 'TEXT');

// Safe check constraint migration for themes
function migrateThemeCheck() {
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (tableInfo && tableInfo.sql.includes("CHECK(theme IN ('light','dark','system'))")) {
      console.log('Migrating users table theme constraint...');
      db.exec('PRAGMA foreign_keys=OFF;');
      db.transaction(() => {
        const newSql = tableInfo.sql
          .replace('CREATE TABLE users', 'CREATE TABLE users_new')
          .replace("CHECK(theme IN ('light','dark','system'))", "CHECK(theme IN ('light','dark','system','violet','red'))");
        db.exec(newSql);
        
        // Find columns to insert correctly
        const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name).join(', ');
        db.exec(`INSERT INTO users_new (${cols}) SELECT ${cols} FROM users`);
        db.exec('DROP TABLE users');
        db.exec('ALTER TABLE users_new RENAME TO users');
      })();
      db.exec('PRAGMA foreign_keys=ON;');
    }
  } catch (err) {
    console.error('Migration error for themes:', err.message);
  }
}
migrateThemeCheck();

// SQLite cannot alter CHECK constraints. This one-time, transactional rebuild only
// expands the allowed account states and preserves every existing column and row.
function migrateUserStatusCheck() {
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!tableInfo?.sql || tableInfo.sql.includes("'PENDING_APPROVAL'")) return;
  const oldCheck = "CHECK(status IN ('ACTIVE','PENDING_ACTIVATION','DISABLED'))";
  const newCheck = "CHECK(status IN ('ACTIVE','PENDING_ACTIVATION','PENDING_APPROVAL','REJECTED','DISABLED'))";
  if (!tableInfo.sql.includes(oldCheck)) throw new Error('Unknown users.status constraint; refusing migration');
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.transaction(() => {
      db.exec(tableInfo.sql.replace('CREATE TABLE users', 'CREATE TABLE users_status_migration').replace(oldCheck, newCheck));
      const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name).join(', ');
      db.exec(`INSERT INTO users_status_migration (${columns}) SELECT ${columns} FROM users`);
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_status_migration RENAME TO users');
    })();
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}
migrateUserStatusCheck();

ensureColumn('users', 'middle_name', 'TEXT');
ensureColumn('users', 'department', 'TEXT');
ensureColumn('users', 'phone', 'TEXT');
ensureColumn('users', 'max_contact', 'TEXT');
ensureColumn('users', 'must_change_password', 'INTEGER DEFAULT 0');
ensureColumn('users', 'max_user_id', 'TEXT');
ensureColumn('users', 'max_username', 'TEXT');
ensureColumn('users', 'max_contact_verified', 'INTEGER DEFAULT 0');
ensureColumn('users', 'phone_verified', 'INTEGER DEFAULT 0');
  ensureColumn('users', 'privacy_consent_at', 'TEXT DEFAULT NULL');
  ensureColumn('users', 'privacy_policy_version', 'TEXT DEFAULT NULL');
  ensureColumn('users', 'privacy_consent_source', 'TEXT DEFAULT NULL');
  ensureColumn('recruitment_applications', 'privacy_consent_source', 'TEXT DEFAULT NULL');
  ensureColumn('users', 'activation_attempts', 'INTEGER DEFAULT 0');
  ensureColumn('users', 'activation_locked_until', 'TEXT DEFAULT NULL');
ensureColumn('users', 'activation_expires_at', 'TEXT DEFAULT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_max_user_id_unique ON users(max_user_id) WHERE max_user_id IS NOT NULL');
ensureColumn('tasks', 'updated_at', 'TEXT');
ensureColumn('tasks', 'end_time', 'TEXT');
ensureColumn('tasks', 'equipment', 'TEXT');
ensureColumn('tasks', 'notes', 'TEXT');
ensureColumn('applications', 'submission_notes', 'TEXT');
ensureColumn('applications', 'updated_at', 'TEXT');
ensureColumn('recruitment_applications', 'student_user_id', 'INTEGER');
ensureColumn('recruitment_applications', 'submission_text', 'TEXT');
ensureColumn('recruitment_tracks', 'submission_mode', 'TEXT DEFAULT "DEFAULT"');
ensureColumn('tasks', 'roles_needed', 'TEXT');
ensureColumn('tasks', 'location_type', 'TEXT');
ensureColumn('tasks', 'custom_category', 'TEXT');
ensureColumn('applications', 'role_name', 'TEXT');
ensureColumn('points', 'reversal_of_id', 'INTEGER');
ensureColumn('points', 'reversal_reason', 'TEXT');
ensureColumn('points', 'is_reversed', 'INTEGER DEFAULT 0');

// Ensure canonical recruitment tracks materials URLs
db.exec(`
  UPDATE recruitment_tracks
  SET materials_url = 'https://disk.360.yandex.ru/d/SGu5txgr6xDnZw'
  WHERE slug = 'montage';
`);

// MIGRATIONS BLOCK
const recTableInfo = db.prepare('PRAGMA table_info(recruitment_applications)').all();
const maxContactCol = recTableInfo.find(c => c.name === 'max_contact');
if (maxContactCol && maxContactCol.notnull === 1) {
  db.exec(`
    PRAGMA foreign_keys=off;
    BEGIN TRANSACTION;
    ALTER TABLE recruitment_applications RENAME TO _recruitment_applications_old;
    CREATE TABLE recruitment_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT UNIQUE NOT NULL,
      track_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      department TEXT NOT NULL,
      group_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      max_contact TEXT,
      portfolio_url TEXT,
      submission_url TEXT,
      submission_text TEXT,
      comment TEXT,
      status TEXT DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','IN_REVIEW','APPROVED','REJECTED','WITHDRAWN')),
      consent_version TEXT DEFAULT '1.0',
      consent_accepted_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewed_by INTEGER,
      student_user_id INTEGER,
      admin_resubmission_allowed INTEGER DEFAULT 0,
      FOREIGN KEY(track_id) REFERENCES recruitment_tracks(id) ON DELETE CASCADE,
      FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(student_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
      INSERT INTO recruitment_applications (id, public_id, track_id, full_name, department, group_name, phone, max_contact, portfolio_url, submission_url, submission_text, comment, status, consent_version, consent_accepted_at, privacy_consent_source, created_at, reviewed_at, reviewed_by, student_user_id, admin_resubmission_allowed) SELECT id, public_id, track_id, full_name, department, group_name, phone, max_contact, portfolio_url, submission_url, submission_text, comment, status, consent_version, consent_accepted_at, privacy_consent_source, created_at, reviewed_at, reviewed_by, student_user_id, 0 FROM _recruitment_applications_old;
    DROP TABLE _recruitment_applications_old;
    COMMIT;
    PRAGMA foreign_keys=on;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS application_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    version_number INTEGER NOT NULL,
    materials_url TEXT,
    file_path TEXT,
    comment TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
  );
`);

try {
  db.prepare('SELECT activation_token FROM users LIMIT 1').get();
} catch(e) {
  db.exec('ALTER TABLE users ADD COLUMN activation_token TEXT;');
}

try {
  db.prepare('SELECT admin_resubmission_allowed FROM recruitment_applications LIMIT 1').get();
} catch(e) {
  db.exec('ALTER TABLE recruitment_applications ADD COLUMN admin_resubmission_allowed INTEGER DEFAULT 0;');
}
// END MIGRATIONS BLOCK

export function seed() {
  const usersCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const pw = bcrypt.hashSync('Demo123!', 10);
  let adminId = 1;
  let staffId = 2;
  const studentIds = { student: 3, anna: 4, dmitry: 5, sofia: 6 };

  if (usersCount === 0) {
    const insUser = db.prepare(`
      INSERT INTO users (login, password_hash, role, first_name, last_name, email, group_name, year, bio, skills, phone, max_contact, privacy_consent_at, privacy_policy_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, '2026-09')
    `);

    adminId = insUser.run(
      'admin', pw, 'ADMIN', 'Мария', 'Соколова', 'admin@college.local',
      null, null, 'Главный администратор медиацентра', 'Координация, Управление, Архитектура медиа',
      '+79001002030', 'mariasokol'
    ).lastInsertRowid;

    staffId = insUser.run(
      'staff', pw, 'STAFF', 'Алексей', 'Волков', 'staff@college.local',
      null, null, 'Сотрудник медиацентра и студенческих проектов', 'Продюсирование, Видеопроизводство, Фотография',
      '+79002003040', 'alex_volkov'
    ).lastInsertRowid;

    const students = [
      ['student', 'Иван', 'Петров', 'media-21', 2, 'Фотограф и видеограф, люблю репортажную съёмку и портреты.', 'Фотография, Видеосъёмка, Свет, Lightroom', '+79161234567', 'ivan_petrov'],
      ['anna', 'Анна', 'Кузнецова', 'media-22', 1, 'SMM-специалист и графический дизайнер, веду соцсети колледжа.', 'SMM, Копирайтинг, Figma, Дизайн постов', '+79162345678', 'anna_kuzn'],
      ['dmitry', 'Дмитрий', 'Орлов', 'media-21', 2, 'Видеомонтажёр и звукорежиссёр, работаю в Premiere и After Effects.', 'Монтаж видео, Звук, Premiere Pro, Цветокоррекция', '+79163456789', 'dmitry_edit'],
      ['sofia', 'София', 'Морозова', 'media-23', 1, 'Журналист и интервьюер, автор статей для студенческого портала.', 'Интервью, Репортажи, Текст, Ораторское мастерство', '+79164567890', 'sofia_media']
    ];

    students.forEach(s => {
      const res = insUser.run(s[0], pw, 'STUDENT', s[1], s[2], `${s[0]}@college.local`, s[3], s[4], s[5], s[6], s[7], s[8]);
      studentIds[s[0]] = res.lastInsertRowid;
    });
  }

  // Recruitment Tracks - UPSERT ensures all 6 tracks exist and stay updated
  const upsertTrack = db.prepare(`
    INSERT INTO recruitment_tracks (slug, name, type, title, description, instructions, materials_url, submission_mode, deadline, is_open)
    VALUES (@slug, @name, @type, @title, @description, @instructions, @materials_url, @submission_mode, @deadline, @is_open)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      title = excluded.title,
      description = excluded.description,
      instructions = excluded.instructions,
      materials_url = excluded.materials_url,
      submission_mode = excluded.submission_mode,
      deadline = excluded.deadline,
      is_open = excluded.is_open
  `);

  for (const t of RECRUITMENT_TRACKS) {
    upsertTrack.run(t);
  }

  // Update existing applications with old demo departments to new official names
  db.exec(`
    UPDATE recruitment_applications SET department = 'Учебное отделение «Моссовет»' WHERE department LIKE '%МосСовет%' OR department LIKE '%Моссовет%' OR department = 'Отделение аудиовизуальных технологий';
    UPDATE recruitment_applications SET department = 'Учебное отделение «Датахаб»' WHERE department LIKE '%Виджев%' OR department LIKE '%БТХаб%' OR department LIKE '%Дата%' OR department LIKE '%Data%';
    UPDATE recruitment_applications SET department = 'Учебное отделение «Техно»' WHERE department LIKE '%Техно%' OR department = 'Отделение информационных технологий';
    UPDATE recruitment_applications SET department = 'Учебное отделение «АртТех»' WHERE department LIKE '%Артех%' OR department LIKE '%АртТех%';
    UPDATE recruitment_applications SET department = 'Учебное отделение «Кибер»' WHERE department LIKE '%Кибер%';
    UPDATE recruitment_applications SET department = 'Учебное отделение «Диджитал»' WHERE department LIKE '%Диджитал%';

    UPDATE users SET department = 'Учебное отделение «Датахаб»' WHERE department LIKE '%Виджев%' OR department LIKE '%БТХаб%' OR department LIKE '%Дата%' OR department LIKE '%Data%';
    UPDATE users SET department = 'Учебное отделение «Моссовет»' WHERE department LIKE '%МосСовет%' OR department LIKE '%Моссовет%';
    UPDATE users SET department = 'Учебное отделение «Техно»' WHERE department LIKE '%Техно%';
    UPDATE users SET department = 'Учебное отделение «АртТех»' WHERE department LIKE '%Артех%' OR department LIKE '%АртТех%';
    UPDATE users SET department = 'Учебное отделение «Кибер»' WHERE department LIKE '%Кибер%';
    UPDATE users SET department = 'Учебное отделение «Диджитал»' WHERE department LIKE '%Диджитал%';
  `);

  const trackRows = db.prepare('SELECT id, slug FROM recruitment_tracks').all();
  const trackMap = Object.fromEntries(trackRows.map(r => [r.slug, r.id]));
  const photoTrackId = trackMap['photo'];
  const videoTrackId = trackMap['video'];
  const designTrackId = trackMap['design'];
  const smmTrackId = trackMap['smm'];

  const recAppCount = db.prepare('SELECT COUNT(*) as c FROM recruitment_applications').get().c;
  if (recAppCount === 0) {
    const insRecApp = db.prepare(`
      INSERT INTO recruitment_applications (public_id, track_id, full_name, department, group_name, phone, max_contact, submission_url, comment, status, consent_accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insRecApp.run(
      'MC-V-0001',
      videoTrackId,
      'Кирилл Романов',
      'Учебное отделение «Моссовет»',
      'МТ-11',
      '+79161112233',
      '+79161112233',
      'https://disk.yandex.ru/d/kirill_test_cut_video',
      'Смонтировал ролик за 3 часа, добавил саунд-дизайн и плавные переходы. Есть камера Sony A6400.',
      'SUBMITTED',
      '2026-09-20 10:15:00'
    );

    insRecApp.run(
      'MC-P-0002',
      photoTrackId,
      'Елизавета Васильева',
      'Учебное отделение «Датахаб»',
      'ГД-21',
      '+79032223344',
      '+79032223344',
      'https://disk.yandex.ru/d/liza_photo_series',
      'Снимаю на Canon RP, есть вспышка и портретный объектив 50mm.',
      'IN_REVIEW',
      '2026-09-20 12:40:00'
    );

    insRecApp.run(
      'MC-D-0003',
      designTrackId,
      'Максим Смирнов',
      'Учебное отделение «Техно»',
      'ИС-12',
      '+79263334455',
      '+79263334455',
      'https://www.figma.com/design/sample_media_poster',
      'Сделал 2 варианта макета афиши: тёмную и светлую тему.',
      'SUBMITTED',
      '2026-09-21 08:30:00'
    );
  }

  // Existing task seed
  const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
  if (taskCount === 0) {
    const insTask = db.prepare(`
      INSERT INTO tasks (title, description, category, creator_id, event_date, start_time, end_time, location, required_volunteers, skills, points, priority, deadline, status, equipment, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

  const t1 = insTask.run(
    'День открытых дверей колледжа',
    'Снять ключевые моменты церемонии, провести экспресс-интервью с абитуриентами и их родителями, подготовить фотобанк для сайта.',
    'Событие',
    staffId,
    '2026-10-05',
    '11:30',
    '16:00',
    'Главный корпус, Актовый зал',
    3,
    'Фотография, Интервью, Репортаж',
    30,
    'HIGH',
    '2026-10-03',
    'OPEN',
    'Камера Sony A7 III, 2 петлички Boya, объектив 24-70mm',
    'Дресс-код: тёмный верх, бейдж волонтёра медиацентра.'
  ).lastInsertRowid;

  const t2 = insTask.run(
    'Монтаж промо-ролика студенческих клубов',
    'Собрать динамичный вертикальный ролик (9:16) для клипов из исходников, отснятых на ярмарке клубов.',
    'Монтаж',
    staffId,
    '2026-10-12',
    '14:00',
    '18:00',
    'Медиалаборатория (ауд. 304)',
    1,
    'Монтаж видео, Premiere Pro, Саунд-дизайн',
    25,
    'NORMAL',
    '2026-10-10',
    'OPEN',
    'Рабочая станция Mac Studio в аудитории 304',
    'Материалы находятся на сервере NAS в папке /Clubs2026.'
  ).lastInsertRowid;

  const t3 = insTask.run(
    'Осенний фотодень первокурсников',
    'Портретная съёмка первокурсников в локациях кампуса для студенческих билетов и доски почёта колледжа.',
    'Фотография',
    staffId,
    '2026-09-28',
    '10:00',
    '15:00',
    'Кампус, Парковая зона',
    2,
    'Фотография, Портретная съёмка, Lightroom',
    20,
    'NORMAL',
    '2026-09-27',
    'OPEN',
    'Отражатель 5-в-1, софтбокс, Canon R6',
    'Отобрать и передать превью до конца дня.'
  ).lastInsertRowid;

  const t4 = insTask.run(
    'Прямой эфир круглого стола с работодателями',
    'Обеспечить многокамерную трансляцию дискуссии в группу колледжа, контроль звука и титров.',
    'Стрим',
    staffId,
    '2026-10-18',
    '13:00',
    '17:00',
    'Конференц-зал',
    2,
    'OBS Studio, Видеомикшер, Звук',
    35,
    'URGENT',
    '2026-10-16',
    'ASSIGNMENT_IN_PROGRESS',
    'Blackmagic ATEM Mini Pro, 3 камеры Panasonic, радиомикрофоны Sennheiser',
    'Генеральный прогон за 1 час до начала трансляции.'
  ).lastInsertRowid;

  const t5 = insTask.run(
    'Дизайн серии афиш для Недели Науки',
    'Создать макеты полиграфических афиш формата А2 и серию баннеров для социальных сетей колледжа.',
    'Дизайн',
    adminId,
    '2026-09-15',
    '10:00',
    '18:00',
    'Дистанционно',
    1,
    'Figma, Illustrator, Типографика',
    20,
    'NORMAL',
    '2026-09-14',
    'COMPLETED',
    'Компьютер с графическим планшетом',
    'Успешно завершено и отправлено в типографию.'
  ).lastInsertRowid;

  const insPoint = db.prepare(`
    INSERT INTO points (user_id, amount, reason, category, task_id, issued_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insPoint.run(studentIds['student'], 40, 'Съёмка приветственной недели', 'EVENT', null, staffId, '2026-09-05 14:30:00');
  insPoint.run(studentIds['student'], 20, 'Дизайн серии афиш для Недели Науки', 'COMPLETION', t5, adminId, '2026-09-15 18:20:00');
  insPoint.run(studentIds['anna'], 50, 'Оформление и ведение канала медиацентра', 'SMM', null, staffId, '2026-09-10 11:00:00');
  insPoint.run(studentIds['anna'], 15, 'Бонус за креативную концепцию рилсов', 'BONUS', null, staffId, '2026-09-12 16:15:00');
  insPoint.run(studentIds['dmitry'], 35, 'Монтаж отчётного ролика об открытии спортзала', 'PHOTO_VIDEO', null, staffId, '2026-09-08 19:40:00');
  insPoint.run(studentIds['sofia'], 25, 'Интервью с победителями олимпиады', 'OTHER', null, staffId, '2026-09-14 17:00:00');

  const insApp = db.prepare(`
    INSERT INTO applications (task_id, user_id, status, comment, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  insApp.run(t1, studentIds['student'], 'APPLIED', 'Готов отснять фоторепортаж и взять интервью!', '2026-09-18 10:00:00');
  insApp.run(t1, studentIds['anna'], 'SELECTED', 'Могу оперативно публиковать материалы в процессе мероприятия.', '2026-09-18 11:15:00');
  insApp.run(t4, studentIds['dmitry'], 'SELECTED', 'Опыт работы с ATEM Mini есть, готов встать на пульт.', '2026-09-19 14:00:00');
  insApp.run(t5, studentIds['student'], 'COMPLETED', 'Макеты утверждены и сданы.', '2026-09-14 12:00:00');

  const insNotif = db.prepare(`
    INSERT INTO notifications (user_id, title, body, link, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  insNotif.run(studentIds['student'], 'Новая возможность', 'Открыта запись на «День открытых дверей колледжа».', `/tasks/${t1}`, '2026-09-18 09:30:00');
  insNotif.run(studentIds['student'], 'Начислены баллы', '+20 баллов за выполнение «Дизайн серии афиш для Недели Науки».', '/record-book', '2026-09-15 18:21:00');
  insNotif.run(studentIds['anna'], 'Заявка одобрена!', 'Вы выбраны волонтёром на «День открытых дверей колледжа».', `/tasks/${t1}`, '2026-09-18 15:00:00');
  insNotif.run(staffId, 'Новый отклик', 'Иван Петров подал заявку на «День открытых дверей колледжа».', `/tasks/${t1}`, '2026-09-18 10:01:00');
  }
}

export default db;


// ==========================================
// MIGRATION: Normalize all phones
// ==========================================
function _normalizeMigrationPhone(rawPhone) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return '+7' + digits.slice(1);
  } else if (digits.length === 10) {
    return '+7' + digits;
  }
  return null;
}

try {
  const allUsers = db.prepare('SELECT id, phone FROM users WHERE phone IS NOT NULL').all();
  const updateUserPhone = db.prepare('UPDATE users SET phone = ? WHERE id = ?');
  allUsers.forEach(u => {
    const norm = _normalizeMigrationPhone(u.phone);
    if (norm && norm !== u.phone) {
      updateUserPhone.run(norm, u.id);
    }
  });

  const allApps = db.prepare('SELECT id, phone FROM recruitment_applications WHERE phone IS NOT NULL').all();
  const updateAppPhone = db.prepare('UPDATE recruitment_applications SET phone = ? WHERE id = ?');
  allApps.forEach(a => {
    const norm = _normalizeMigrationPhone(a.phone);
    if (norm && norm !== a.phone) {
      updateAppPhone.run(norm, a.id);
    }
  });
} catch (err) {
  console.error('Failed to run phone normalization migration:', err);
}

// ==========================================
// MIGRATION: Ensure mock users have phones
// ==========================================
try {
  const updatePhone = db.prepare(`UPDATE users SET phone = ? WHERE login = ? AND (phone IS NULL OR phone = '')`);
  updatePhone.run('+79001002030', 'admin');
  updatePhone.run('+79002003040', 'staff');
  updatePhone.run('+79161234567', 'student');
  updatePhone.run('+79162345678', 'anna');
  updatePhone.run('+79163456789', 'dmitry');
  updatePhone.run('+79164567890', 'sofia');
} catch (err) {
  console.error('Failed to set mock user phones:', err);
}


