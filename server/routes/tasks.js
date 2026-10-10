import app from '../app.js';
import db from '../db.js';
import { MAX_POINTS_PER_TRANSACTION } from '../config/eventCategories.js';
import { strictAuth, role, audit } from '../lib/shared.js';

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

    t.applicants = applicants.map((app, idx) => {
      const versions = db.prepare("SELECT * FROM application_versions WHERE application_id = ? ORDER BY version_number DESC").all(app.id);
      return {
        ...app,
        order_num: idx + 1,
        versions
      };
    });
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
