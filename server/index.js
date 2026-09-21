import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import SQLiteSessionStore from './session-store.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { seed, DEPARTMENTS } from './db.js';
import storageService, { uploadMiddleware } from './storage.js';
import { validateMaxInitData, sendMaxNotification, getMaxConfig } from './max.js';

seed();

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

const isProduction = process.env.NODE_ENV === 'production';
app.use(session({
  store: new SQLiteSessionStore(),
  secret: process.env.SESSION_SECRET || 'media-center-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Пожалуйста, подождите 15 минут.' }
});

// Rate limiter for public recruitment application submissions
const recruitmentApplyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток отправки заявки. Пожалуйста, подождите 10 минут.' }
});

// Middleware: Verify authentication
export const auth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Требуется авторизация в системе' });
  }
  req.user = req.session.user;
  next();
};

// Middleware: Verify role
export const role = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Доступ запрещён: недостаточно прав' });
  }
  next();
};

// Helper: safe user object without password_hash and with total points & MAX fields
export function safeUser(u) {
  if (!u) return null;
  const { password_hash, ...safe } = u;
  const total = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM points WHERE user_id = ?').get(u.id)?.total || 0;
  const completedCount = db.prepare("SELECT COUNT(*) as cnt FROM applications WHERE user_id = ? AND status = 'COMPLETED'").get(u.id)?.cnt || 0;
  return {
    ...safe,
    must_change_password: Boolean(u.must_change_password),
    max_user_id: u.max_user_id || null,
    max_username: u.max_username || null,
    max_contact_verified: Boolean(u.max_contact_verified),
    phone_verified: Boolean(u.phone_verified),
    totalPoints: total,
    completedTasksCount: completedCount
  };
}

// Helper: Audit logging
export function audit(actorId, action, entityType, entityId = null, metadata = {}) {
  try {
    const cleanMeta = { ...metadata };
    delete cleanMeta.password;
    delete cleanMeta.password_hash;
    delete cleanMeta.newPassword;
    db.prepare(`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run(actorId, action, entityType, entityId, JSON.stringify(cleanMeta));
  } catch (err) {
    console.error('Audit logging error:', err.message);
  }
}

// Helper: Human readable audit description
export function getHumanReadableAudit(action, actorName, entityType, entityId, metadata) {
  let meta = {};
  try {
    meta = typeof metadata === 'string' ? JSON.parse(metadata) : (metadata || {});
  } catch {}

  const actor = actorName || 'Пользователь';
  switch (action) {
    case 'LOGIN_SUCCESS':
      return `${actor} вошёл в систему`;
    case 'LOGIN_FAILED':
      return `Неудачная попытка входа с логином «${meta.login || 'неизвестно'}»`;
    case 'LOGOUT':
      return `${actor} вышел из системы`;
    case 'TASK_CREATED':
      return `${actor} создал мероприятие «${meta.title || ''}»`;
    case 'TASK_UPDATED':
      return `${actor} обновил параметры мероприятия «${meta.title || ''}»`;
    case 'TASK_DELETED':
      return `${actor} удалил мероприятие «${meta.title || ''}»`;
    case 'TASK_ARCHIVED':
      return `${actor} перевёл мероприятие в архив`;
    case 'APPLICATION_CREATED':
      return `${actor} подал заявку на участие в мероприятии «${meta.taskTitle || ''}»`;
    case 'APPLICATION_WITHDRAWN':
      return `${actor} отозвал заявку на мероприятие`;
    case 'APPLICATION_STATUS_CHANGED':
      return `${actor} изменил статус заявки на «${meta.newStatus || ''}»`;
    case 'COMPLETION_SUBMITTED':
      return `${actor} сдал отчёт о выполнении работы на проверку`;
    case 'COMPLETION_CONFIRMED':
      return `${actor} подтвердил выполнение мероприятия и начислил ${meta.pointsAwarded || 0} баллов`;
    case 'POINTS_MANUALLY_ISSUED':
      return `${actor} начислил ${meta.amount > 0 ? '+' : ''}${meta.amount} баллов в Record Book: ${meta.reason || ''}`;
    case 'USER_CREATED':
      return `${actor} зарегистрировал нового пользователя @${meta.login || ''} (${meta.role || ''})`;
    case 'USER_UPDATED':
      return `${actor} обновил данные учётной записи @${meta.login || ''}`;
    case 'PASSWORD_RESET_BY_ADMIN':
      return `${actor} сбросил пароль пользователю @${meta.login || ''}`;
    case 'PASSWORD_CHANGED':
      return `${actor} изменил свой пароль`;
    case 'PROFILE_UPDATED':
      return `${actor} обновил информацию своего профиля`;
    case 'RECRUITMENT_APPLICATION_SUBMITTED':
      return `Кандидат ${meta.candidate || ''} отправил тестовое задание по направлению «${meta.track || ''}» (№ ${meta.public_id || ''})`;
    case 'RECRUITMENT_APPLICATION_STATUS':
      return `${actor} изменил статус заявки № ${meta.public_id || ''} на «${meta.newStatus || ''}»`;
    case 'STUDENT_ACCOUNT_CREATED_FROM_RECRUITMENT':
      return `${actor} одобрил заявку № ${meta.publicId || ''} и создал аккаунт волонтёра @${meta.login || ''}`;
    case 'RECRUITMENT_TRACK_UPDATED':
      return `${actor} обновил настройки направления отбора «${meta.track || ''}»`;
    default:
      return `${actor}: действие ${action} (${entityType} #${entityId || '—'})`;
  }
}

// Helper: Create notification
export function createNotification(userId, title, body, link = null) {
  try {
    db.prepare(`
      INSERT INTO notifications (user_id, title, body, link)
      VALUES (?, ?, ?, ?)
    `).run(userId, title, body, link);
  } catch (err) {
    console.error('Notification creation error:', err.message);
  }
}

// Helper: Transliterate Russian name to valid login
export function transliterateToLogin(fullName) {
  const ru = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
    'х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
  };
  const parts = String(fullName).trim().toLowerCase().split(/\s+/);
  const raw = parts.length > 1 ? `${parts[0]}_${parts[1]}` : parts[0];
  const converted = raw.split('').map(c => ru[c] !== undefined ? ru[c] : c).join('').replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return converted || 'volunteer_' + Math.floor(Math.random() * 10000);
}

// ==========================================
// AUTH ROUTES
// ==========================================

app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) {
    return res.status(400).json({ error: 'Укажите логин и пароль' });
  }

  const user = db.prepare("SELECT * FROM users WHERE login = ? AND status = 'ACTIVE'").get(String(login).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    audit(user?.id || null, 'LOGIN_FAILED', 'AUTH', null, { login });
    return res.status(401).json({ error: 'Неверный логин или пароль, либо аккаунт деактивирован' });
  }

  req.session.user = {
    id: user.id,
    login: user.login,
    role: user.role,
    first_name: user.first_name,
    last_name: user.last_name
  };

  audit(user.id, 'LOGIN_SUCCESS', 'AUTH', user.id);
  res.json({ user: safeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.session?.user) {
    audit(req.session.user.id, 'LOGOUT', 'AUTH', req.session.user.id);
  }
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Не удалось завершить сессию' });
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user: safeUser(user) });
});

app.patch('/api/auth/profile', auth, (req, res) => {
  const { bio, phone, max_contact, skills, theme } = req.body || {};
  db.prepare(`
    UPDATE users
    SET bio = COALESCE(?, bio),
        phone = COALESCE(?, phone),
        max_contact = COALESCE(?, max_contact),
        skills = COALESCE(?, skills),
        theme = COALESCE(?, theme)
    WHERE id = ?
  `).run(bio, phone, max_contact, skills, theme, req.user.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  audit(req.user.id, 'PROFILE_UPDATED', 'USER', req.user.id, { theme, skills });
  res.json({ user: safeUser(updated) });
});

app.post('/api/auth/change-password', auth, authLimiter, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Заполните старый и новый пароли' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Новый пароль должен содержать не менее 6 символов' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Текущий пароль указан неверно' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, req.user.id);
  audit(req.user.id, 'PASSWORD_CHANGED', 'USER', req.user.id);
  res.json({ ok: true, message: 'Пароль успешно обновлён' });
});

