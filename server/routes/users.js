import app from '../app.js';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { authIpLimiter, authLimiter, strictAuth, role, safeStudentView, safeUser, audit, generateTemporaryPassword, normalizeRussianPhone, normalizeName, MEDIACODE_CONSENT_VERSION } from '../lib/shared.js';

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
  res.json(rows.map(row => {
    const precomputed = { totalPoints: row.points, completedTasksCount: row.completed };
    return isStudent ? safeStudentView(row, precomputed) : safeUser(row, precomputed);
  }));
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
    if (String(d.password).length < 8) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 8 символов' });
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
    
    const tempLogin = 'pending_' + Date.now() + '_' + Math.floor(Math.random()*10000);
      db.prepare(`
        INSERT INTO users (login, password_hash, role, phone, status, must_change_password)
        VALUES (?, '', 'STUDENT', ?, 'PENDING_ACTIVATION', 0)
      `).run(tempLogin, np);
      
      added.push({ phone: np });
  }

  res.json({ added, errors });
});

app.post('/api/auth/first-login-check', authIpLimiter, authLimiter, (req, res) => {
  const { phone } = req.body;
  const np = normalizeRussianPhone(phone);
  if (!np) return res.status(400).json({error: 'Неверные данные'});
  
  const user = db.prepare("SELECT * FROM users WHERE phone = ?").get(np);
  if (!user) {
    return res.status(404).json({error: 'Номер не найден', notFound: true});
  }
  if (user.status !== 'PENDING_ACTIVATION') {
    return res.status(400).json({error: 'Аккаунт уже активирован или заблокирован. Используйте обычный вход по паролю.'});
  }
  
  res.json({ ok: true, user: { first_name: user.first_name, last_name: user.last_name, group_name: user.group_name } });
});

app.post('/api/auth/activate', authIpLimiter, authLimiter, (req, res) => {
  const { phone, first_name, last_name, middle_name, department, group_name, login, password } = req.body || {};
  const np = normalizeRussianPhone(phone);
  
  if (!first_name || !last_name || !department || !group_name || !login || !password) {
    return res.status(400).json({error: 'Заполните все обязательные поля'});
  }
  
  if (password.length < 8) return res.status(400).json({error: 'Пароль должен содержать минимум 8 символов'});

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
  
  const user = db.prepare("SELECT * FROM users WHERE phone = ?").get(np);

  if (user) {
    if (user.status === 'ACTIVE') return res.status(400).json({error: 'Аккаунт уже активирован'});
    if (user.status === 'DISABLED') return res.status(400).json({error: 'Аккаунт заблокирован'});
    if (user.status === 'PENDING_APPROVAL') return res.status(400).json({error: 'Регистрация отправлена на подтверждение администратору.'});
    
    // existing user (PENDING_ACTIVATION or PENDING_APPROVAL) becomes ACTIVE
    db.prepare(`
      UPDATE users 
      SET first_name=?, last_name=?, middle_name=?, department=?, group_name=?, login=?, password_hash=?, status='ACTIVE', activation_token=NULL, activation_expires_at=NULL, activation_attempts=0, activation_locked_until=NULL, privacy_consent_at=CURRENT_TIMESTAMP, privacy_policy_version=?, privacy_consent_source='registration_start'
      WHERE id=?
    `).run(normalizeName(first_name), normalizeName(last_name), normalizeName(middle_name || ''), department, group_name.trim(), cleanLogin, hash, MEDIACODE_CONSENT_VERSION, user.id);
    
    audit(user.id, 'USER_ACTIVATED', 'AUTH', user.id);
    res.json({ok: true, message: 'Аккаунт активирован! Используйте логин и пароль для входа.'});
  } else {
    // new user becomes PENDING_APPROVAL
    const result = db.prepare(`
      INSERT INTO users (phone, first_name, last_name, middle_name, department, group_name, login, password_hash, status, role, privacy_consent_at, privacy_policy_version, privacy_consent_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', 'STUDENT', CURRENT_TIMESTAMP, ?, 'registration_start')
    `).run(np, normalizeName(first_name), normalizeName(last_name), normalizeName(middle_name || ''), department, group_name.trim(), cleanLogin, hash, MEDIACODE_CONSENT_VERSION);
    
    audit(result.lastInsertRowid, 'USER_REGISTERED', 'AUTH', result.lastInsertRowid);
    res.json({ok: true, message: 'Регистрация отправлена на подтверждение администратору.'});
  }
});

app.get('/api/admin/registrations/pending', strictAuth, role('ADMIN'), (req, res) => {
  const registrations = db.prepare(`SELECT id, first_name, last_name, middle_name, phone, group_name, department, joined_at
    FROM users WHERE status='PENDING_APPROVAL' ORDER BY joined_at ASC`).all();
  res.json({ registrations });
});

app.post('/api/admin/registrations/:id/approve', strictAuth, role('ADMIN'), (req, res) => {
  const result = db.prepare("UPDATE users SET status='ACTIVE' WHERE id=? AND status='PENDING_APPROVAL'").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Регистрация не найдена.' });
  audit(req.user.id, 'REGISTRATION_APPROVED', 'USER', req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/registrations/:id/reject', strictAuth, role('ADMIN'), (req, res) => {
  const result = db.prepare("UPDATE users SET status='REJECTED' WHERE id=? AND status='PENDING_APPROVAL'").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Регистрация не найдена.' });
  audit(req.user.id, 'REGISTRATION_REJECTED', 'USER', req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/registrations/approve-all', strictAuth, role('ADMIN'), (req, res) => {
  const result = db.transaction(() => db.prepare("UPDATE users SET status='ACTIVE' WHERE status='PENDING_APPROVAL'").run())();
  audit(req.user.id, 'REGISTRATIONS_APPROVED_ALL', 'USER', null, { count: result.changes });
  res.json({ ok: true, count: result.changes });
});

// Update user (Admin only)
app.patch('/api/users/:id', strictAuth, role('ADMIN'), (req, res) => {
  const targetId = req.params.id;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!existing) return res.status(404).json({ error: 'Пользователь не найден' });

  // Prevent self-demotion or self-disable
  if (targetId == req.user.id && ( (req.body.role && req.body.role !== 'ADMIN') || req.body.status === 'DISABLED' )) {
    return res.status(403).json({ error: 'Нельзя понизить в должности или отключить самого себя' });
  }

  // Prevent last admin from being disabled or demoted
  if (existing.role === 'ADMIN' && (req.body.role !== undefined && req.body.role !== 'ADMIN' || req.body.status === 'DISABLED')) {
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
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Новый пароль должен содержать не менее 8 символов' });
    }
    finalPassword = String(newPassword);
  }

  const newHash = bcrypt.hashSync(finalPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(newHash, targetId);
  // An old authenticated session must not be able to choose the replacement password.
  db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.user.id') = ?").run(Number(targetId));

  audit(req.user.id, 'PASSWORD_RESET_BY_ADMIN', 'USER', targetId, { login: existing.login });
  res.json({
    ok: true,
    message: `Пароль пользователя ${existing.login} успешно сброшен (при входе потребуется сменить пароль)`,
    temporaryPassword: finalPassword
  });
});
