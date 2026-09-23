import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import SQLiteSessionStore from './session-store.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { seed, DEPARTMENTS } from './db.js';
import storageService, { uploadMiddleware } from './storage.js';
import { validateMaxInitData, sendMaxNotification, getMaxConfig } from './max.js';
import { MAX_POINTS_PER_TRANSACTION, EVENT_CATEGORIES } from './config/eventCategories.js';

const isProduction = process.env.NODE_ENV === 'production';

// Production security check: SESSION_SECRET must be explicitly set and secure
if (isProduction) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('change-me') || process.env.SESSION_SECRET.includes('secret-key')) {
    console.error('CRITICAL ERROR: В режиме production переменная окружения SESSION_SECRET обязательна и должна содержать надёжный уникальный секретный ключ.');
    process.exit(1);
  }
} else {
  // In development, run seed
  seed();
}

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Trust reverse proxy (nginx / traefik / caddy)
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

if (isProduction && !process.env.SESSION_SECRET) {
  console.error("FATAL ERROR: SESSION_SECRET is not set in production!");
  process.exit(1);
}

app.use(session({
  store: new SQLiteSessionStore(),
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
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

// Rate limiter for uploads and reports
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Превышен лимит загрузок. Пожалуйста, подождите час.' }
});

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

export const strictAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Требуется авторизация в системе' });
  }
  const user = db.prepare('SELECT status, must_change_password, privacy_consent_at FROM users WHERE id = ?').get(req.session.user.id);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  
  if (user.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Аккаунт не активен' });
  }
  if (user.must_change_password) {
    return res.status(403).json({ error: 'Требуется смена пароля', code: 'MUST_CHANGE_PASSWORD' });
  }
  if (!user.privacy_consent_at) {
    return res.status(403).json({ error: 'Требуется согласие на обработку персональных данных', code: 'REQUIRES_CONSENT' });
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
// Helper: safe user object for STUDENT viewing other students (privacy)
export function safeStudentView(u) {
  if (!u) return null;
  const fullSafe = safeUser(u);
  return {
    id: fullSafe.id,
    first_name: fullSafe.first_name,
    middle_name: fullSafe.middle_name,
    last_name: fullSafe.last_name,
    group_name: fullSafe.group_name,
    year: fullSafe.year,
    department: fullSafe.department,
    bio: fullSafe.bio,
    skills: fullSafe.skills,
    totalPoints: fullSafe.totalPoints,
    completedTasksCount: fullSafe.completedTasksCount
  };
}

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
    delete cleanMeta.currentPassword;
    delete cleanMeta.temporaryPassword;
    delete cleanMeta.token;
    delete cleanMeta.SESSION_SECRET;
    delete cleanMeta.MAX_BOT_TOKEN;
    db.prepare(`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run(actorId, action, entityType, entityId, JSON.stringify(cleanMeta));
  } catch (err) {
    console.error('Audit logging error:', err.message);
  }
}

// Helper: Generate temporary random password
export function generateTemporaryPassword() {
  const lettersUpper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lettersLower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%';
  const all = lettersUpper + lettersLower + digits + symbols;

  let pwd = '';
  pwd += lettersUpper[crypto.randomInt(0, lettersUpper.length)];
  pwd += lettersLower[crypto.randomInt(0, lettersLower.length)];
  pwd += digits[crypto.randomInt(0, digits.length)];
  pwd += symbols[crypto.randomInt(0, symbols.length)];
  for (let i = 0; i < 6; i++) {
    pwd += all[crypto.randomInt(0, all.length)];
  }
  return pwd.split('').sort(() => 0.5 - Math.random()).join('');
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
    case 'LOGIN_CHANGED':
      return `${actor} изменил логин на @${meta.new_login || ''}`;
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
    case 'POINTS_REVERSED':
      return `${actor} отменил начисление #${meta.originalPointId || ''} (${meta.reversalAmount || 0} баллов): ${meta.reason || ''}`;
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
      return `${actor} одобрил заявку № ${meta.publicId || ''} и создал аккаунт медиаволонтёра @${meta.login || ''}`;
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
    return res.status(400).json({ error: 'Укажите логин/номер телефона и пароль' });
  }

  const rawLogin = String(login).trim();
  const cleanLogin = rawLogin.toLowerCase();
  
  let user = null;
  const normalizedPhone = normalizeRussianPhone(rawLogin);
  
  if (normalizedPhone) {
    // Check if pending activation
    const pendingUser = db.prepare("SELECT * FROM users WHERE phone = ? AND status = 'PENDING_ACTIVATION'").get(normalizedPhone);
    if (pendingUser) {
      return res.json({ requiresActivation: true, phone: normalizedPhone });
    }
    user = db.prepare("SELECT * FROM users WHERE phone = ? AND status = 'ACTIVE'").get(normalizedPhone);
  } else {
    user = db.prepare("SELECT * FROM users WHERE login = ? AND status = 'ACTIVE'").get(cleanLogin);
  }
  
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    audit(user?.id || null, 'LOGIN_FAILED', 'AUTH', null, { login });
    return res.status(401).json({ error: 'Неверный логин, номер телефона или пароль.' });
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
  let { bio, phone, max_contact, skills, theme } = req.body || {};
  
  if (req.user.role === 'STUDENT' && phone !== undefined) {
    return res.status(403).json({ error: 'Смена телефона доступна только администратору' });
  }

  if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
    const normalizedPhone = normalizeRussianPhone(String(phone).trim());
    if (!normalizedPhone) return res.status(400).json({ error: 'Некорректный номер телефона' });
    const existingPhoneUser = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(normalizedPhone, req.user.id);
    if (existingPhoneUser) return res.status(409).json({ error: 'Пользователь с таким номером телефона уже существует.' });
    phone = normalizedPhone;
  }
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
  const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!currentUser || !currentUser.must_change_password) {
    return res.status(403).json({ error: 'Смена пароля без ввода старого пароля разрешена только при первом входе' });
  }

  const { newLogin, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Новый пароль должен содержать не менее 6 символов' });
  }

  let finalLogin = currentUser.login;
  if (newLogin && String(newLogin).trim().length > 0) {
    const cleanLogin = String(newLogin).trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,30}$/.test(cleanLogin)) {
      return res.status(400).json({ error: 'Логин должен содержать от 3 до 30 символов (латинские буквы, цифры, дефис, точка)' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE login = ? AND id != ?').get(cleanLogin, req.user.id);
    if (existing) {
      return res.status(400).json({ error: 'Этот логин уже занят другим пользователем' });
    }
    finalLogin = cleanLogin;
  }

  const newHash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET login = ?, password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(finalLogin, newHash, req.user.id);

  audit(req.user.id, 'PASSWORD_CHANGED', 'USER', req.user.id, { reason: 'FIRST_LOGIN_SETUP' });
  if (finalLogin !== currentUser.login) {
    audit(req.user.id, 'LOGIN_CHANGED', 'USER', req.user.id, { old_login: currentUser.login, new_login: finalLogin });
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  req.session.user.login = updated.login;
  res.json({ ok: true, user: safeUser(updated), message: 'Учётная запись успешно настроена' });
});

// User changes login in account settings (requires current password)
app.post('/api/auth/privacy-consent', auth, (req, res) => {
  const { consent_version } = req.body;
  if (!consent_version) {
    return res.status(400).json({ error: 'Требуется версия политики' });
  }
  
  db.prepare("UPDATE users SET privacy_consent_at = CURRENT_TIMESTAMP, privacy_policy_version = ? WHERE id = ?").run(consent_version, req.user.id);
  audit(req.user.id, 'PRIVACY_CONSENT', 'AUTH', req.user.id, { version: consent_version });
  
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user: safeUser(updated) });
});