app.post('/api/auth/first-login-password-change', auth, authLimiter, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Новый пароль должен содержать не менее 6 символов' });
  }

  const newHash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(newHash, req.user.id);
  audit(req.user.id, 'PASSWORD_CHANGED', 'USER', req.user.id, { reason: 'FIRST_LOGIN_CHANGE' });

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user: safeUser(updated), message: 'Пароль успешно установлен' });
});

app.post('/api/auth/request-password-reset', authLimiter, (req, res) => {
  const { loginOrContact } = req.body || {};
  if (!loginOrContact || !String(loginOrContact).trim()) {
    return res.status(400).json({ error: 'Укажите логин, номер телефона или контакт в MAX' });
  }

  const term = String(loginOrContact).trim();
  const cleanTerm = term.toLowerCase().replace(/^@/, '');
  const user = db.prepare(`
    SELECT * FROM users
    WHERE LOWER(login) = ? OR LOWER(phone) = ? OR LOWER(max_contact) = ? OR LOWER(max_contact) = ?
  `).get(cleanTerm, term, term, cleanTerm);

  // Notify all active admins
  const admins = db.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'").all();
  admins.forEach(admin => {
    createNotification(
      admin.id,
      'Запрос на сброс пароля',
      `Пользователь указал контакт «${term}» для восстановления доступа.`,
      '/admin/users'
    );
  });

  audit(user?.id || null, 'PASSWORD_RESET_REQUESTED', 'AUTH', user?.id || null, { contact: term });

  res.json({
    ok: true,
    message: 'Запрос на восстановление доступа отправлен администраторам медиацентра. Мы свяжемся с вами в мессенджере MAX или по телефону.'
  });
});

// MAX Mini App API
app.get('/api/max/config', (req, res) => {
  res.json({ config: getMaxConfig() });
});

app.post('/api/auth/max-mini-app', (req, res) => {
  const { initData } = req.body || {};
  const validation = validateMaxInitData(initData);
  if (!validation.valid || !validation.user) {
    return res.status(400).json({ error: validation.error || 'Недействительные данные авторизации MAX' });
  }

  const maxUser = validation.user;
  // Try finding user by max_user_id, or by max_contact/max_username
  let user = db.prepare('SELECT * FROM users WHERE max_user_id = ?').get(String(maxUser.id));
  if (!user && maxUser.username) {
    const cleanUsername = maxUser.username.toLowerCase();
    user = db.prepare('SELECT * FROM users WHERE LOWER(max_contact) = ? OR LOWER(max_contact) = ?').get(cleanUsername, '@' + cleanUsername);
  }

  if (!user) {
    return res.status(404).json({
      error: 'Учётная запись медиацентра не привязана к этому профилю MAX. Пожалуйста, войдите по логину и паролю и привяжите MAX в настройках.',
      maxUser: {
        id: maxUser.id,
        username: maxUser.username,
        first_name: maxUser.first_name
      }
    });
  }

  // Update max_user_id & verification if not yet set
  db.prepare(`
    UPDATE users
    SET max_user_id = COALESCE(max_user_id, ?),
        max_username = COALESCE(max_username, ?),
        max_contact_verified = 1
    WHERE id = ?
  `).run(String(maxUser.id), maxUser.username || null, user.id);

  req.session.user = {
    id: user.id,
    login: user.login,
    role: user.role,
    first_name: user.first_name,
    last_name: user.last_name
  };

  audit(user.id, 'LOGIN_SUCCESS', 'AUTH_MAX', user.id);
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ user: safeUser(updatedUser) });
});

app.post('/api/user/link-max', auth, (req, res) => {
  const { initData, maxUserId, maxUsername } = req.body || {};
  let userIdToLink = maxUserId;
  let usernameToLink = maxUsername;

  if (initData) {
    const validation = validateMaxInitData(initData);
    if (validation.valid && validation.user) {
      userIdToLink = validation.user.id;
      usernameToLink = validation.user.username;
    }
  }

  if (!userIdToLink && !usernameToLink) {
    return res.status(400).json({ error: 'Укажите данные аккаунта MAX' });
  }

  db.prepare(`
    UPDATE users
    SET max_user_id = COALESCE(?, max_user_id),
        max_username = COALESCE(?, max_username),
        max_contact = COALESCE(max_contact, ?),
        max_contact_verified = 1
    WHERE id = ?
  `).run(userIdToLink ? String(userIdToLink) : null, usernameToLink || null, usernameToLink ? `@${usernameToLink}` : null, req.user.id);

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  audit(req.user.id, 'PROFILE_UPDATED', 'MAX_LINK', req.user.id, { maxUserId: userIdToLink, maxUsername: usernameToLink });
  res.json({ ok: true, user: safeUser(updatedUser), message: 'Аккаунт MAX успешно привязан' });
});

// ==========================================
// DASHBOARD ROUTE
// ==========================================

