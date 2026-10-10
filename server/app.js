import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import SQLiteSessionStore from './session-store.js';
import helmet from 'helmet';
import { seed } from './db.js';
import { isProduction } from './lib/shared.js';


// Production security check: SESSION_SECRET must be explicitly set and secure
if (isProduction) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.includes('change-me') || process.env.SESSION_SECRET.includes('secret-key')) {
    console.error('CRITICAL ERROR: В режиме production переменная окружения SESSION_SECRET обязательна и должна содержать надёжный уникальный секретный ключ.');
    process.exit(1);
  }
} else {
  // In development, run seed
  seed();
}

const app = express();

// Trust reverse proxy (nginx / traefik / caddy)
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

if (isProduction && !process.env.SESSION_SECRET) {
  console.error("FATAL ERROR: SESSION_SECRET is not set in production!");
  process.exit(1);
}

app.use(session({
  store: new SQLiteSessionStore(),
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

export default app;
