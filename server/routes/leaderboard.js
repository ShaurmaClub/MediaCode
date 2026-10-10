import app from '../app.js';
import db from '../db.js';
import { strictAuth } from '../lib/shared.js';

// ==========================================
// LEADERBOARD
// ==========================================

app.get('/api/leaderboard', strictAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT
      u.id, u.first_name, u.last_name, u.group_name, u.year, u.skills, u.bio,
      COALESCE(SUM(p.amount), 0) as points,
      (SELECT COUNT(*) FROM applications a WHERE a.user_id = u.id AND a.status = 'COMPLETED') as completed
    FROM users u
    LEFT JOIN points p ON p.user_id = u.id
    WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE'
    GROUP BY u.id
    ORDER BY points DESC, completed DESC, u.last_name ASC
  `).all();

  res.json(rows.map((r, i) => ({ ...r, position: i + 1 })));
});