app.get('/api/dashboard', auth, (req, res) => {
  const u = req.user;

  if (u.role === 'STUDENT') {
    const me = safeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id));

    // Get open tasks and student's applications
    const tasks = db.prepare(`
      SELECT t.*, a.status as application_status
      FROM tasks t
      LEFT JOIN applications a ON a.task_id = t.id AND a.user_id = ?
      WHERE t.status IN ('OPEN', 'ASSIGNMENT_IN_PROGRESS')
      ORDER BY t.event_date ASC
      LIMIT 6
    `).all(u.id);

    // My active/selected assignments
    const myAssignments = db.prepare(`
      SELECT t.*, a.status as application_status, a.id as application_id
      FROM applications a
      JOIN tasks t ON t.id = a.task_id
      WHERE a.user_id = ? AND a.status IN ('SELECTED', 'IN_PROGRESS', 'COMPLETION_SUBMITTED')
      ORDER BY t.event_date ASC
    `).all(u.id);

    // Recent points ledger entries
    const points = db.prepare(`
      SELECT p.*, t.title as task_title, u.first_name || ' ' || u.last_name as issuer_name
      FROM points p
      LEFT JOIN tasks t ON t.id = p.task_id
      LEFT JOIN users u ON u.id = p.issued_by
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
      LIMIT 6
    `).all(u.id);

    // Recent notifications
    const notifications = db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 6
    `).all(u.id);

    const unreadNotificationsCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM notifications
      WHERE user_id = ? AND read_at IS NULL
    `).get(u.id)?.cnt || 0;

    return res.json({
      user: me,
      tasks,
      myAssignments,
      points,
      notifications,
      unreadNotificationsCount
    });
  }

  // Staff and Admin dashboard
  const pendingRecruitmentCount = db.prepare("SELECT COUNT(*) as c FROM recruitment_applications WHERE status IN ('SUBMITTED', 'IN_REVIEW')").get().c;
  const pendingVolunteersCount = db.prepare("SELECT COUNT(*) as c FROM applications WHERE status = 'APPLIED'").get().c;
  const pendingSubmissionsCount = db.prepare("SELECT COUNT(*) as c FROM applications WHERE status = 'COMPLETION_SUBMITTED'").get().c;

  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    students: db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'STUDENT' AND status = 'ACTIVE'").get().c,
    openTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'OPEN'").get().c,
    pendingApplications: pendingVolunteersCount,
    pendingRecruitment: pendingRecruitmentCount,
    pendingSubmissions: pendingSubmissionsCount,
    completedTasks: db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'COMPLETED'").get().c,
    totalPointsIssued: db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM points WHERE amount > 0").get().s
  };

  const tasks = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM applications a WHERE a.task_id = t.id) as applicants,
      (SELECT COUNT(*) FROM applications a WHERE a.task_id = t.id AND a.status = 'SELECTED') as selected,
      u.first_name || ' ' || u.last_name as creator
    FROM tasks t
    LEFT JOIN users u ON u.id = t.creator_id
    WHERE t.status IN ('OPEN', 'ASSIGNMENT_IN_PROGRESS', 'DRAFT')
    ORDER BY t.event_date ASC
    LIMIT 8
  `).all();

  const recentActivity = db.prepare(`
    SELECT a.*, u.first_name || ' ' || u.last_name as actor_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.created_at DESC
    LIMIT 8
  `).all().map(row => ({
    ...row,
    human_description: getHumanReadableAudit(row.action, row.actor_name, row.entity_type, row.entity_id, row.metadata)
  }));

  const pendingList = db.prepare(`
    SELECT a.*, t.title as task_title, u.first_name, u.last_name, u.group_name, u.skills
    FROM applications a
    JOIN tasks t ON t.id = a.task_id
    JOIN users u ON u.id = a.user_id
    WHERE a.status = 'APPLIED'
    ORDER BY a.created_at ASC
    LIMIT 6
  `).all();

  // Recent recruitment applications for staff home
  const pendingRecruitmentList = db.prepare(`
    SELECT ra.*, rt.name as track_name, rt.type as track_type
    FROM recruitment_applications ra
    JOIN recruitment_tracks rt ON rt.id = ra.track_id
    WHERE ra.status IN ('SUBMITTED', 'IN_REVIEW')
    ORDER BY ra.created_at DESC
    LIMIT 6
  `).all();

  res.json({
    user: safeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)),
    stats,
    tasks,
    recentActivity,
    pendingList,
    pendingRecruitmentList
  });
});

// ==========================================
// PUBLIC RECRUITMENT PORTAL ROUTES
// ==========================================

// Get public track info by slug or type (NO AUTH REQUIRED)
app.get('/api/public/recruitment/track/:slugOrType', (req, res) => {
  const param = String(req.params.slugOrType).trim().toLowerCase();

  const track = db.prepare(`
    SELECT * FROM recruitment_tracks
    WHERE LOWER(slug) = ? OR LOWER(type) = ?
  `).get(param, param);

  if (!track) {
    return res.status(404).json({ error: 'Направление отбора не найдено' });
  }

  res.json({
    track,
    departments: DEPARTMENTS,
    privacyPolicyUrl: process.env.PRIVACY_POLICY_URL || '/privacy-policy',
    consentVersion: '1.0',
    maxUploadSizeMB: storageService.getMaxSizeMB()
  });
});

// Russian phone normalization helper: stores as +7XXXXXXXXXX
function normalizeRussianPhone(rawPhone) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/\D/g, '');
  let d = digits;
  if (d.length === 11 && (d.startsWith('7') || d.startsWith('8'))) {
    d = '7' + d.slice(1);
  } else if (d.length === 10) {
    d = '7' + d;
  } else {
    return null;
  }
  return `+${d}`;
}

// Public application submission (NO AUTH REQUIRED)
app.post('/api/public/recruitment/apply/:slug', recruitmentApplyLimiter, (req, res) => {
  const uploadFields = uploadMiddleware.fields([
    { name: 'files', maxCount: 10 },
    { name: 'file', maxCount: 1 }
  ]);

  uploadFields(req, res, (uploadErr) => {
    const uploadedFiles = [];
    if (req.files) {
      if (Array.isArray(req.files.files)) uploadedFiles.push(...req.files.files);
      if (Array.isArray(req.files.file)) uploadedFiles.push(...req.files.file);
    } else if (req.file) {
      uploadedFiles.push(req.file);
    }

    const cleanupFiles = () => {
      uploadedFiles.forEach(f => storageService.deleteFile(f.filename));
    };

    if (uploadErr) {
      cleanupFiles();
      return res.status(400).json({ error: uploadErr.message });
    }

    const slug = String(req.params.slug).trim().toLowerCase();
    const track = db.prepare('SELECT * FROM recruitment_tracks WHERE LOWER(slug) = ? OR LOWER(type) = ?').get(slug, slug);
    if (!track) {
      cleanupFiles();
      return res.status(404).json({ error: 'Направление отбора не найдено' });
    }

    if (!track.is_open) {
      cleanupFiles();
      return res.status(400).json({ error: 'Приём заявок на это направление временно закрыт' });
    }

    const {
      full_name,
      department,
      group_name,
      phone,
      max_contact,
      phone_is_max,
      portfolio_url,
      submission_url,
      submission_text,
      comment,
      consent
    } = req.body || {};

    // Validate full name
    if (!full_name || String(full_name).trim().length < 2) {
      cleanupFiles();
      return res.status(400).json({ error: 'Укажите ФИО полностью' });
    }

    // FIO must be Cyrillic letters only (including spaces and hyphens)
    const cyrillicFioRegex = /^[А-Яа-яЁё\s-]+$/;
    if (!cyrillicFioRegex.test(String(full_name).trim())) {
      cleanupFiles();
      return res.status(400).json({ error: 'Введите ФИО русскими буквами' });
    }

    if (!department || !String(department).trim() || !DEPARTMENTS.includes(String(department).trim())) {
      cleanupFiles();
      return res.status(400).json({ error: 'Выберите отделение колледжа' });
    }

    if (!group_name || !String(group_name).trim()) {
      cleanupFiles();
      return res.status(400).json({ error: 'Укажите учебную группу' });
    }

    const normalizedPhone = normalizeRussianPhone(phone);
    if (!normalizedPhone) {
      cleanupFiles();
      return res.status(400).json({ error: 'Укажите корректный номер телефона РФ (например, +7 (999) 000-00-00)' });
    }

    const isPhoneMax = phone_is_max === 'true' || phone_is_max === true || phone_is_max === '1';
    const finalMaxContact = isPhoneMax ? normalizedPhone : 'Номер не подтверждён как используемый в MAX';

    const consentAccepted = consent === 'true' || consent === true || consent === '1';
    if (!consentAccepted) {
      cleanupFiles();
      return res.status(400).json({ error: 'Необходимо подтвердить согласие на обработку персональных данных' });
    }

    // Track-specific submissions validation
    const trackSlug = (track.slug || '').toLowerCase();
    const trackType = (track.type || '').toUpperCase();

    if (trackSlug === 'photo' || trackType === 'PHOTO') {
      // Photo track requires strictly 10 files, all in JPEG format
      const isTenFiles = uploadedFiles.length === 10;
      const allJpegs = isTenFiles && uploadedFiles.every(f => {
        const name = (f.originalname || '').toLowerCase();
        const isExtJpeg = name.endsWith('.jpg') || name.endsWith('.jpeg');
        const isMimeJpeg = f.mimetype === 'image/jpeg' || f.mimetype === 'image/pjpeg';
        return isExtJpeg || isMimeJpeg;
      });

      if (!isTenFiles || !allJpegs) {
        cleanupFiles();
        return res.status(400).json({
          error: 'Для направления Фотография требуется прикрепить ровно 10 фотографий в формате JPEG'
        });
      }
    } else if (trackSlug === 'smm' || trackType === 'SMM') {
      // SMM track requires response text or document link
      const hasText = Boolean(submission_text && String(submission_text).trim().length > 0);
      const hasLink = Boolean(submission_url && String(submission_url).trim().length > 0);
      if (!hasText && !hasLink) {
        cleanupFiles();
        return res.status(400).json({
          error: 'Введите ответ на тестовое задание в текстовое поле или прикрепите ссылку на Яндекс Диск'
        });
      }
    } else {
      // Video, Montage, Design, Content: file upload or cloud disk link
      const hasFiles = uploadedFiles.length > 0;
      const hasLink = Boolean(submission_url && String(submission_url).trim().length > 0);
      if (!hasFiles && !hasLink) {
        cleanupFiles();
        return res.status(400).json({
          error: 'Прикрепите файл с выполненным заданием или укажите ссылку на Яндекс Диск'
        });
      }
    }

    // Generate guaranteed unique public ID e.g. MC-P-0003
    const prefixMap = {
      PHOTO: 'P',
      VIDEO: 'V',
      MONTAGE: 'M',
      DESIGN: 'D',
      SMM: 'S',
      CONTENT: 'C'
    };
    const prefix = prefixMap[track.type] || 'M';
    let nextNum = 1;
    const lastRow = db.prepare(`
      SELECT public_id FROM recruitment_applications
      WHERE public_id LIKE ?
      ORDER BY id DESC LIMIT 1
    `).get(`MC-${prefix}-%`);

    if (lastRow && lastRow.public_id) {
      const match = lastRow.public_id.match(/MC-[A-Z]-(\d+)/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }

    let publicId = `MC-${prefix}-${String(nextNum).padStart(4, '0')}`;
    while (db.prepare('SELECT id FROM recruitment_applications WHERE public_id = ?').get(publicId)) {
      nextNum++;
      publicId = `MC-${prefix}-${String(nextNum).padStart(4, '0')}`;
    }

    try {
      let appId;
      const tx = db.transaction(() => {
        const r = db.prepare(`
          INSERT INTO recruitment_applications (
            public_id, track_id, full_name, department, group_name, phone, max_contact,
            portfolio_url, submission_url, submission_text, comment, status, consent_version, consent_accepted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', '1.0', CURRENT_TIMESTAMP)
        `).run(
          publicId,
          track.id,
          String(full_name).trim(),
          String(department).trim(),
          String(group_name).trim(),
          normalizedPhone,
          finalMaxContact,
          portfolio_url ? String(portfolio_url).trim() : null,
          submission_url ? String(submission_url).trim() : null,
          submission_text ? String(submission_text).trim() : null,
          comment ? String(comment).trim() : null
        );

        appId = r.lastInsertRowid;

        for (const file of uploadedFiles) {
          db.prepare(`
            INSERT INTO recruitment_files (application_id, original_name, stored_name, file_path, file_size, mime_type)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            appId,
            file.originalname,
            file.filename,
            file.path,
            file.size,
            file.mimetype || 'application/octet-stream'
          );
        }

        // Notify Staff and Admins
        const staffUsers = db.prepare("SELECT id FROM users WHERE role IN ('STAFF', 'ADMIN') AND status = 'ACTIVE'").all();
        staffUsers.forEach(s => {
          createNotification(
            s.id,
            'Новая заявка на отбор',
            `${String(full_name).trim()} отправил(а) тестовое задание по направлению «${track.name}» (${publicId})`,
            '/recruitment'
          );
        });
      });

      tx();

      audit(null, 'RECRUITMENT_APPLICATION_SUBMITTED', 'RECRUITMENT_APPLICATION', appId, {
        public_id: publicId,
        track: track.name,
        candidate: String(full_name).trim(),
        files_count: uploadedFiles.length,
        has_text: Boolean(submission_text && String(submission_text).trim())
      });

      res.status(201).json({
        ok: true,
        public_id: publicId,
        track_name: track.name,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      cleanupFiles();
      console.error('Error saving recruitment application:', err);
      res.status(500).json({ error: 'Ошибка сохранения заявки' });
    }
  });
});

