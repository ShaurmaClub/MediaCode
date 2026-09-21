import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { KeyRound, AlertCircle } from 'lucide-react';
import { api } from './api.js';
import { ToastProvider } from './context/ToastContext.jsx';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tasks from './pages/Tasks.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import TaskForm from './pages/TaskForm.jsx';
import Students from './pages/Students.jsx';
import RecordBook from './pages/RecordBook.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Notifications from './pages/Notifications.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminAudit from './pages/AdminAudit.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import PublicRecruitment from './pages/PublicRecruitment.jsx';
import RecruitmentReview from './pages/RecruitmentReview.jsx';
import './styles.css';

function isRecruitmentSubdomain() {
  const host = window.location.hostname.toLowerCase();
  return ['photo.', 'video.', 'montage.', 'design.', 'smm.', 'content.'].some((prefix) => host.startsWith(prefix));
}

function FirstLoginModal({ user, onPasswordChanged }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setError('Новый пароль должен содержать минимум 6 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/first-login-password-change', {
        method: 'POST',
        body: JSON.stringify({ newPassword })
      });
      onPasswordChanged(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="privacy-modal-backdrop" style={{ zIndex: 1000 }}>
      <div className="privacy-modal-content" style={{ maxWidth: '440px' }}>
        <div className="privacy-modal-header">
          <KeyRound size={22} className="shield-icon" style={{ color: 'var(--accent)' }} />
          <h3>Смена временного пароля</h3>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px' }}>
          <p className="muted" style={{ fontSize: '13px', lineHeight: 1.5, marginBottom: '16px' }}>
            Вы вошли по временному паролю, выданному куратором или администратором. В целях безопасности установите свой постоянный пароль для доступа в систему «МедиаКод».
          </p>

          {error && (
            <div className="form-error-banner" style={{ marginBottom: '14px' }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label>Новый пароль (минимум 6 символов) *</label>
            <input
              type="password"
              required
              autoFocus
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Введите новый пароль"
            />
          </div>

          <div className="form-group">
            <label>Повторите новый пароль *</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Повторите пароль"
            />
          </div>

          <button type="submit" className="btn primary wide" disabled={busy} style={{ marginTop: '10px' }}>
            {busy ? 'Сохранение пароля…' : 'Установить пароль и продолжить'}
          </button>
        </form>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system');

  // Fetch current user on mount
  useEffect(() => {
    api('/auth/me')
      .then((res) => {
        setUser(res.user);
        if (res.user.theme) {
          setTheme(res.user.theme);
        }
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Theme application logic
  useEffect(() => {
    localStorage.setItem('theme', theme);

    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';

      const listener = (e) => {
        if (localStorage.getItem('theme') === 'system') {
          document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
        }
      };
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  if (loading) {
    return (
      <div className="splash">
        <img src="/mediacode-logo.png" alt="МедиаКод" className="brand-img-lg" />
        <div className="splash-indicator" />
        <span className="splash-sub">Студенческий медиацентр</span>
      </div>
    );
  }

  const pathname = window.location.pathname;
  const isPublicRecruitmentPath = pathname.startsWith('/join') || (isRecruitmentSubdomain() && pathname === '/');

  if (isPublicRecruitmentPath && !pathname.startsWith('/api')) {
    return (
      <Routes>
        <Route path="/join/:trackSlug" element={<PublicRecruitment />} />
        <Route path="/join" element={<PublicRecruitment />} />
        <Route path="*" element={<PublicRecruitment />} />
      </Routes>
    );
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  const isStaffOrAdmin = user.role === 'STAFF' || user.role === 'ADMIN';
  const isAdmin = user.role === 'ADMIN';

  return (
    <>
      {user.must_change_password && (
        <FirstLoginModal
          user={user}
          onPasswordChanged={(updatedUser) => setUser(updatedUser)}
        />
      )}
      <Shell user={user} setUser={setUser} theme={theme} setTheme={setTheme}>
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/dashboard" element={<Dashboard user={user} />} />

          {/* Public recruitment preview route */}
          <Route path="/join/:trackSlug" element={<PublicRecruitment />} />
          <Route path="/join" element={<PublicRecruitment />} />

          {/* Recruitment Applications Review (Staff & Admin) */}
          <Route
            path="/recruitment"
            element={isStaffOrAdmin ? <RecruitmentReview currentUser={user} /> : <Navigate to="/dashboard" replace />}
          />

          {/* Tasks */}
          <Route path="/tasks" element={<Tasks user={user} />} />
          <Route
            path="/tasks/new"
            element={isStaffOrAdmin ? <TaskForm user={user} /> : <Navigate to="/tasks" replace />}
          />
          <Route path="/tasks/:id" element={<TaskDetail user={user} />} />
          <Route
            path="/tasks/:id/edit"
            element={isStaffOrAdmin ? <TaskForm user={user} /> : <Navigate to="/tasks" replace />}
          />

          {/* Volunteers & Community */}
          <Route path="/students" element={<Students user={user} />} />
          <Route path="/record-book" element={<RecordBook user={user} />} />
          <Route path="/leaderboard" element={<Leaderboard user={user} />} />
          <Route path="/notifications" element={<Notifications user={user} />} />

          {/* Admin only */}
          <Route
            path="/admin/users"
            element={isAdmin ? <AdminUsers currentUser={user} /> : <Navigate to="/dashboard" replace />}
          />
          <Route
            path="/admin/audit"
            element={isAdmin ? <AdminAudit currentUser={user} /> : <Navigate to="/dashboard" replace />}
          />

          {/* Settings */}
          <Route
            path="/settings"
            element={<SettingsPage theme={theme} setTheme={setTheme} user={user} setUser={setUser} />}
          />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Shell>
    </>
  );
}

const rootElement = document.getElementById('root');
createRoot(rootElement).render(
  <BrowserRouter>
    <ToastProvider>
      <App />
    </ToastProvider>
  </BrowserRouter>
);
