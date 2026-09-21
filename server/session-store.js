import session from 'express-session';
import db from './db.js';
db.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)');
export default class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try { const row = db.prepare('SELECT data FROM sessions WHERE sid=? AND expires>?').get(sid, Date.now()); callback(null, row ? JSON.parse(row.data) : null); } catch (error) { callback(error); }
  }
  set(sid, value, callback = () => {}) {
    try { db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()); db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(sid, JSON.stringify(value), new Date(value.cookie.expires).getTime()); callback(); } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); callback(); } catch (error) { callback(error); }
  }
}