// ==========================================
// STAFF & ADMIN RECRUITMENT REVIEW ROUTES
// ==========================================

// List recruitment applications (Staff/Admin)
app.get('/api/recruitment/applications', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const { track, status, search } = req.query;

  let sql = `
    SELECT
      ra.*,
      rt.name as track_name,
      rt.type as track_type,
      rt.slug as track_slug,
      u.first_name || ' ' || u.last_name as reviewer_name,
      su.login as student_login,
      (SELECT COUNT(*) FROM recruitment_files rf WHERE rf.application_id = ra.id) as files_count
    FROM recruitment_applications ra
    JOIN recruitment_tracks rt ON rt.id = ra.track_id
    LEFT JOIN users u ON u.id = ra.reviewed_by
    LEFT JOIN users su ON su.id = ra.student_user_id
    WHERE 1=1
  `;
  const args = [];

  if (track && track !== 'ALL') {
    sql += ' AND (rt.type = ? OR rt.slug = ?)';
    args.push(track.toUpperCase(), track.toLowerCase());
  }

  if (status && status !== 'ALL') {
    sql += ' AND ra.status = ?';
    args.push(status);
  }

  if (search && search.trim()) {
    sql += ' AND (ra.full_name LIKE ? OR ra.public_id LIKE ? OR ra.group_name LIKE ? OR ra.phone LIKE ? OR ra.max_contact LIKE ?)';
    const term = `%${search.trim()}%`;
    args.push(term, term, term, term, term);
  }

  sql += ' ORDER BY ra.created_at DESC';

  const applications = db.prepare(sql).all(...args);

  // Counters for badges and filters
  const pendingCount = db.prepare("SELECT COUNT(*) as c FROM recruitment_applications WHERE status IN ('SUBMITTED', 'IN_REVIEW')").get().c;
  const totalCount = db.prepare('SELECT COUNT(*) as c FROM recruitment_applications').get().c;

  res.json({
    applications,
    pendingCount,
    totalCount
  });
});

// Single application details with files
app.get('/api/recruitment/applications/:id', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const appRecord = db.prepare(`
    SELECT
      ra.*,
      rt.name as track_name,
      rt.type as track_type,
      rt.slug as track_slug,
      rt.title as track_title,
      u.first_name || ' ' || u.last_name as reviewer_name,
      su.login as student_login,
      su.id as student_id
    FROM recruitment_applications ra
    JOIN recruitment_tracks rt ON rt.id = ra.track_id
    LEFT JOIN users u ON u.id = ra.reviewed_by
    LEFT JOIN users su ON su.id = ra.student_user_id
    WHERE ra.id = ?
  `).get(req.params.id);

  if (!appRecord) {
    return res.status(404).json({ error: 'Заявка не найдена' });
  }

  const files = db.prepare(`
    SELECT id, original_name, file_size, mime_type, created_at
    FROM recruitment_files
    WHERE application_id = ?
  `).all(appRecord.id);

  res.json({
    application: appRecord,
    files
  });
});

// Download attached file
app.get('/api/recruitment/files/:id/download', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const fileRecord = db.prepare('SELECT * FROM recruitment_files WHERE id = ?').get(req.params.id);
  if (!fileRecord) {
    return res.status(404).json({ error: 'Файл не найден' });
  }

  try {
    const safePath = storageService.getSafeFilePath(fileRecord.stored_name);
    if (!path.resolve(safePath)) {
      return res.status(404).json({ error: 'Файл отсутствует на диске' });
    }
    res.download(safePath, fileRecord.original_name);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update recruitment application status (IN_REVIEW, REJECTED, APPROVED)
app.patch('/api/recruitment/applications/:id/status', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const appId = req.params.id;
  const appRecord = db.prepare('SELECT * FROM recruitment_applications WHERE id = ?').get(appId);
  if (!appRecord) return res.status(404).json({ error: 'Заявка не найдена' });

  const { status } = req.body || {};
  const valid = ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'Недопустимый статус' });
  }

  db.prepare(`
    UPDATE recruitment_applications
    SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?
    WHERE id = ?
  `).run(status, req.user.id, appId);

  audit(req.user.id, 'RECRUITMENT_APPLICATION_STATUS', 'RECRUITMENT_APPLICATION', appId, {
    public_id: appRecord.public_id,
    newStatus: status
  });

  res.json({ ok: true, message: `Статус заявки изменён на ${status}` });
});

