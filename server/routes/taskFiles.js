import app from '../app.js';
import fs from 'fs';
import path from 'path';
import db from '../db.js';
import storageService from '../storage.js';
import { strictAuth } from '../lib/shared.js';

// ==========================================
// TASK FILE DOWNLOAD
// ==========================================

app.get('/api/tasks/files/download', strictAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'Неверный путь к файлу' });
  }

  // Find if this path belongs to an application version accessible by the user.
  // Actually, we should check if the user is STAFF/ADMIN or if it's the student's own application.
  const version = db.prepare('SELECT v.file_path, a.user_id FROM application_versions v JOIN applications a ON v.application_id = a.id WHERE v.file_path = ?').get(filePath);
  if (!version) return res.status(404).json({ error: 'Файл не найден' });
  let isAuthorized = false;
  if (req.user.role === 'STAFF' || req.user.role === 'ADMIN') {
    isAuthorized = true;
  } else {
    // Check if the user owns this file
    if (version && version.user_id === req.user.id) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }

  const filename = path.basename(filePath);
  try {
    const safePath = storageService.getSafeFilePath(filename);
    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'Файл не найден' });
    }
    res.download(safePath);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка сервера при скачивании' });
  }
});
