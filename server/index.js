import 'dotenv/config';
import app from './app.js';
import './routes/auth.js';
import './routes/dashboard.js';
import './routes/recruitmentPublic.js';
import './routes/recruitmentReview.js';
import './routes/tasks.js';
import './routes/applications.js';
import './routes/points.js';
import './routes/leaderboard.js';
import './routes/notifications.js';
import './routes/users.js';
import './routes/audit.js';
import './routes/taskFiles.js';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { startAutoBackup } from './backup.js';
import { MEDIACODE_CONSENT_VERSION, isProduction } from './lib/shared.js';

// Сохраняем прежний публичный экспорт модуля
export { MEDIACODE_CONSENT_VERSION };

// ==========================================
// STATIC ASSETS & SPA ROUTING
// ==========================================



const __dirname = path.dirname(fileURLToPath(import.meta.url));

const distPath = path.join(__dirname, '../dist');
// Хешированные ассеты кэшируем надолго, index.html — никогда (иначе после деплоя пользователи видят старую версию)
app.use('/assets', express.static(path.join(distPath, 'assets'), { maxAge: '1y', immutable: true }));
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(path.join(distPath, 'index.html'));
  }
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint не найден' });
  }
  next();
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера', details: isProduction ? undefined : err.message });
});

const PORT = process.env.PORT || 4000;
export const server = app.listen(PORT, () => {
  console.log(`Media Center backend is running on http://localhost:${PORT}`);
});

startAutoBackup(db);

// Корректное завершение: дожидаемся запросов, сбрасываем WAL в основной файл БД и закрываем её
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} получен, завершаем работу...`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close(() => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (err) {
      console.error('Ошибка при закрытии БД:', err.message);
    }
    process.exit(0);
  });
}
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  gracefulShutdown('uncaughtException');
});

export default app;
