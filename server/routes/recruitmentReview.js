import app from '../app.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import db from '../db.js';
import storageService from '../storage.js';
import { strictAuth, role, safeUser, audit, createNotification, transliterateToLogin, normalizeRussianPhone, MEDIACODE_CONSENT_VERSION } from '../lib/shared.js';

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
    sql += ' AND u_match(?, ra.full_name, ra.public_id, ra.department, ra.group_name, ra.phone, ra.max_contact, ra.comment, ra.submission_text, rt.name, rt.title, rt.slug) = 1';
    args.push(search.trim());
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
    if (!fs.existsSync(safePath)) {
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

  if (appRecord.phone) {
    const normalizedPhone = normalizeRussianPhone(appRecord.phone) || String(appRecord.phone).trim();
    const existingPhoneUser = db.prepare('SELECT id FROM users WHERE phone = ?').get(normalizedPhone);
    if (existingPhoneUser) {
      return res.status(409).json({ error: 'Пользователь с таким номером телефона уже существует.' });
    }
  }

  // Parse name (consistent Russian FIO order: "Фамилия Имя [Отчество]")
  const nameParts = appRecord.full_name.trim().split(/\s+/);
  let firstName = nameParts[0] || 'Медиаволонтёр';
  let lastName = '';
  let middleName = '';

  if (nameParts.length >= 2) {
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
      ) VALUES (?, ?, 'STUDENT', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'ACTIVE', 1, CURRENT_TIMESTAMP, ?)
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
      appRecord.max_contact,
      MEDIACODE_CONSENT_VERSION
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
