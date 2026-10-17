import app from '../app.js';
import db from '../db.js';
import storageService, { uploadMiddleware } from '../storage.js';
import { MAX_POINTS_PER_TRANSACTION } from '../config/eventCategories.js';
import { uploadLimiter, strictAuth, role, audit, createNotification } from '../lib/shared.js';

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

  const body = req.body || {};
  if (task.deadline && Date.now() > Date.parse(task.deadline.length === 10 ? `${task.deadline}T23:59:59+03:00` : task.deadline)) {
    return res.status(400).json({ error: 'Срок подачи заявок истёк' });
  }
  const roleName = body.role_name ? String(body.role_name).trim() : null;

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
app.post('/api/tasks/:id/submit-completion', strictAuth, role('STUDENT'), uploadLimiter, uploadMiddleware.single('file'), (req, res) => {
  const taskId = req.params.id;
  const appRecord = db.prepare('SELECT * FROM applications WHERE task_id = ? AND user_id = ?').get(taskId, req.user.id);
  if (!appRecord) {
    if (req.file) storageService.deleteFile(req.file.filename);
    return res.status(404).json({ error: 'Вы не являетесь участником этого мероприятия' });
  }

  if (!['SELECTED', 'IN_PROGRESS', 'COMPLETION_SUBMITTED', 'REVISION_REQUESTED'].includes(appRecord.status)) {
    if (req.file) storageService.deleteFile(req.file.filename);
    return res.status(400).json({ error: 'Отправка отчёта недоступна для вашего текущего статуса' });
  }

  const { comment, materials_url, submission_method } = req.body;
  const c = comment ? String(comment).trim() : '';
  const mu = materials_url ? String(materials_url).trim() : '';
  let filePath = null;

  if (submission_method === 'file') {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }
    if (!storageService.filesHaveValidContent([req.file])) {
      storageService.deleteFile(req.file.filename);
      return res.status(400).json({ error: 'Содержимое файла не соответствует его расширению' });
    }
    filePath = `/uploads/recruitment/${req.file.filename}`;
  } else if (submission_method === 'link') {
    if (!mu) {
      return res.status(400).json({ error: 'Не указана ссылка' });
    }
  }

  // Get next version
  const v = db.prepare('SELECT COALESCE(MAX(version_number), 0) as m FROM application_versions WHERE application_id = ?').get(appRecord.id).m;
  const nextVer = v + 1;

  db.exec('BEGIN TRANSACTION;');
  try {
    db.prepare(`
      INSERT INTO application_versions (application_id, version_number, materials_url, file_path, comment, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(appRecord.id, nextVer, submission_method === 'link' ? mu : null, filePath, c, req.user.id);

    db.prepare(`
      UPDATE applications
      SET status = 'COMPLETION_SUBMITTED', submission_notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(c, appRecord.id);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    if (req.file) storageService.deleteFile(req.file.filename);
    return res.status(500).json({ error: 'Ошибка сохранения отчёта' });
  }

  const task = db.prepare('SELECT creator_id, title FROM tasks WHERE id = ?').get(taskId);
  if (task && task.creator_id) {
    createNotification(
      task.creator_id,
      'Работа сдана медиаволонтёром',
      `${req.user.first_name} ${req.user.last_name} отправил(а) отчёт (версия ${nextVer}) по мероприятию «${task.title}»`,
      `/tasks/${taskId}`
    );
  }

  audit(req.user.id, 'COMPLETION_SUBMITTED', 'APPLICATION', appRecord.id, { taskId, version: nextVer });
  res.json({ ok: true, message: 'Отчёт успешно отправлен на подтверждение сотруднику' });
});

// Staff / Admin updates application status (SELECTED, REJECTED, IN_PROGRESS, NO_SHOW, etc.)
app.patch('/api/applications/:id', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
  const appId = req.params.id;
  const appRecord = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId);
  if (!appRecord) return res.status(404).json({ error: 'Заявка не найдена' });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(appRecord.task_id);
  const transitions = {
    APPLIED: ['SELECTED', 'REJECTED'], SELECTED: ['IN_PROGRESS', 'REJECTED', 'NO_SHOW'],
    IN_PROGRESS: ['NO_SHOW'], COMPLETION_SUBMITTED: ['IN_PROGRESS', 'NO_SHOW'],
    REJECTED: ['APPLIED'], WITHDRAWN: [], COMPLETED: [], NO_SHOW: []
  };
  const newStatus = req.body?.status;
  if (!(transitions[appRecord.status] || []).includes(newStatus)) {
    return res.status(400).json({ error: 'Недопустимый переход статуса. Для завершения используйте подтверждение выполнения.' });
  }
  if (['DRAFT', 'CANCELLED', 'ARCHIVED', 'COMPLETED'].includes(task.status)) {
    return res.status(400).json({ error: 'Управление участием в закрытом мероприятии недоступно' });
  }
  if (newStatus === 'SELECTED') {
    const occupied = db.prepare("SELECT COUNT(*) c FROM applications WHERE task_id = ? AND status IN ('SELECTED','IN_PROGRESS','COMPLETION_SUBMITTED','COMPLETED')").get(task.id).c;
    if (occupied >= task.required_volunteers) return res.status(409).json({ error: 'Все места уже заняты' });
  }

  db.prepare('UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, appId);

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
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return res.status(404).json({ error: 'Мероприятие не найдено' });
  if (['DRAFT', 'CANCELLED', 'ARCHIVED'].includes(task.status)) return res.status(400).json({ error: 'Мероприятие закрыто для подтверждения' });
  const targetUserId = req.body?.user_id;
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