app.post('/api/auth/change-login', auth, authLimiter, (req, res) => {
  const { currentPassword, newLogin } = req.body || {};
  if (!currentPassword || !newLogin) {
    return res.status(400).json({ error: 'Укажите текущий пароль и новый логин' });
  }

  const cleanLogin = String(newLogin).trim().toLowerCase();
  if (/^\d+$/.test(cleanLogin)) return res.status(400).json({error: 'Логин не может состоять только из цифр'});
  if (normalizeRussianPhone(cleanLogin)) return res.status(400).json({error: 'Логин не должен быть похож на номер телефона'});
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_\-\.]{3,32}$/.test(cleanLogin)) {
    return res.status(400).json({ error: 'Логин должен быть от 3 до 32 символов (буквы, цифры, дефис, точка, подчёркивание)' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Текущий пароль указан неверно' });
  }

  if (cleanLogin === user.login) {
    return res.status(400).json({ error: 'Новый логин совпадает с текущим' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE login = ? AND id != ?').get(cleanLogin, req.user.id);
  if (existing) {
    return res.status(400).json({ error: 'Этот логин уже занят другим пользователем' });
  }

  db.prepare('UPDATE users SET login = ? WHERE id = ?').run(cleanLogin, req.user.id);
  audit(req.user.id, 'LOGIN_CHANGED', 'USER', req.user.id, { old_login: user.login, new_login: cleanLogin });

  req.session.user.login = cleanLogin;
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user: safeUser(updated), message: 'Логин успешно изменён' });
});

app.post('/api/auth/request-password-reset', authLimiter, (req, res) => {
  const { loginOrContact } = req.body || {};
  if (!loginOrContact || !String(loginOrContact).trim()) {
    return res.status(400).json({ error: 'Укажите логин, номер телефона или контакт в Макс' });
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
    message: 'Запрос на восстановление доступа отправлен администраторам медиацентра. Мы свяжемся с вами в мессенджере Макс или по телефону.'
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
    return res.status(400).json({ error: validation.error || 'Недействительные данные авторизации Макс' });
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
      error: 'Учётная запись медиацентра не привязана к этому профилю Макс. Пожалуйста, войдите по логину и паролю и привяжите Макс в настройках.',
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
    return res.status(400).json({ error: 'Укажите данные аккаунта Макс' });
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
  res.json({ ok: true, user: safeUser(updatedUser), message: 'Аккаунт Макс успешно привязан' });
});

// ==========================================
// DASHBOARD ROUTE
// ==========================================

app.get('/api/dashboard', strictAuth, (req, res) => {
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
  const raw = String(rawPhone).trim();
  // If it contains any letters, it's not a phone number
  if (/[a-zA-Zа-яА-ЯёЁ]/.test(raw)) return null;
  
  const digits = raw.replace(/\D/g, '');
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

function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').split('-').map(part => {
    return part.split(' ').map(word => {
      if (!word) return '';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
  }).join('-');
}

// Yandex Disk URL validation helper (supports disk.yandex.ru, disk.360.yandex.ru, yadi.sk)
export function isValidYandexDiskLink(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    /^https?:\/\/(disk\.)?(360\.)?yandex\.(ru|com|by|kz)\//i.test(trimmed) ||
    /^https?:\/\/disk\.360\.yandex\.(ru|com|by|kz)\//i.test(trimmed) ||
    /^https?:\/\/yadi\.sk\//i.test(trimmed)
  );
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
    let finalMaxContact = null;
    if (isPhoneMax) {
      finalMaxContact = normalizedPhone;
    } else {
      const normalizedMax = normalizeRussianPhone(max_contact);
      if (!normalizedMax) {
        cleanupFiles();
        return res.status(400).json({ error: 'Укажите корректный номер телефона РФ для мессенджера Макс' });
      }
      finalMaxContact = normalizedMax;
    }

    // Checking for duplicates (1 application per track per phone, unless allowed)
    const existingApp = db.prepare('SELECT id, admin_resubmission_allowed FROM recruitment_applications WHERE phone = ? AND track_id = ? ORDER BY created_at DESC LIMIT 1').get(normalizedPhone, track.id);
    if (existingApp) {
      if (!existingApp.admin_resubmission_allowed) {
        cleanupFiles();
        return res.status(409).json({ error: 'Заявка с этим номером телефона на данное направление уже отправлена.' });
      } else {
        // Mark the permission as used by unsetting it
        db.prepare('UPDATE recruitment_applications SET admin_resubmission_allowed = 0 WHERE id = ?').run(existingApp.id);
      }
    }

    const consentAccepted = consent === 'true' || consent === true || consent === '1';
    if (!consentAccepted) {
      cleanupFiles();
      return res.status(400).json({ error: 'Необходимо подтвердить согласие на обработку персональных данных' });
    }

    if (portfolio_url && String(portfolio_url).trim().length > 0) {
      if (!isValidYandexDiskLink(portfolio_url)) {
        cleanupFiles();
        return res.status(400).json({
          error: 'Укажите корректную ссылку на портфолио в Яндекс Диске (https://disk.yandex.ru/... или https://disk.360.yandex.ru/...)'
        });
      }
    }

    // Track-specific submissions validation
    const trackSlug = (track.slug || '').toLowerCase();
    const trackType = (track.type || '').toUpperCase();

    if (trackSlug === 'photo' || trackType === 'PHOTO') {
      const hasFiles = uploadedFiles.length > 0;
      const hasYandexLink = Boolean(submission_url && String(submission_url).trim().length > 0);

      if (!hasFiles && !hasYandexLink) {
        cleanupFiles();
        return res.status(400).json({
          error: 'Для направления «Фотография» прикрепите ровно 10 фотографий в формате JPEG либо укажите ссылку на папку в Яндекс Диске'
        });
      }

      if (hasFiles) {
        const isTenFiles = uploadedFiles.length === 10;
        const allJpegs = isTenFiles && uploadedFiles.every(f => {
          const name = (f.originalname || '').toLowerCase();
          const isExtJpeg = name.endsWith('.jpg') || name.endsWith('.jpeg');
          const isMimeJpeg = f.mimetype === 'image/jpeg' || f.mimetype === 'image/pjpeg';
          if (!isExtJpeg || !isMimeJpeg) return false;
          try {
            const buf = Buffer.alloc(3);
            const fd = fs.openSync(f.path, 'r');
            fs.readSync(fd, buf, 0, 3, 0);
            fs.closeSync(fd);
            return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
          } catch {
            return false;
          }
        });

        if (!isTenFiles || !allJpegs) {
          cleanupFiles();
          return res.status(400).json({
            error: 'Для направления Фотография требуется прикрепить ровно 10 фотографий в формате JPEG'
          });
        }
      } else if (hasYandexLink) {
        if (!isValidYandexDiskLink(submission_url)) {
          cleanupFiles();
          return res.status(400).json({
            error: 'Укажите корректную ссылку на Яндекс Диск (https://disk.yandex.ru/... или https://disk.360.yandex.ru/...)'
          });
        }
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
      if (hasLink && !isValidYandexDiskLink(submission_url)) {
        cleanupFiles();
        return res.status(400).json({
          error: 'Укажите корректную ссылку на Яндекс Диск (https://disk.yandex.ru/... или https://disk.360.yandex.ru/...)'
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
      if (hasLink && !isValidYandexDiskLink(submission_url)) {
        cleanupFiles();
        return res.status(400).json({
          error: 'Укажите корректную ссылку на Яндекс Диск (https://disk.yandex.ru/... или https://disk.360.yandex.ru/...)'
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
app.get('/api/recruitment/applications', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
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
app.get('/api/recruitment/applications/:id', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
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
app.get('/api/recruitment/files/:id/download', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
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
app.patch('/api/recruitment/applications/:id/status', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
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
app.post('/api/recruitment/applications/:id/approve-and-create-user', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
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
      error: 'Аккаунт медиаволонтёра уже был создан ранее',
      user: safeUser(existingUser)
    });
  }

  // Parse name
  const nameParts = appRecord.full_name.trim().split(/\s+/);
  let firstName = nameParts[0] || 'Медиаволонтёр';
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

  // Generate secure temporary password if not provided
  const initialPassword = (req.body && req.body.password && String(req.body.password).trim().length > 0)
    ? String(req.body.password).trim()
    : `MC_${crypto.randomBytes(4).toString('hex')}Aa1!`;
  const pwHash = bcrypt.hashSync(initialPassword, 10);

  // Skill mapped from track (no Figma!)
  const trackSkillsMap = {
    PHOTO: 'Фотография, Свет, Lightroom',
    VIDEO: 'Видеосъёмка, Видеомонтаж, Premiere Pro',
    DESIGN: 'Графический дизайн, Типографика, Вёрстка',
    SMM: 'СММ, Копирайтинг, Контент'
  };
  const skill = trackSkillsMap[appRecord.track_type] || appRecord.track_name;

  let newUserId;
  const tx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO users (
        login, password_hash, role, first_name, last_name, middle_name,
        email, group_name, year, bio, skills, phone, max_contact, status, must_change_password,
        privacy_consent_at, privacy_policy_version
      ) VALUES (?, ?, 'STUDENT', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'ACTIVE', 1, CURRENT_TIMESTAMP, '2026-09')
    `).run(
      login,
      pwHash,
      firstName,
      lastName,
      middleName,
      null,
      appRecord.group_name,
      `Медиаволонтёр медиацентра (направление «${appRecord.track_name}»).`,
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
    message: 'Кандидат успешно принят, создан аккаунт медиаволонтёра!',
    user: safeUser(createdUser),
    login,
    initialPassword,
    temporaryPassword: initialPassword
  });
});

// Recruitment tracks management (Staff/Admin)
// Admin route to allow resubmission
app.post('/api/recruitment/applications/:id/allow-resubmission', strictAuth, role('ADMIN'), (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM recruitment_applications WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Заявка не найдена' });

  db.prepare('UPDATE recruitment_applications SET admin_resubmission_allowed = 1 WHERE id = ?').run(id);
  audit(req.user.id, 'ALLOW_RESUBMISSION', 'RECRUITMENT', id, { phone: existing.phone });
  res.json({ ok: true, message: 'Повторная подача заявки разрешена' });
});

app.get('/api/recruitment/tracks', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
  const tracks = db.prepare(`
    SELECT rt.*,
      (SELECT COUNT(*) FROM recruitment_applications ra WHERE ra.track_id = rt.id) as total_applications,
      (SELECT COUNT(*) FROM recruitment_applications ra WHERE ra.track_id = rt.id AND ra.status IN ('SUBMITTED', 'IN_REVIEW')) as pending_applications
    FROM recruitment_tracks rt
    ORDER BY rt.id ASC
  `).all();
  res.json(tracks);
});

app.patch('/api/recruitment/tracks/:id', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
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
app.get('/api/tasks', strictAuth, (req, res) => {
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
app.get('/api/tasks/:id', strictAuth, (req, res) => {
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
      if (myApp) t.my_versions = db.prepare('SELECT * FROM application_versions WHERE application_id = ? ORDER BY version_number DESC').all(myApp.id);
    t.application_status = myApp?.status || null;

    // Public list of selected volunteers (names only, no private comments)
    t.selected_volunteers = db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.group_name, a.role_name
      FROM applications a
      JOIN users u ON u.id = a.user_id
      WHERE a.task_id = ? AND a.status IN ('SELECTED', 'IN_PROGRESS', 'COMPLETED')
    `).all(t.id);
    t.applicants = [];
  } else {
    // Staff & Admin see full list of all applicants with detailed profiles and order number
    const applicants = db.prepare(`
      SELECT a.*,
        u.first_name, u.last_name, u.group_name, u.year, u.email, u.phone, u.max_contact, u.skills,
        (SELECT COALESCE(SUM(amount), 0) FROM points WHERE user_id = u.id) as student_points,
        (SELECT COUNT(*) FROM applications WHERE user_id = u.id AND status = 'COMPLETED') as completed_count
      FROM applications a
      JOIN users u ON u.id = a.user_id
      WHERE a.task_id = ?
      ORDER BY a.created_at ASC
    `).all(t.id);

    t.applicants = applicants.map((app, idx) => ({
      ...app,
      order_num: idx + 1
    }));
  }

  res.json(t);
});

// Create task (Staff / Admin)
app.post('/api/tasks', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
  const d = req.body || {};
  if (!d.title || !d.title.trim()) {
    return res.status(400).json({ error: 'Название мероприятия обязательно' });
  }
  if (!d.event_date) {
    return res.status(400).json({ error: 'Дата проведения обязательна' });
  }

  const rawPoints = parseInt(d.points, 10);
  const points = Math.min(MAX_POINTS_PER_TRANSACTION, Math.max(0, isNaN(rawPoints) ? 0 : rawPoints));
  const required = Math.max(1, parseInt(d.required_volunteers, 10) || 1);
  const status = ['DRAFT', 'OPEN', 'ASSIGNMENT_IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(d.status)
    ? d.status
    : 'OPEN';
  const priority = ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(d.priority) ? d.priority : 'NORMAL';

  if (d.start_time && d.end_time && String(d.end_time).trim() < String(d.start_time).trim()) {
    return res.status(400).json({ error: 'Время окончания не может быть раньше времени начала' });
  }

  let rolesNeededJson = null;
  if (d.roles_needed) {
    rolesNeededJson = typeof d.roles_needed === 'string' ? d.roles_needed : JSON.stringify(d.roles_needed);
  }

  const customCategory = (d.category === 'Другое' && d.custom_category) ? String(d.custom_category).trim() : null;
  const locationType = ['department', 'custom'].includes(d.location_type) ? d.location_type : 'custom';

  const r = db.prepare(`
    INSERT INTO tasks (
      title, description, category, creator_id, event_date, start_time, end_time,
      location, required_volunteers, skills, points, priority, deadline, status,
      equipment, notes, roles_needed, location_type, custom_category
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    d.notes ? d.notes.trim() : '',
    rolesNeededJson,
    locationType,
    customCategory
  );

  audit(req.user.id, 'TASK_CREATED', 'TASK', r.lastInsertRowid, { title: d.title, status });
  res.status(201).json({ id: r.lastInsertRowid, message: 'Мероприятие успешно создано' });
});

// Update task (Staff / Admin)
app.patch('/api/tasks/:id', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
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

  const rawPoints = d.points !== undefined ? parseInt(d.points, 10) : existing.points;
  const points = Math.min(MAX_POINTS_PER_TRANSACTION, Math.max(0, isNaN(rawPoints) ? 0 : rawPoints));

  const priority = d.priority !== undefined ? d.priority : existing.priority;
  const deadline = d.deadline !== undefined ? d.deadline : existing.deadline;
  const status = d.status !== undefined ? d.status : existing.status;
  const equipment = d.equipment !== undefined ? d.equipment : existing.equipment;
  const notes = d.notes !== undefined ? d.notes : existing.notes;

  if (start_time && end_time && String(end_time).trim() < String(start_time).trim()) {
    return res.status(400).json({ error: 'Время окончания не может быть раньше времени начала' });
  }

  let roles_needed = existing.roles_needed;
  if (d.roles_needed !== undefined) {
    roles_needed = typeof d.roles_needed === 'string' ? d.roles_needed : JSON.stringify(d.roles_needed);
  }

  const location_type = d.location_type !== undefined ? d.location_type : existing.location_type;
  const custom_category = (category === 'Другое' && d.custom_category !== undefined)
    ? String(d.custom_category).trim()
    : (category === 'Другое' ? existing.custom_category : null);

  db.prepare(`
    UPDATE tasks SET
      title = ?, description = ?, category = ?, event_date = ?, start_time = ?, end_time = ?,
      location = ?, required_volunteers = ?, skills = ?, points = ?, priority = ?, deadline = ?,
      status = ?, equipment = ?, notes = ?, roles_needed = ?, location_type = ?, custom_category = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title, description, category, event_date, start_time, end_time,
    location, required_volunteers, skills, points, priority, deadline,
    status, equipment, notes, roles_needed, location_type, custom_category, taskId
  );

  audit(req.user.id, 'TASK_UPDATED', 'TASK', taskId, { title, status, points });
  res.json({ ok: true, message: 'Мероприятие успешно обновлено' });
});

// Delete or cancel task (Admin or creator Staff)
app.delete('/api/tasks/:id', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
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
app.post('/api/tasks/:id/apply', strictAuth, role('STUDENT'), (req, res) => {
  const taskId = req.params.id;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return res.status(404).json({ error: 'Мероприятие не найдено' });

  if (task.status !== 'OPEN') {
    return res.status(400).json({ error: 'Приём заявок на это мероприятие закрыт (статус: ' + task.status + ')' });
  }

  const roleName = req.body.role_name ? String(req.body.role_name).trim() : null;

  const existingApp = db.prepare('SELECT * FROM applications WHERE task_id = ? AND user_id = ?').get(taskId, req.user.id);
  if (existingApp) {
    if (existingApp.status === 'WITHDRAWN') {
      // Re-apply if previously withdrawn
      db.prepare("UPDATE applications SET status = 'APPLIED', comment = ?, role_name = COALESCE(?, role_name), updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.body.comment || '', roleName, existingApp.id);
      createNotification(task.creator_id, 'Повторный отклик', `${req.user.first_name} ${req.user.last_name} повторно подал(а) заявку на «${task.title}»`, `/tasks/${taskId}`);
      audit(req.user.id, 'APPLICATION_REOPENED', 'APPLICATION', existingApp.id, { taskId });
      return res.json({ ok: true, message: 'Заявка повторно подана' });
    }
    return res.status(400).json({ error: 'Вы уже подали заявку на это мероприятие (статус: ' + existingApp.status + ')' });
  }

  const r = db.prepare(`
    INSERT INTO applications (task_id, user_id, comment, status, role_name)
    VALUES (?, ?, ?, 'APPLIED', ?)
  `).run(taskId, req.user.id, req.body.comment ? String(req.body.comment).trim() : '', roleName);

  // Notify creator
  if (task.creator_id) {
    createNotification(
      task.creator_id,
      'Новый отклик медиаволонтёра',
      `${req.user.first_name} ${req.user.last_name} откликнулся на «${task.title}»`,
      `/tasks/${taskId}`
    );
  }

  audit(req.user.id, 'APPLICATION_CREATED', 'APPLICATION', r.lastInsertRowid, { taskId, taskTitle: task.title });
  res.status(201).json({ ok: true, message: 'Заявка успешно отправлена!' });
});

// Student withdraws their application
app.post('/api/tasks/:id/withdraw', strictAuth, role('STUDENT'), (req, res) => {
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
app.post('/api/tasks/:id/submit-completion', strictAuth, role('STUDENT'), uploadLimiter, (req, res) => {
  const taskId = req.params.id;
  const appRecord = db.prepare('SELECT * FROM applications WHERE task_id = ? AND user_id = ?').get(taskId, req.user.id);
  if (!appRecord) return res.status(404).json({ error: 'Вы не являетесь участником этого мероприятия' });

  if (!['SELECTED', 'IN_PROGRESS'].includes(appRecord.status)) {
    return res.status(400).json({ error: 'Отправка отчёта доступна только для отобранных медиаволонтёров' });
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
      'Работа сдана медиаволонтёром',
      `${req.user.first_name} ${req.user.last_name} отправил(а) отчёт по мероприятию «${task.title}»`,
      `/tasks/${taskId}`
    );
  }

  audit(req.user.id, 'COMPLETION_SUBMITTED', 'APPLICATION', appRecord.id, { taskId });
  res.json({ ok: true, message: 'Отчёт успешно отправлен на подтверждение сотруднику' });
});

// Staff / Admin updates application status (SELECTED, REJECTED, IN_PROGRESS, NO_SHOW, etc.)
app.patch('/api/applications/:id', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
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
    SELECTED: 'Вы отобраны медиаволонтёром',
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
app.post('/api/tasks/:id/complete', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
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
  const rawPoints = req.body.points !== undefined ? parseInt(req.body.points, 10) : task.points;
  const awardPoints = Math.min(MAX_POINTS_PER_TRANSACTION, Math.max(0, isNaN(rawPoints) ? 0 : rawPoints));
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
app.post('/api/points/award', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
  const { user_id, amount, reason, category, task_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'Укажите студента' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Укажите причину начисления' });

  const numAmount = parseInt(amount, 10);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Сумма баллов должна быть больше 0' });
  }
  if (numAmount > MAX_POINTS_PER_TRANSACTION) {
    return res.status(400).json({ error: `Сумма баллов за одну операцию не может превышать ${MAX_POINTS_PER_TRANSACTION}` });
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
    'Начислены баллы в зачётку',
    `+${numAmount} баллов: ${reason}`,
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

// Staff / Admin reverses points transaction
app.post('/api/points/:id/reverse', strictAuth, role('ADMIN'), (req, res) => {
  const pointId = req.params.id;
  const original = db.prepare('SELECT * FROM points WHERE id = ?').get(pointId);
  if (!original) return res.status(404).json({ error: 'Запись начисления не найдена' });

  if (original.is_reversed === 1) {
    return res.status(400).json({ error: 'Это начисление уже было отменено' });
  }

  if (original.amount <= 0) {
    return res.status(400).json({ error: 'Нельзя отменить отрицательную или нулевую запись' });
  }

  const { reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Укажите причину отмены начисления' });
  }
  const cleanReason = String(reason).trim();

  let counterTxId;
  const tx = db.transaction(() => {
    // 1. Mark original as reversed
    db.prepare('UPDATE points SET is_reversed = 1, reversal_reason = ? WHERE id = ?').run(cleanReason, pointId);

    // 2. Create counter transaction
    const r = db.prepare(`
      INSERT INTO points (user_id, amount, reason, category, task_id, issued_by, reversal_of_id)
      VALUES (?, ?, ?, 'CORRECTION', ?, ?, ?)
    `).run(
      original.user_id,
      -original.amount,
      `Отмена начисления: ${cleanReason}`,
      original.task_id || null,
      req.user.id,
      original.id
    );
    counterTxId = r.lastInsertRowid;

    // 3. Notify student
    createNotification(
      original.user_id,
      'Отмена начисления баллов',
      `Отменено начисление ${original.amount} баллов. Причина: ${cleanReason}`,
      '/record-book'
    );
  });

  tx();

  audit(req.user.id, 'POINTS_REVERSED', 'POINT', original.id, {
    originalPointId: original.id,
    counterTxId,
    studentId: original.user_id,
    reversalAmount: original.amount,
    reason: cleanReason
  });

  res.json({ ok: true, message: `Начисление ${original.amount} баллов успешно отменено`, counterTxId });
});

// Get record book for current user
app.get('/api/record-book', strictAuth, (req, res) => {
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

// Get record book for specific student
app.get('/api/record-book/:id', strictAuth, (req, res) => {
  const targetId = req.params.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  // Students can only view record books of active students or their own.
  // Viewing STAFF/ADMIN or inactive users by a student returns 403 Forbidden.
  if (req.user.role === 'STUDENT') {
    if (user.role !== 'STUDENT' || user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Зачётная книжка недоступна для просмотра' });
    }
  }

  const points = db.prepare(`
    SELECT p.*, t.title as task_title, u.first_name || ' ' || u.last_name as issuer_name
    FROM points p
    LEFT JOIN tasks t ON t.id = p.task_id
    LEFT JOIN users u ON u.id = p.issued_by
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(targetId);

  res.json({
    user: (req.user.role === 'STUDENT' && Number(targetId) !== req.user.id) ? safeStudentView(user) : safeUser(user),
    points
  });
});

// ==========================================
// LEADERBOARD
// ==========================================

app.get('/api/leaderboard', strictAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id, u.first_name, u.last_name, u.group_name, u.year, u.skills, u.bio,
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

app.get('/api/notifications', strictAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(req.user.id);

  const unreadCount = rows.filter(n => !n.read_at).length;
  res.json({ notifications: rows, unreadCount });
});

app.patch('/api/notifications/:id/read', strictAuth, (req, res) => {
  db.prepare(`
    UPDATE notifications
    SET read_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', strictAuth, (req, res) => {
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
app.get('/api/users', strictAuth, (req, res) => {
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
  res.json(rows.map(row => isStudent ? safeStudentView(row) : safeUser(row)));
});

// Single user profile with stats and completed tasks
app.get('/api/users/:id', strictAuth, (req, res) => {
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

  const canViewPoints =
    req.user.role !== 'STUDENT' ||
    (user.role === 'STUDENT' && user.status === 'ACTIVE') ||
    Number(targetId) === req.user.id;

  res.json({
    user: (req.user.role === 'STUDENT' && Number(targetId) !== req.user.id) ? safeStudentView(user) : safeUser(user),
    completedTasks,
    pointsHistory: canViewPoints ? pointsHistory : []
  });
});

// Create user (Admin only)
app.post('/api/users', strictAuth, role('ADMIN'), (req, res) => {
  const d = req.body || {};
  if (!d.login || !d.login.trim()) {
    return res.status(400).json({ error: 'Логин обязателен' });
  }

  let finalPassword = '';
  if (d.generate_password || !d.password) {
    finalPassword = generateTemporaryPassword();
  } else {
    if (String(d.password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
    }
    finalPassword = String(d.password);
  }

  const cleanLogin = String(d.login).trim().toLowerCase();
  if (cleanLogin.length < 3 || cleanLogin.length > 32 || !/^[a-z0-9_\-\.]+$/.test(cleanLogin)) {
    return res.status(400).json({ error: 'Логин должен быть от 3 до 32 символов и содержать только буквы, цифры, _, -, .' });
  }
  if (/^\d+$/.test(cleanLogin)) {
    return res.status(400).json({ error: 'Логин не может состоять только из цифр' });
  }
  
  if (d.phone && d.phone.trim()) {
    const normalizedPhone = normalizeRussianPhone(d.phone.trim());
    if (!normalizedPhone) return res.status(400).json({ error: 'Некорректный номер телефона' });
    const existingPhoneUser = db.prepare('SELECT id FROM users WHERE phone = ?').get(normalizedPhone);
    if (existingPhoneUser) return res.status(409).json({ error: 'Пользователь с таким номером телефона уже существует.' });
    d.phone = normalizedPhone;
  }

  const validRoles = ['ADMIN', 'STAFF', 'STUDENT'];
  const userRole = validRoles.includes(d.role) ? d.role : 'STUDENT';

  try {
    const pwHash = bcrypt.hashSync(finalPassword, 10);
    const fName = normalizeName(d.first_name);
    const lName = normalizeName(d.last_name);
    const mName = normalizeName(d.middle_name);
    const r = db.prepare(`
      INSERT INTO users (
        login, password_hash, role, first_name, last_name, middle_name,
        email, group_name, year, bio, skills, phone, max_contact, status, must_change_password
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      cleanLogin,
      pwHash,
      userRole,
      fName,
      lName,
      mName,
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

    res.status(201).json({
      id: r.lastInsertRowid,
      message: 'Пользователь успешно создан',
      login: cleanLogin,
      temporaryPassword: finalPassword
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: users.login')) {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Ошибка при создании пользователя' });
  }
});

// Mass Create (Admin only)
app.post('/api/users/mass-create', strictAuth, role('ADMIN'), (req, res) => {
  let phones = req.body.phones;
  if (typeof phones === 'string') phones = phones.split('\n').map(p => p.trim()).filter(Boolean);
  if (!Array.isArray(phones)) return res.status(400).json({ error: 'phones must be an array or string' });

  const added = [];
  const errors = [];

  for (const p of phones) {
    const np = normalizeRussianPhone(p);
    if (!np) { errors.push({ phone: p, error: 'Неверный формат номера' }); continue; }
    
    const exist = db.prepare('SELECT id FROM users WHERE phone = ?').get(np);
    if (exist) { errors.push({ phone: np, error: 'Уже существует' }); continue; }
    
    const token = Math.random().toString(36).substring(2, 8).toUpperCase();
    const tempLogin = 'pending_' + Date.now() + '_' + Math.floor(Math.random()*10000);
    
    db.prepare(`
      INSERT INTO users (login, password_hash, role, phone, status, activation_token, must_change_password)
      VALUES (?, '', 'STUDENT', ?, 'PENDING_ACTIVATION', ?, 0)
    `).run(tempLogin, np, token);
    
    added.push({ phone: np, token });
  }

  res.json({ added, errors });
});

app.post('/api/auth/activation-check', (req, res) => {
  const { phone, token } = req.body;
  const np = normalizeRussianPhone(phone);
  if (!np) return res.status(400).json({error: 'Неверный формат номера'});
  const user = db.prepare("SELECT * FROM users WHERE phone = ? AND status = 'PENDING_ACTIVATION'").get(np);
  if (!user) return res.status(404).json({error: 'Номер телефона не найден или уже активирован'});
  if (user.activation_token !== String(token).trim()) return res.status(400).json({error: 'Неверный код активации'});
  res.json({ ok: true });
});

app.post('/api/auth/activate', authLimiter, (req, res) => {
  const { phone, token, first_name, last_name, middle_name, department, group_name, login, password, consent_version } = req.body;
  const np = normalizeRussianPhone(phone);
  const user = db.prepare("SELECT * FROM users WHERE phone = ? AND status = 'PENDING_ACTIVATION'").get(np);
  
  if (!user) {
    return res.status(400).json({error: 'Неверный код активации или пользователь не найден'});
  }
  
  if (user.activation_locked_until && new Date(user.activation_locked_until) > new Date()) {
    return res.status(429).json({error: 'Слишком много неверных попыток. Ввод временно заблокирован. Пожалуйста, подождите 15 минут.'});
  }
  
  if (user.activation_token !== String(token).trim()) {
    const attempts = (user.activation_attempts || 0) + 1;
    if (attempts >= 5) {
      const lockUntil = new Date(Date.now() + 15 * 60000).toISOString();
      db.prepare('UPDATE users SET activation_attempts = 0, activation_locked_until = ? WHERE id = ?').run(lockUntil, user.id);
      return res.status(429).json({error: 'Слишком много неверных попыток. Ввод временно заблокирован. Пожалуйста, подождите 15 минут.'});
    } else {
      db.prepare('UPDATE users SET activation_attempts = ? WHERE id = ?').run(attempts, user.id);
      return res.status(400).json({error: 'Неверный код активации'});
    }
  }

  if (!first_name || !last_name || !department || !group_name || !login || !password || !consent_version) {
    return res.status(400).json({error: 'Заполните все обязательные поля и дайте согласие'});
  }
  if (password.length < 8) {
    return res.status(400).json({error: 'Пароль должен содержать минимум 8 символов'});
  }
  
  if (/^\d+$/.test(login.trim())) {
    return res.status(400).json({error: 'Логин не может состоять только из цифр'});
  }
  if (normalizeRussianPhone(login.trim())) {
    return res.status(400).json({error: 'Логин не должен быть похож на номер телефона'});
  }
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_\-\.]+$/.test(login.trim()) || login.trim().length < 3) {
    return res.status(400).json({error: 'Логин должен быть от 3 символов и содержать только буквы, цифры, точки, тире или подчёркивания'});
  }

  const cyrillicFioRegex = /^[А-Яа-яЁё\s-]+$/;
  if (!cyrillicFioRegex.test(first_name.trim()) || !cyrillicFioRegex.test(last_name.trim())) {
    return res.status(400).json({ error: 'Имя и фамилия должны быть написаны русскими буквами' });
  }

  const cleanLogin = String(login).trim().toLowerCase();
  const existingLogin = db.prepare("SELECT id FROM users WHERE login = ?").get(cleanLogin);
  if (existingLogin) return res.status(409).json({error: 'Этот логин уже занят'});

  const hash = bcrypt.hashSync(password, 10);
  
  db.prepare(`
    UPDATE users 
    SET first_name=?, last_name=?, middle_name=?, department=?, group_name=?, login=?, password_hash=?, status='ACTIVE', activation_token=NULL, privacy_consent_at=CURRENT_TIMESTAMP, privacy_policy_version=?
    WHERE id=?
  `).run(normalizeName(first_name), normalizeName(last_name), normalizeName(middle_name || ''), department, group_name.trim(), cleanLogin, hash, consent_version, user.id);
  
  audit(user.id, 'USER_ACTIVATED', 'AUTH', user.id);
  res.json({ok: true, message: 'Аккаунт активирован. Вы можете войти.'});
});

// Update user (Admin only)
app.patch('/api/users/:id', strictAuth, role('ADMIN'), (req, res) => {
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
  if (d.first_name) d.first_name = normalizeName(d.first_name);
  if (d.last_name) d.last_name = normalizeName(d.last_name);
  if (d.middle_name) d.middle_name = normalizeName(d.middle_name);

  if (d.phone !== undefined && d.phone !== null && String(d.phone).trim() !== '') {
    const normalizedPhone = normalizeRussianPhone(String(d.phone).trim());
    if (!normalizedPhone) return res.status(400).json({ error: 'Некорректный номер телефона' });
    const existingPhoneUser = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(normalizedPhone, targetId);
    if (existingPhoneUser) return res.status(409).json({ error: 'Пользователь с таким номером телефона уже существует.' });
    d.phone = normalizedPhone;
  }

  db.prepare(`
    UPDATE users SET
      role = COALESCE(?, role),
      status = COALESCE(?, status),
      first_name = COALESCE(?, first_name),
      last_name = COALESCE(?, last_name),
      middle_name = COALESCE(?, middle_name),
      email = COALESCE(?, email),
      department = COALESCE(?, department),
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
    d.email, d.department, d.group_name, d.year, d.bio, d.skills, d.phone, d.max_contact, d.theme,
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
app.post('/api/users/:id/reset-password', strictAuth, role('ADMIN'), authLimiter, (req, res) => {
  const targetId = req.params.id;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!existing) return res.status(404).json({ error: 'Пользователь не найден' });

  const { newPassword, generate } = req.body || {};
  let finalPassword = '';
  if (generate || !newPassword) {
    finalPassword = generateTemporaryPassword();
  } else {
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Новый пароль должен содержать не менее 6 символов' });
    }
    finalPassword = String(newPassword);
  }

  const newHash = bcrypt.hashSync(finalPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(newHash, targetId);

  audit(req.user.id, 'PASSWORD_RESET_BY_ADMIN', 'USER', targetId, { login: existing.login });
  res.json({
    ok: true,
    message: `Пароль пользователя ${existing.login} успешно сброшен (при входе потребуется сменить пароль)`,
    temporaryPassword: finalPassword
  });
});

// ==========================================
// AUDIT LOGS
// ==========================================

app.get('/api/audit', strictAuth, role('ADMIN'), (req, res) => {
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
