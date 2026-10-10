import app from '../app.js';
import fs from 'fs';
import db, { DEPARTMENTS } from '../db.js';
import storageService, { uploadMiddleware } from '../storage.js';
import { recruitmentApplyLimiter, audit, createNotification, normalizeRussianPhone, isValidYandexDiskLink, MEDIACODE_CONSENT_VERSION } from '../lib/shared.js';

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
            portfolio_url, submission_url, submission_text, comment, status, consent_version, consent_accepted_at, privacy_consent_source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, CURRENT_TIMESTAMP, 'recruitment')
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
          comment ? String(comment).trim() : null,
          MEDIACODE_CONSENT_VERSION
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
