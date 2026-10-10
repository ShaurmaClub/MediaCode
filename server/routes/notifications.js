import app from '../app.js';
import db from '../db.js';
import { strictAuth } from '../lib/shared.js';

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