// Approve application & create Media Center Student account
app.post('/api/recruitment/applications/:id/approve-and-create-user', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const appId = req.params.id;
  const appRecord = db.prepare(`
    SELECT ra.*, rt.name as track_name, rt.type as track_type
    FROM recruitment_applications ra
    JOIN recruitment_tracks rt ON rt.id = ra.track_id
    WHERE ra.id = ?
  `).get(appId);

  if (!appRecord) return res.status(404).json({ error: 'Заявка не найдена' });

  if (appRecord.student_user_id) {
    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(appRecord.student_user_id);
    return res.status(400).json({
      error: 'Аккаунт волонтёра уже был создан ранее',
      user: safeUser(existingUser)
    });
  }

  // Parse name
  const nameParts = appRecord.full_name.trim().split(/\s+/);
  let firstName = nameParts[0] || 'Волонтёр';
  let lastName = '';
  let middleName = '';

  if (nameParts.length === 2) {
    firstName = nameParts[0];
    lastName = nameParts[1];
  } else if (nameParts.length >= 3) {
    lastName = nameParts[0];
    firstName = nameParts[1];
    middleName = nameParts.slice(2).join(' ');
  }

  // Generate unique login
  const baseLogin = transliterateToLogin(`${firstName}_${lastName || 'student'}`);
  let login = baseLogin;
  let counter = 1;
  while (db.prepare('SELECT id FROM users WHERE login = ?').get(login)) {
    login = `${baseLogin}_${counter}`;
    counter++;
  }

  // Generate default password
  const initialPassword = req.body.password || 'Demo123!';
  const pwHash = bcrypt.hashSync(initialPassword, 10);

  // Skill mapped from track
  const trackSkillsMap = {
    PHOTO: 'Фотография, Свет, Lightroom',
    VIDEO: 'Видеосъёмка, Видеомонтаж, Premiere Pro',
    DESIGN: 'Графический дизайн, Figma, Типографика',
    SMM: 'SMM, Копирайтинг, Контент'
  };
  const skill = trackSkillsMap[appRecord.track_type] || appRecord.track_name;

  let newUserId;
  const tx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO users (
        login, password_hash, role, first_name, last_name, middle_name,
        email, group_name, year, bio, skills, phone, max_contact, status, must_change_password
      ) VALUES (?, ?, 'STUDENT', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'ACTIVE', 1)
    `).run(
      login,
      pwHash,
      firstName,
      lastName,
      middleName,
      `${login}@college.local`,
      appRecord.group_name,
      `Волонтёр медиацентра (направление «${appRecord.track_name}»). Принят по заявке ${appRecord.public_id}.`,
      skill,
      appRecord.phone,
      appRecord.max_contact
    );

    newUserId = r.lastInsertRowid;

    // Update recruitment application
    db.prepare(`
      UPDATE recruitment_applications
      SET status = 'APPROVED', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, student_user_id = ?
      WHERE id = ?
    `).run(req.user.id, newUserId, appId);

    // Initial welcome points bonus (10 points for passing recruitment)
    db.prepare(`
      INSERT INTO points (user_id, amount, reason, category, issued_by)
      VALUES (?, 10, 'Успешное прохождение тестового задания отбора', 'BONUS', ?)
    `).run(newUserId, req.user.id);

    // Welcome notification
    createNotification(
      newUserId,
      'Добро пожаловать в команду!',
      `Вы успешно приняты в медиацентр по направлению «${appRecord.track_name}». Вам начислено 10 приветственных баллов!`,
      '/record-book'
    );
  });

  tx();

  audit(req.user.id, 'STUDENT_ACCOUNT_CREATED_FROM_RECRUITMENT', 'USER', newUserId, {
    applicationId: appId,
    publicId: appRecord.public_id,
    login,
    studentName: `${firstName} ${lastName}`.trim()
  });

  const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId);

  res.status(201).json({
    ok: true,
    message: 'Кандидат успешно принят, создан аккаунт волонтёра!',
    user: safeUser(createdUser),
    login,
    initialPassword
  });
});

// Recruitment tracks management (Staff/Admin)
app.get('/api/recruitment/tracks', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const tracks = db.prepare(`
    SELECT rt.*,
      (SELECT COUNT(*) FROM recruitment_applications ra WHERE ra.track_id = rt.id) as total_applications,
      (SELECT COUNT(*) FROM recruitment_applications ra WHERE ra.track_id = rt.id AND ra.status IN ('SUBMITTED', 'IN_REVIEW')) as pending_applications
    FROM recruitment_tracks rt
    ORDER BY rt.id ASC
  `).all();
  res.json(tracks);
});

app.patch('/api/recruitment/tracks/:id', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const trackId = req.params.id;
  const existing = db.prepare('SELECT * FROM recruitment_tracks WHERE id = ?').get(trackId);
  if (!existing) return res.status(404).json({ error: 'Направление не найдено' });

  const { title, description, instructions, materials_url, deadline, is_open } = req.body || {};

  db.prepare(`
    UPDATE recruitment_tracks
    SET title = COALESCE(?, title),
        description = COALESCE(?, description),
        instructions = COALESCE(?, instructions),
        materials_url = COALESCE(?, materials_url),
        deadline = COALESCE(?, deadline),
        is_open = COALESCE(?, is_open),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title, description, instructions, materials_url, deadline,
    is_open !== undefined ? (is_open ? 1 : 0) : existing.is_open,
    trackId
  );

  audit(req.user.id, 'RECRUITMENT_TRACK_UPDATED', 'RECRUITMENT_TRACK', trackId, {
    track: existing.name,
    is_open
  });

  res.json({ ok: true, message: 'Настройки направления обновлены' });
});

// ==========================================
// TASKS / EVENTS ROUTES
// ==========================================

// List tasks
app.get('/api/tasks', auth, (req, res) => {
  const { status, category, search } = req.query;
  const isStudent = req.user.role === 'STUDENT';

  let sql = `
    SELECT t.*,
      u.first_name || ' ' || u.last_name as creator,
      (SELECT COUNT(*) FROM applications a WHERE a.task_id = t.id) as applicants,
      (SELECT COUNT(*) FROM applications a WHERE a.task_id = t.id AND a.status = 'SELECTED') as selected
    FROM tasks t
    LEFT JOIN users u ON u.id = t.creator_id
    WHERE 1=1
  `;
  const args = [];

  // Students shouldn't see DRAFT tasks unless they applied to them
  if (isStudent) {
    sql += ` AND (t.status != 'DRAFT' OR t.id IN (SELECT task_id FROM applications WHERE user_id = ?))`;
    args.push(req.user.id);
  }

  if (status && status !== 'ALL') {
    sql += ' AND t.status = ?';
    args.push(status);
  }

  if (category && category !== 'ALL') {
    sql += ' AND t.category = ?';
    args.push(category);
  }

  if (search && search.trim()) {
    sql += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.location LIKE ? OR t.skills LIKE ?)';
    const term = `%${search.trim()}%`;
    args.push(term, term, term, term);
  }

  sql += ' ORDER BY t.event_date ASC, t.id DESC';

  const rows = db.prepare(sql).all(...args);

  if (isStudent) {
    rows.forEach(t => {
      const appRecord = db.prepare('SELECT id, status, comment FROM applications WHERE task_id = ? AND user_id = ?').get(t.id, req.user.id);
      t.application_status = appRecord?.status || null;
      t.application_id = appRecord?.id || null;
    });
  }

  res.json(rows);
});

// Get single task details
app.get('/api/tasks/:id', auth, (req, res) => {
  const t = db.prepare(`
    SELECT t.*, u.first_name || ' ' || u.last_name as creator, u.email as creator_email
    FROM tasks t
    LEFT JOIN users u ON u.id = t.creator_id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!t) return res.status(404).json({ error: 'Мероприятие не найдено' });

  // If user is STUDENT, check draft permission
  if (req.user.role === 'STUDENT' && t.status === 'DRAFT') {
    return res.status(403).json({ error: 'Это мероприятие пока находится в черновиках' });
  }

  if (req.user.role === 'STUDENT') {
    // Student sees own application details
    const myApp = db.prepare('SELECT * FROM applications WHERE task_id = ? AND user_id = ?').get(t.id, req.user.id);
    t.my_application = myApp || null;
    t.application_status = myApp?.status || null;

    // Public list of selected volunteers (names only, no private comments)
    t.selected_volunteers = db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.group_name
      FROM applications a
      JOIN users u ON u.id = a.user_id
      WHERE a.task_id = ? AND a.status IN ('SELECTED', 'IN_PROGRESS', 'COMPLETED')
    `).all(t.id);
    t.applicants = [];
  } else {
    // Staff & Admin see full list of all applicants with detailed profiles
    t.applicants = db.prepare(`
      SELECT a.*,
        u.first_name, u.last_name, u.group_name, u.year, u.email, u.phone, u.max_contact, u.skills,
        (SELECT COALESCE(SUM(amount), 0) FROM points WHERE user_id = u.id) as student_points,
        (SELECT COUNT(*) FROM applications WHERE user_id = u.id AND status = 'COMPLETED') as completed_count
      FROM applications a
      JOIN users u ON u.id = a.user_id
      WHERE a.task_id = ?
      ORDER BY a.created_at ASC
    `).all(t.id);
  }

  res.json(t);
});

