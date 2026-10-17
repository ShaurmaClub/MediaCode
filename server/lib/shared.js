import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import crypto from 'crypto';
import db from '../db.js';

export const isProduction = process.env.NODE_ENV === 'production';
// Version of the MediaCode-specific consent text.
export const MEDIACODE_CONSENT_VERSION = '2026-09-25';

// Shared college NATs must not turn one IP into one user. Per-account limits
// stop credential stuffing while this broad ceiling protects the server.
export const authIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1200, standardHeaders: true, legacyHeaders: false });
export const authIdentityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const value = req.body?.phone || req.body?.login || req.body?.loginOrContact;
    if (!value) {
      // Authenticated routes (change-password, change-login...) carry no login in the body:
      // key them per account, otherwise every user shares a single global bucket.
      return req.session?.user?.id ? `user:${req.session.user.id}` : `ip:${ipKeyGenerator(req.ip)}`;
    }
    return String(value).replace(/\D/g, '') || String(value).trim().toLowerCase();
  }
});

// Rate limiter for uploads and reports
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Превышен лимит загрузок. Пожалуйста, подождите час.' }
});

export const authLimiterLegacy = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Пожалуйста, подождите 15 минут.' }
});
export const authLimiter = authIdentityLimiter;

// Rate limiter for public recruitment application submissions
export const recruitmentApplyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток отправки заявки. Пожалуйста, подождите 10 минут.' }
});

// Revoke every session of a user except (optionally) the current one.
// Used after password changes so a stolen/old session cannot outlive the old password.
export function revokeUserSessions(userId, exceptSid = null) {
  db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.user.id') = ? AND sid != ?").run(Number(userId), exceptSid || '');
}

// Middleware: Verify authentication
export const auth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Требуется авторизация в системе' });
  }
  // Sessions identify the account; current permissions always come from the DB.
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || user.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Аккаунт не активен' });
  }
  req.user = { ...req.session.user, role: user.role, status: user.status };
  next();
};

export const strictAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Требуется авторизация в системе' });
  }
  const user = db.prepare('SELECT id, login, role, status, must_change_password, privacy_consent_at FROM users WHERE id = ?').get(req.session.user.id);
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
  
  req.user = { ...req.session.user, role: user.role, status: user.status };
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
  const total = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM points WHERE user_id = ?').get(u.id)?.total || 0;
  const completedCount = db.prepare("SELECT COUNT(*) as cnt FROM applications WHERE user_id = ? AND status = 'COMPLETED'").get(u.id)?.cnt || 0;
  return {
    id: u.id,
    public_id: u.public_id,
    login: u.login,
    role: u.role,
    status: u.status,
    first_name: u.first_name,
    last_name: u.last_name,
    middle_name: u.middle_name,
    email: u.email,
    department: u.department,
    group_name: u.group_name,
    year: u.year,
    bio: u.bio,
    skills: u.skills,
    phone: u.phone,
    max_contact: u.max_contact,
    theme: u.theme,
    must_change_password: Boolean(u.must_change_password),
    privacy_consent_at: u.privacy_consent_at,
    privacy_policy_version: u.privacy_policy_version,
    privacy_consent_source: u.privacy_consent_source,
    max_user_id: u.max_user_id || null,
    max_username: u.max_username || null,
    max_contact_verified: Boolean(u.max_contact_verified),
    phone_verified: Boolean(u.phone_verified),
    totalPoints: total,
    completedTasksCount: completedCount,
    created_at: u.created_at
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
      case 'PRIVACY_CONSENT_RECRUITMENT':
        return 'Подтверждено согласие на обработку персональных данных при подаче заявки';
      case 'PRIVACY_CONSENT_ACCOUNT':
        return 'Подтверждено согласие на обработку персональных данных для личного кабинета';
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


// Russian phone normalization helper: stores as +7XXXXXXXXXX
export function normalizeRussianPhone(rawPhone) {
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

export function normalizeName(name) {
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
