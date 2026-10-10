import app from '../app.js';
import db from '../db.js';
import { strictAuth, safeUser, getHumanReadableAudit } from '../lib/shared.js';

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