// Create task (Staff / Admin)
app.post('/api/tasks', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const d = req.body || {};
  if (!d.title || !d.title.trim()) {
    return res.status(400).json({ error: 'Название мероприятия обязательно' });
  }
  if (!d.event_date) {
    return res.status(400).json({ error: 'Дата проведения обязательна' });
  }

  const points = Math.max(0, parseInt(d.points, 10) || 0);
  const required = Math.max(1, parseInt(d.required_volunteers, 10) || 1);
  const status = ['DRAFT', 'OPEN', 'ASSIGNMENT_IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(d.status)
    ? d.status
    : 'OPEN';
  const priority = ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(d.priority) ? d.priority : 'NORMAL';

  const r = db.prepare(`
    INSERT INTO tasks (
      title, description, category, creator_id, event_date, start_time, end_time,
      location, required_volunteers, skills, points, priority, deadline, status, equipment, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    d.title.trim(),
    d.description ? d.description.trim() : '',
    d.category || 'Событие',
    req.user.id,
    d.event_date,
    d.start_time || '',
    d.end_time || '',
    d.location ? d.location.trim() : '',
    required,
    d.skills ? d.skills.trim() : '',
    points,
    priority,
    d.deadline || null,
    status,
    d.equipment ? d.equipment.trim() : '',
    d.notes ? d.notes.trim() : ''
  );

  audit(req.user.id, 'TASK_CREATED', 'TASK', r.lastInsertRowid, { title: d.title, status });
  res.status(201).json({ id: r.lastInsertRowid, message: 'Мероприятие успешно создано' });
});

// Update task (Staff / Admin)
app.patch('/api/tasks/:id', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const taskId = req.params.id;
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!existing) return res.status(404).json({ error: 'Мероприятие не найдено' });

  const d = req.body || {};
  const title = d.title !== undefined ? String(d.title).trim() : existing.title;
  if (!title) return res.status(400).json({ error: 'Название не может быть пустым' });

  const event_date = d.event_date !== undefined ? d.event_date : existing.event_date;
  const description = d.description !== undefined ? d.description : existing.description;
  const category = d.category !== undefined ? d.category : existing.category;
  const start_time = d.start_time !== undefined ? d.start_time : existing.start_time;
  const end_time = d.end_time !== undefined ? d.end_time : existing.end_time;
  const location = d.location !== undefined ? d.location : existing.location;
  const required_volunteers = d.required_volunteers !== undefined ? Math.max(1, parseInt(d.required_volunteers, 10) || 1) : existing.required_volunteers;
  const skills = d.skills !== undefined ? d.skills : existing.skills;
  const points = d.points !== undefined ? Math.max(0, parseInt(d.points, 10) || 0) : existing.points;
  const priority = d.priority !== undefined ? d.priority : existing.priority;
  const deadline = d.deadline !== undefined ? d.deadline : existing.deadline;
  const status = d.status !== undefined ? d.status : existing.status;
  const equipment = d.equipment !== undefined ? d.equipment : existing.equipment;
  const notes = d.notes !== undefined ? d.notes : existing.notes;

  db.prepare(`
    UPDATE tasks SET
      title = ?, description = ?, category = ?, event_date = ?, start_time = ?, end_time = ?,
      location = ?, required_volunteers = ?, skills = ?, points = ?, priority = ?, deadline = ?,
      status = ?, equipment = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title, description, category, event_date, start_time, end_time,
    location, required_volunteers, skills, points, priority, deadline,
    status, equipment, notes, taskId
  );

  audit(req.user.id, 'TASK_UPDATED', 'TASK', taskId, { title, status, points });
  res.json({ ok: true, message: 'Мероприятие успешно обновлено' });
});

// Delete or cancel task (Admin or creator Staff)
app.delete('/api/tasks/:id', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const taskId = req.params.id;
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!existing) return res.status(404).json({ error: 'Мероприятие не найдено' });

  // If points have already been awarded for this task, archive it instead of hard deleting
  const awarded = db.prepare('SELECT COUNT(*) as c FROM points WHERE task_id = ?').get(taskId).c;
  if (awarded > 0) {
    db.prepare("UPDATE tasks SET status = 'ARCHIVED' WHERE id = ?").run(taskId);
    audit(req.user.id, 'TASK_ARCHIVED', 'TASK', taskId, { reason: 'Has awarded points' });
    return res.json({ ok: true, message: 'Мероприятие переведено в архив, так как по нему уже начислены баллы' });
  }

  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  audit(req.user.id, 'TASK_DELETED', 'TASK', taskId, { title: existing.title });
  res.json({ ok: true, message: 'Мероприятие удалено' });
});

// ==========================================
// APPLICATION WORKFLOW ROUTES
// ==========================================

