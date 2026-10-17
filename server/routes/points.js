import app from '../app.js';
import db from '../db.js';
import { MAX_POINTS_PER_TRANSACTION } from '../config/eventCategories.js';
import { strictAuth, role, safeStudentView, safeUser, audit, createNotification } from '../lib/shared.js';

// ==========================================
// POINTS & RECORD BOOK
// ==========================================

// Staff / Admin awards manual points or bonus to student
app.post('/api/points/award', strictAuth, role('STAFF', 'ADMIN'), (req, res) => {
  const { user_id, amount, reason, category, task_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'Укажите студента' });
  if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: 'Укажите причину начисления' });

  const numAmount = Number(amount);
  if (!Number.isSafeInteger(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Сумма баллов должна быть больше 0' });
  }
  if (numAmount > MAX_POINTS_PER_TRANSACTION) {
    return res.status(400).json({ error: `Сумма баллов за одну операцию не может превышать ${MAX_POINTS_PER_TRANSACTION}` });
  }

  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!targetUser) return res.status(404).json({ error: 'Пользователь не найден' });
  if (targetUser.role !== 'STUDENT') return res.status(400).json({ error: 'Баллы начисляются только студентам' });

  const cat = category || 'BONUS';
  if (typeof cat !== 'string' || ['COMPLETION', 'CORRECTION'].includes(cat)) {
    return res.status(400).json({ error: 'Используйте подтверждение выполнения или отмену начисления для этой категории' });
  }
  if (task_id && !db.prepare('SELECT id FROM tasks WHERE id = ?').get(task_id)) {
    return res.status(400).json({ error: 'Мероприятие не найдено' });
  }
  const r = db.prepare(`
    INSERT INTO points (user_id, amount, reason, category, task_id, issued_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user_id, numAmount, reason.trim(), cat, task_id || null, req.user.id);

  createNotification(
    user_id,
    'Начислены баллы в зачётку',
    `+${numAmount} баллов: ${reason}`,
    '/record-book'
  );

  audit(req.user.id, 'POINTS_MANUALLY_ISSUED', 'POINT', r.lastInsertRowid, {
    targetUserId: user_id,
    amount: numAmount,
    reason,
    category: cat
  });

  res.status(201).json({ ok: true, id: r.lastInsertRowid, message: 'Баллы успешно внесены в ledger' });
});

// Staff / Admin reverses points transaction
app.post('/api/points/:id/reverse', strictAuth, role('ADMIN'), (req, res) => {
  const pointId = req.params.id;
  const original = db.prepare('SELECT * FROM points WHERE id = ?').get(pointId);
  if (!original) return res.status(404).json({ error: 'Запись начисления не найдена' });

  if (original.is_reversed === 1) {
    return res.status(400).json({ error: 'Это начисление уже было отменено' });
  }

  if (original.amount <= 0) {
    return res.status(400).json({ error: 'Нельзя отменить отрицательную или нулевую запись' });
  }

  const { reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Укажите причину отмены начисления' });
  }
  const cleanReason = String(reason).trim();

  let counterTxId;
  const tx = db.transaction(() => {
    // 1. Mark original as reversed
    db.prepare('UPDATE points SET is_reversed = 1, reversal_reason = ? WHERE id = ?').run(cleanReason, pointId);

    // 2. Create counter transaction
    const r = db.prepare(`
      INSERT INTO points (user_id, amount, reason, category, task_id, issued_by, reversal_of_id)
      VALUES (?, ?, ?, 'CORRECTION', ?, ?, ?)
    `).run(
      original.user_id,
      -original.amount,
      `Отмена начисления: ${cleanReason}`,
      original.task_id || null,
      req.user.id,
      original.id
    );
    counterTxId = r.lastInsertRowid;

    // 2.5. If reversing a task completion reward, reopen the application so it can be re-confirmed
    if (original.category === 'COMPLETION' && original.task_id) {
      db.prepare(`
        UPDATE applications
        SET status = 'COMPLETION_SUBMITTED', updated_at = CURRENT_TIMESTAMP
        WHERE task_id = ? AND user_id = ? AND status = 'COMPLETED'
      `).run(original.task_id, original.user_id);
    }

    // 3. Notify student
    createNotification(
      original.user_id,
      'Отмена начисления баллов',
      `Отменено начисление ${original.amount} баллов. Причина: ${cleanReason}`,
      '/record-book'
    );
  });

  tx();

  audit(req.user.id, 'POINTS_REVERSED', 'POINT', original.id, {
    originalPointId: original.id,
    counterTxId,
    studentId: original.user_id,
    reversalAmount: original.amount,
    reason: cleanReason
  });

  res.json({ ok: true, message: `Начисление ${original.amount} баллов успешно отменено`, counterTxId });
});

// Get record book for current user
app.get('/api/record-book', strictAuth, (req, res) => {
  const userId = req.user.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const points = db.prepare(`
    SELECT p.*, t.title as task_title, u.first_name || ' ' || u.last_name as issuer_name
    FROM points p
    LEFT JOIN tasks t ON t.id = p.task_id
    LEFT JOIN users u ON u.id = p.issued_by
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId);

  res.json({
    user: safeUser(user),
    points
  });
});

// Get record book for specific student
app.get('/api/record-book/:id', strictAuth, (req, res) => {
  const targetId = req.params.id;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  // Students can only view record books of active students or their own.
  // Viewing STAFF/ADMIN or inactive users by a student returns 403 Forbidden.
  if (req.user.role === 'STUDENT') {
    if (user.role !== 'STUDENT' || user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Зачётная книжка недоступна для просмотра' });
    }
  }

  const points = db.prepare(`
    SELECT p.*, t.title as task_title, u.first_name || ' ' || u.last_name as issuer_name
    FROM points p
    LEFT JOIN tasks t ON t.id = p.task_id
    LEFT JOIN users u ON u.id = p.issued_by
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(targetId);

  res.json({
    user: (req.user.role === 'STUDENT' && Number(targetId) !== req.user.id) ? safeStudentView(user) : safeUser(user),
    points
  });
});
