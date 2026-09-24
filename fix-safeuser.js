const fs = require('fs');
let content = fs.readFileSync('server/index.js', 'utf8');

const replacement = \xport function safeUser(u) {
  if (!u) return null;
  const total = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM points WHERE user_id = ?').get(u.id)?.total || 0;
  const completedCount = db.prepare("SELECT COUNT(*) as cnt FROM applications WHERE user_id = ? AND status = 'COMPLETED'").get(u.id)?.cnt || 0;
  return {
    id: u.id,
    public_id: u.public_id,
    login: u.login,
    role: u.role,
    status: u.status,
    first_name: u.first_name,
    last_name: u.last_name,
    middle_name: u.middle_name,
    email: u.email,
    department: u.department,
    group_name: u.group_name,
    year: u.year,
    bio: u.bio,
    skills: u.skills,
    phone: u.phone,
    max_contact: u.max_contact,
    theme: u.theme,
    must_change_password: Boolean(u.must_change_password),
    privacy_consent_at: u.privacy_consent_at,
    privacy_policy_version: u.privacy_policy_version,
    privacy_consent_source: u.privacy_consent_source,
    max_user_id: u.max_user_id || null,
    max_username: u.max_username || null,
    max_contact_verified: Boolean(u.max_contact_verified),
    phone_verified: Boolean(u.phone_verified),
    totalPoints: total,
    completedTasksCount: completedCount,
    created_at: u.created_at
  };
}\;

content = content.replace(/export function safeUser\(u\) \{[\s\S]*?completedTasksCount: completedCount\r?\n\s*\};\r?\n\s*\}/m, replacement);
fs.writeFileSync('server/index.js', content);