// Student applies for a task
app.post('/api/tasks/:id/apply', auth, role('STUDENT'), (req, res) => {
  const taskId = req.params.id;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return res.status(404).json({ error: 'Мероприятие не найдено' });

  if (task.status !== 'OPEN') {
    return res.status(400).json({ error: 'Приём заявок на это мероприятие закрыт (статус: ' + task.status + ')' });
  }

  const existingApp = db.prepare('SELECT * FROM applications WHERE task_id = ? AND user_id = ?').get(taskId, req.user.id);
  if (existingApp) {
    if (existingApp.status === 'WITHDRAWN') {
      // Re-apply if previously withdrawn
      db.prepare("UPDATE applications SET status = 'APPLIED', comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.body.comment || '', existingApp.id);
      createNotification(task.creator_id, 'Повторный отклик', `${req.user.first_name} ${req.user.last_name} повторно подал(а) заявку на «${task.title}»`, `/tasks/${taskId}`);
      audit(req.user.id, 'APPLICATION_REOPENED', 'APPLICATION', existingApp.id, { taskId });
      return res.json({ ok: true, message: 'Заявка повторно подана' });
    }
    return res.status(400).json({ error: 'Вы уже подали заявку на это мероприятие (статус: ' + existingApp.status + ')' });
  }

  const r = db.prepare(`
    INSERT INTO applications (task_id, user_id, comment, status)
    VALUES (?, ?, ?, 'APPLIED')
  `).run(taskId, req.user.id, req.body.comment ? String(req.body.comment).trim() : '');

  // Notify creator
  if (task.creator_id) {
    createNotification(
      task.creator_id,
      'Новый отклик волонтёра',
      `${req.user.first_name} ${req.user.last_name} откликнулся на «${task.title}»`,
      `/tasks/${taskId}`
    );
  }

  audit(req.user.id, 'APPLICATION_CREATED', 'APPLICATION', r.lastInsertRowid, { taskId, taskTitle: task.title });
  res.status(201).json({ ok: true, message: 'Заявка успешно отправлена!' });
});

// Student withdraws their application
app.post('/api/tasks/:id/withdraw', auth, role('STUDENT'), (req, res) => {
  const taskId = req.params.id;
  const appRecord = db.prepare('SELECT * FROM applications WHERE task_id = ? AND user_id = ?').get(taskId, req.user.id);
  if (!appRecord) return res.status(404).json({ error: 'Заявка не найдена' });

  if (['COMPLETED', 'WITHDRAWN'].includes(appRecord.status)) {
    return res.status(400).json({ error: 'Нельзя отозвать заявку в статусе ' + appRecord.status });
  }

  db.prepare("UPDATE applications SET status = 'WITHDRAWN', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(appRecord.id);

  const task = db.prepare('SELECT creator_id, title FROM tasks WHERE id = ?').get(taskId);
  if (task && task.creator_id) {
    createNotification(task.creator_id, 'Заявка отозвана', `${req.user.first_name} ${req.user.last_name} отозвал(а) заявку на «${task.title}»`, `/tasks/${taskId}`);
  }

  audit(req.user.id, 'APPLICATION_WITHDRAWN', 'APPLICATION', appRecord.id, { taskId });
  res.json({ ok: true, message: 'Заявка отозвана' });
});

// Student marks progress or submits completion proof
app.post('/api/tasks/:id/submit-completion', auth, role('STUDENT'), (req, res) => {
  const taskId = req.params.id;
  const appRecord = db.prepare('SELECT * FROM applications WHERE task_id = ? AND user_id = ?').get(taskId, req.user.id);
  if (!appRecord) return res.status(404).json({ error: 'Вы не являетесь участником этого мероприятия' });

  if (!['SELECTED', 'IN_PROGRESS'].includes(appRecord.status)) {
    return res.status(400).json({ error: 'Отправка отчёта доступна только для отобранных волонтёров' });
  }

  const notes = req.body.submission_notes ? String(req.body.submission_notes).trim() : '';
  db.prepare(`
    UPDATE applications
    SET status = 'COMPLETION_SUBMITTED', submission_notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(notes, appRecord.id);

  const task = db.prepare('SELECT creator_id, title FROM tasks WHERE id = ?').get(taskId);
  if (task && task.creator_id) {
    createNotification(
      task.creator_id,
      'Работа сдана волонтёром',
      `${req.user.first_name} ${req.user.last_name} отправил(а) отчёт по мероприятию «${task.title}»`,
      `/tasks/${taskId}`
    );
  }

  audit(req.user.id, 'COMPLETION_SUBMITTED', 'APPLICATION', appRecord.id, { taskId });
  res.json({ ok: true, message: 'Отчёт успешно отправлен на подтверждение куратору' });
});

// Staff / Admin updates application status (SELECTED, REJECTED, IN_PROGRESS, NO_SHOW, etc.)
app.patch('/api/applications/:id', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const appId = req.params.id;
  const appRecord = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
  if (!appRecord) return res.status(404).json({ error: 'Заявка не найдена' });

  const allowedStatuses = ['APPLIED', 'SELECTED', 'REJECTED', 'WITHDRAWN', 'IN_PROGRESS', 'COMPLETION_SUBMITTED', 'COMPLETED', 'NO_SHOW'];
  const newStatus = req.body.status;
  if (!allowedStatuses.includes(newStatus)) {
    return res.status(400).json({ error: 'Недопустимый статус заявки' });
  }

  db.prepare('UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, appId);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(appRecord.task_id);
  const statusLabels = {
    SELECTED: 'Вы отобраны волонтёром',
    REJECTED: 'Заявка отклонена',
    IN_PROGRESS: 'Мероприятие в процессе выполнения',
    COMPLETED: 'Участие успешно подтверждено',
    NO_SHOW: 'Неявка на мероприятие'
  };

  if (statusLabels[newStatus]) {
    createNotification(
      appRecord.user_id,
      statusLabels[newStatus],
      `Статус вашего участия в мероприятии «${task ? task.title : 'Мероприятие'}»: ${newStatus}`,
      `/tasks/${appRecord.task_id}`
    );
  }

  if (newStatus === 'SELECTED' && task && task.status === 'OPEN') {
    const selectedCount = db.prepare("SELECT COUNT(*) as c FROM applications WHERE task_id = ? AND status = 'SELECTED'").get(task.id).c;
    if (selectedCount >= task.required_volunteers) {
      db.prepare("UPDATE tasks SET status = 'ASSIGNMENT_IN_PROGRESS', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);
    }
  }

  audit(req.user.id, 'APPLICATION_STATUS_CHANGED', 'APPLICATION', appId, { newStatus, taskId: appRecord.task_id });
  res.json({ ok: true, message: `Статус изменён на ${newStatus}` });
});

// Staff / Admin confirms completion and awards points for a task
app.post('/api/tasks/:id/complete', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const taskId = req.params.id;
  const targetUserId = req.body.user_id;
  if (!targetUserId) return res.status(400).json({ error: 'Укажите ID студента' });

  // Prevent duplicate completion reward
  const alreadyAwarded = db.prepare(`
    SELECT id FROM points
    WHERE task_id = ? AND user_id = ? AND category = 'COMPLETION'
  `).get(taskId, targetUserId);

  if (alreadyAwarded) {
    return res.status(409).json({ error: 'Баллы за выполнение этого мероприятия уже были начислены данному студенту' });
  }

  const appRecord = db.prepare(`
    SELECT * FROM applications
    WHERE task_id = ? AND user_id = ?
  `).get(taskId, targetUserId);

  if (!appRecord || !['SELECTED', 'IN_PROGRESS', 'COMPLETION_SUBMITTED'].includes(appRecord.status)) {
    return res.status(400).json({ error: 'У студента нет активной отобранной заявки по этому мероприятию' });
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  const awardPoints = req.body.points !== undefined ? Math.max(0, parseInt(req.body.points, 10) || 0) : (task.points || 0);
  const reason = req.body.reason || `Успешное выполнение: «${task.title}»`;

  const tx = db.transaction(() => {
    db.prepare("UPDATE applications SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(appRecord.id);

    db.prepare(`
      INSERT INTO points (user_id, amount, reason, category, task_id, issued_by)
      VALUES (?, ?, ?, 'COMPLETION', ?, ?)
    `).run(targetUserId, awardPoints, reason, task.id, req.user.id);

    createNotification(
      targetUserId,
      'Начислены баллы за мероприятие',
      `Вам начислено +${awardPoints} баллов за участие в «${task.title}»`,
      '/record-book'
    );
  });

  tx();

  audit(req.user.id, 'COMPLETION_CONFIRMED', 'TASK', task.id, {
    studentId: targetUserId,
    pointsAwarded: awardPoints
  });

  res.json({ ok: true, message: `Выполнение подтверждено, начислено ${awardPoints} баллов` });
});

// ==========================================
// POINTS & RECORD BOOK
// ==========================================

// Staff / Admin awards manual points or bonus to student
app.post('/api/points/award', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const { user_id, amount, reason, category, task_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'Укажите студента' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Укажите причину начисления' });

  const numAmount = parseInt(amount, 10);
  if (isNaN(numAmount) || numAmount === 0) {
    return res.status(400).json({ error: 'Сумма баллов должна быть отличной от 0' });
  }

  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!targetUser) return res.status(404).json({ error: 'Пользователь не найден' });

  const cat = category || 'BONUS';
  const r = db.prepare(`
    INSERT INTO points (user_id, amount, reason, category, task_id, issued_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user_id, numAmount, reason.trim(), cat, task_id || null, req.user.id);

  createNotification(
    user_id,
    numAmount > 0 ? 'Начислены баллы в зачётку' : 'Корректировка баллов',
    `${numAmount > 0 ? '+' : ''}${numAmount} баллов: ${reason}`,
    '/record-book'
  );

  audit(req.user.id, 'POINTS_MANUALLY_ISSUED', 'POINT', r.lastInsertRowid, {
    targetUserId: user_id,
    amount: numAmount,
    reason,
    category: cat
  });

  res.status(201).json({ ok: true, id: r.lastInsertRowid, message: 'Баллы успешно внесены в ledger' });
});

// Get record book for current user
app.get('/api/record-book', auth, (req, res) => {
  const userId = req.user.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const points = db.prepare(`
    SELECT p.*, t.title as task_title, u.first_name || ' ' || u.last_name as issuer_name
    FROM points p
    LEFT JOIN tasks t ON t.id = p.task_id
    LEFT JOIN users u ON u.id = p.issued_by
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId);

  res.json({
    user: safeUser(user),
    points
  });
});

// Get record book for specific student (Staff and Admin only)
app.get('/api/record-book/:id', auth, role('STAFF', 'ADMIN'), (req, res) => {
  const targetId = req.params.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const points = db.prepare(`
    SELECT p.*, t.title as task_title, u.first_name || ' ' || u.last_name as issuer_name
    FROM points p
    LEFT JOIN tasks t ON t.id = p.task_id
    LEFT JOIN users u ON u.id = p.issued_by
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(targetId);

  res.json({
    user: safeUser(user),
    points
  });
});

// ==========================================
// LEADERBOARD
// ==========================================

app.get('/api/leaderboard', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id, u.first_name, u.last_name, u.group_name, u.year, u.login, u.skills, u.bio,
      COALESCE(SUM(p.amount), 0) as points,
      (SELECT COUNT(*) FROM applications a WHERE a.user_id = u.id AND a.status = 'COMPLETED') as completed
    FROM users u
    LEFT JOIN points p ON p.user_id = u.id
    WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE'
    GROUP BY u.id
    ORDER BY points DESC, completed DESC, u.last_name ASC
  `).all();

  res.json(rows.map((r, i) => ({ ...r, position: i + 1 })));
});

// ==========================================
// NOTIFICATIONS
// ==========================================

app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(req.user.id);

  const unreadCount = rows.filter(n => !n.read_at).length;
  res.json({ notifications: rows, unreadCount });
});

app.patch('/api/notifications/:id/read', auth, (req, res) => {
  db.prepare(`
    UPDATE notifications
    SET read_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', auth, (req, res) => {
  db.prepare(`
    UPDATE notifications
    SET read_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND read_at IS NULL
  `).run(req.user.id);
  res.json({ ok: true, message: 'Все уведомления прочитаны' });
});

// ==========================================
// USERS & VOLUNTEERS DIRECTORY
// ==========================================

// List users (Staff & Admin see all, students can view volunteer directory)
app.get('/api/users', auth, (req, res) => {
  const { role: filterRole, status: filterStatus, search } = req.query;
  const isStudent = req.user.role === 'STUDENT';

  let sql = `
    SELECT u.*,
      COALESCE(SUM(p.amount), 0) as points,
      (SELECT COUNT(*) FROM applications a WHERE a.user_id = u.id AND a.status = 'COMPLETED') as completed
    FROM users u
    LEFT JOIN points p ON p.user_id = u.id
    WHERE 1=1
  `;
  const args = [];

  if (isStudent) {
    sql += " AND u.role = 'STUDENT' AND u.status = 'ACTIVE'";
  } else {
    if (filterRole && filterRole !== 'ALL') {
      sql += ' AND u.role = ?';
      args.push(filterRole);
    }
    if (filterStatus && filterStatus !== 'ALL') {
      sql += ' AND u.status = ?';
      args.push(filterStatus);
    }
  }

  if (search && search.trim()) {
    sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.login LIKE ? OR u.group_name LIKE ? OR u.skills LIKE ? OR u.phone LIKE ? OR u.max_contact LIKE ?)';
    const term = `%${search.trim()}%`;
    args.push(term, term, term, term, term, term, term);
  }

  sql += ' GROUP BY u.id ORDER BY points DESC, u.last_name ASC';

  const rows = db.prepare(sql).all(...args);
  res.json(rows.map(safeUser));
});

// Single user profile with stats and completed tasks
app.get('/api/users/:id', auth, (req, res) => {
  const targetId = req.params.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  // If student is viewing, they can only view active student profiles
  if (req.user.role === 'STUDENT' && (user.role !== 'STUDENT' || user.status !== 'ACTIVE') && Number(targetId) !== req.user.id) {
    return res.status(403).json({ error: 'Профиль недоступен для просмотра' });
  }

  const completedTasks = db.prepare(`
    SELECT t.id, t.title, t.category, t.event_date, a.updated_at as completed_at,
      (SELECT amount FROM points WHERE task_id = t.id AND user_id = ? AND category = 'COMPLETION' LIMIT 1) as points_earned
    FROM applications a
    JOIN tasks t ON t.id = a.task_id
    WHERE a.user_id = ? AND a.status = 'COMPLETED'
    ORDER BY a.updated_at DESC
  `).all(targetId, targetId);

  const pointsHistory = db.prepare(`
    SELECT p.*, t.title as task_title, u.first_name || ' ' || u.last_name as issuer_name
    FROM points p
    LEFT JOIN tasks t ON t.id = p.task_id
    LEFT JOIN users u ON u.id = p.issued_by
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
    LIMIT 30
  `).all(targetId);

  res.json({
    user: safeUser(user),
    completedTasks,
    pointsHistory: req.user.role !== 'STUDENT' || Number(targetId) === req.user.id ? pointsHistory : []
  });
});

// Create user (Admin only)
app.post('/api/users', auth, role('ADMIN'), (req, res) => {
  const d = req.body || {};
  if (!d.login || !d.login.trim()) {
    return res.status(400).json({ error: 'Логин обязателен' });
  }
  if (!d.password || String(d.password).length < 6) {
    return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
  }

  const cleanLogin = String(d.login).trim().toLowerCase();
  const validRoles = ['ADMIN', 'STAFF', 'STUDENT'];
  const userRole = validRoles.includes(d.role) ? d.role : 'STUDENT';

  try {
    const pwHash = bcrypt.hashSync(d.password, 10);
    const r = db.prepare(`
      INSERT INTO users (login, password_hash, role, first_name, last_name, middle_name, email, group_name, year, bio, skills, phone, max_contact, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanLogin,
      pwHash,
      userRole,
      d.first_name ? d.first_name.trim() : '',
      d.last_name ? d.last_name.trim() : '',
      d.middle_name ? d.middle_name.trim() : '',
      d.email ? d.email.trim().toLowerCase() : '',
      d.group_name ? d.group_name.trim() : '',
      d.year ? parseInt(d.year, 10) : null,
      d.bio ? d.bio.trim() : '',
      d.skills ? d.skills.trim() : '',
      d.phone ? d.phone.trim() : '',
      d.max_contact ? d.max_contact.trim() : '',
      d.status || 'ACTIVE'
    );

    audit(req.user.id, 'USER_CREATED', 'USER', r.lastInsertRowid, {
      login: cleanLogin,
      role: userRole,
      name: `${d.first_name || ''} ${d.last_name || ''}`
    });

    res.status(201).json({ id: r.lastInsertRowid, message: 'Пользователь успешно создан' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: users.login')) {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Ошибка при создании пользователя' });
  }
});

// Update user (Admin only)
app.patch('/api/users/:id', auth, role('ADMIN'), (req, res) => {
  const targetId = req.params.id;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!existing) return res.status(404).json({ error: 'Пользователь не найден' });

  // Prevent last admin from being disabled or demoted
  if (existing.role === 'ADMIN' && (req.body.role !== undefined && req.body.role !== 'ADMIN' || req.body.status === 'INACTIVE')) {
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'").get().c;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Нельзя деактивировать или изменить роль последнего активного администратора' });
    }
  }

  const d = req.body || {};
  db.prepare(`
    UPDATE users SET
      role = COALESCE(?, role),
      status = COALESCE(?, status),
      first_name = COALESCE(?, first_name),
      last_name = COALESCE(?, last_name),
      middle_name = COALESCE(?, middle_name),
      email = COALESCE(?, email),
      group_name = COALESCE(?, group_name),
      year = COALESCE(?, year),
      bio = COALESCE(?, bio),
      skills = COALESCE(?, skills),
      phone = COALESCE(?, phone),
      max_contact = COALESCE(?, max_contact),
      theme = COALESCE(?, theme)
    WHERE id = ?
  `).run(
    d.role, d.status, d.first_name, d.last_name, d.middle_name,
    d.email, d.group_name, d.year, d.bio, d.skills, d.phone, d.max_contact, d.theme,
    targetId
  );

  audit(req.user.id, 'USER_UPDATED', 'USER', targetId, {
    role: d.role,
    status: d.status,
    login: existing.login
  });

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  res.json({ ok: true, user: safeUser(updated), message: 'Данные пользователя обновлены' });
});

// Reset user password (Admin only)
app.post('/api/users/:id/reset-password', auth, role('ADMIN'), (req, res) => {
  const targetId = req.params.id;
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Новый пароль должен содержать не менее 6 символов' });
  }

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!existing) return res.status(404).json({ error: 'Пользователь не найден' });

  const newHash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(newHash, targetId);

  audit(req.user.id, 'PASSWORD_RESET_BY_ADMIN', 'USER', targetId, { login: existing.login });
  res.json({ ok: true, message: `Пароль пользователя ${existing.login} успешно сброшен (при входе потребуется сменить пароль)` });
});

// ==========================================
// AUDIT LOGS
// ==========================================

app.get('/api/audit', auth, role('ADMIN'), (req, res) => {
  const { action, entity_type, limit = 200 } = req.query;

  let sql = `
    SELECT a.*, u.first_name || ' ' || u.last_name as actor_name, u.login as actor_login
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE 1=1
  `;
  const args = [];

  if (action && action !== 'ALL') {
    sql += ' AND a.action = ?';
    args.push(action);
  }

  if (entity_type && entity_type !== 'ALL') {
    sql += ' AND a.entity_type = ?';
    args.push(entity_type);
  }

  sql += ' ORDER BY a.created_at DESC LIMIT ?';
  args.push(Math.min(500, parseInt(limit, 10) || 200));

  const rows = db.prepare(sql).all(...args);
  const formatted = rows.map(r => ({
    ...r,
    human_description: getHumanReadableAudit(r.action, r.actor_name, r.entity_type, r.entity_id, r.metadata)
  }));

  res.json(formatted);
});

// ==========================================
// STATIC ASSETS & SPA ROUTING
// ==========================================

const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(distPath, 'index.html'));
  }
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint не найден' });
  }
  next();
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера', details: isProduction ? undefined : err.message });
});

const PORT = process.env.PORT || 4000;
export const server = app.listen(PORT, () => {
  console.log(`Media Center backend is running on http://localhost:${PORT}`);
});

export default app;
