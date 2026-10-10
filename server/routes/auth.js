import app from '../app.js';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { validateMaxInitData, getMaxConfig } from '../max.js';
import { authIpLimiter, authLimiter, auth, safeUser, audit, createNotification, normalizeRussianPhone, MEDIACODE_CONSENT_VERSION } from '../lib/shared.js';

// ==========================================
// AUTH ROUTES
// ==========================================

app.get('/api/health', (req, res) => {
  // Реальная проверка БД: при недоступной базе отвечаем 503, чтобы мониторинг/прокси это заметили
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, db: 'ok', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(503).json({ ok: false, db: 'error', timestamp: new Date().toISOString() });
  }
});

app.post('/api/auth/login', authIpLimiter, authLimiter, (req, res) => {
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
    const pendingApproval = db.prepare("SELECT id FROM users WHERE phone = ? AND status = 'PENDING_APPROVAL'").get(normalizedPhone);
    if (pendingApproval) return res.status(403).json({ error: 'Регистрация отправлена на подтверждение администратору.', code: 'PENDING_APPROVAL' });
    user = db.prepare("SELECT * FROM users WHERE phone = ? AND status = 'ACTIVE'").get(normalizedPhone);
  } else {
    const pendingApproval = db.prepare("SELECT id FROM users WHERE login = ? AND status = 'PENDING_APPROVAL'").get(cleanLogin);
    if (pendingApproval) return res.status(403).json({ error: 'Регистрация отправлена на подтверждение администратору.', code: 'PENDING_APPROVAL' });
    user = db.prepare("SELECT * FROM users WHERE login = ? AND status = 'ACTIVE'").get(cleanLogin);
  }
  
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    audit(user?.id || null, 'LOGIN_FAILED', 'AUTH', null, { login });
    return res.status(401).json({ error: 'Неверный логин, номер телефона или пароль.' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Ошибка сессии' });
    req.session.user = { id: user.id, login: user.login, role: user.role, first_name: user.first_name, last_name: user.last_name };
    audit(user.id, 'LOGIN_SUCCESS', 'AUTH', user.id);
    res.json({ user: safeUser(user) });
  });
});

app.post('/api/auth/registration-start', authIpLimiter, authLimiter, (req, res) => {
  const phone = normalizeRussianPhone(req.body?.phone);
  if (!phone || req.body?.privacy_consent !== true) return res.status(400).json({ error: 'Требуется согласие на обработку персональных данных.' });
  const user = db.prepare("SELECT id, status FROM users WHERE phone = ?").get(phone);
    if (user && user.status === 'ACTIVE') return res.status(400).json({ error: 'Аккаунт уже активирован, используйте вход по логину или телефону.' });
    if (user && user.status === 'PENDING_ACTIVATION') {
      db.prepare("UPDATE users SET privacy_consent_at=CURRENT_TIMESTAMP, privacy_policy_version=?, privacy_consent_source='registration_start' WHERE id=?").run(MEDIACODE_CONSENT_VERSION, user.id);
    }
    // If !user, they proceed to fill the form and will be inserted as PENDING_APPROVAL during /activate
  res.json({ ok: true, phone });
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
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Новый пароль должен содержать не менее 8 символов' });
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
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Новый пароль должен содержать не менее 8 символов' });
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
  const { consent, consent_version } = req.body || {};
  if (consent !== true || !consent_version) {
    return res.status(400).json({ error: 'Требуется версия политики' });
  }
  
  db.prepare("UPDATE users SET privacy_consent_at = CURRENT_TIMESTAMP, privacy_policy_version = ?, privacy_consent_source = 'account' WHERE id = ?").run(consent_version, req.user.id);
  audit(req.user.id, 'PRIVACY_CONSENT_ACCOUNT', 'AUTH', req.user.id, { version: consent_version });
  
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

  const linkedElsewhere = db.prepare('SELECT id FROM users WHERE max_user_id = ? AND id != ?').get(String(maxUser.id), user.id);
  if (linkedElsewhere) {
    return res.status(409).json({ error: 'MAX identity is already linked to another account' });
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
    const { initData } = req.body || {};
    
    if (!initData) {
      return res.status(400).json({ error: 'Отсутствуют данные авторизации Макс' });
    }
    
    const validation = validateMaxInitData(initData);
    if (!validation.valid || !validation.user) {
      return res.status(400).json({ error: validation.error || 'Недействительные данные авторизации Макс' });
    }
    
    const userIdToLink = validation.user.id;
    const usernameToLink = validation.user.username;
    
    if (!userIdToLink && !usernameToLink) {
      return res.status(400).json({ error: 'Укажите данные аккаунта Макс' });
    }

    if (userIdToLink) {
      const existingLink = db.prepare('SELECT id FROM users WHERE max_user_id = ? AND id != ?').get(String(userIdToLink), req.user.id);
      if (existingLink) {
        return res.status(409).json({ error: 'Этот профиль Макс уже привязан к другому аккаунту' });
      }
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
