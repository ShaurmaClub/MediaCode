import app from '../app.js';
import db, { matchesSearchQuery } from '../db.js';
import { strictAuth, role, getHumanReadableAudit } from '../lib/shared.js';

// ==========================================
// AUDIT LOGS
// ==========================================

app.get('/api/audit', strictAuth, role('ADMIN'), (req, res) => {
  const { action, entity_type, search, limit = 200 } = req.query;

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
  let formatted = rows.map(r => ({
    ...r,
    human_description: getHumanReadableAudit(r.action, r.actor_name, r.entity_type, r.entity_id, r.metadata)
  }));

  if (search && String(search).trim()) {
    const q = String(search).trim();
    formatted = formatted.filter(r =>
      Boolean(matchesSearchQuery(q, r.actor_name, r.actor_login, r.action, r.entity_type, r.entity_id, r.human_description, r.metadata))
    );
  }

  res.json(formatted);
});
