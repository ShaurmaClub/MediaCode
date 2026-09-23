import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { ToastProvider } from './context/ToastContext.jsx';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';
import FirstLogin from './pages/FirstLogin.jsx';
import PrivacyConsent from './pages/PrivacyConsent.jsx';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';
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

  const location = useLocation();

  if (loading) {
    return (
      <div className="splash">
        <img src="/mediacode-logo.png" alt="МедиаКод" className="brand-img-lg" />
        <div className="splash-indicator" />
        <span className="splash-sub">Студенческий медиацентр</span>
      </div>
    );
  }

  // Guest users routing (no auth)
  if (!user) {
    return (
      <Routes>
        <Route path="/join/:trackSlug" element={<PublicRecruitment />} />
        <Route path="/join" element={<PublicRecruitment />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route
          path="*"
          element={isRecruitmentSubdomain() ? <PublicRecruitment /> : <Login onLogin={setUser} />}
        />
      </Routes>
    );
  }

  // Mandatory first login account setup (full screen)
  if (user.must_change_password) {
    return (
      <FirstLogin
        user={user}
        onPasswordChanged={(updatedUser) => setUser(updatedUser)}
      />
    );
  }

  if (!user.privacy_consent_at) {
    return (
      <PrivacyConsent
        user={user}
        onConsented={(updatedUser) => setUser(updatedUser)}
      />
    );
  }

  const isStaffOrAdmin = user.role === 'STAFF' || user.role === 'ADMIN';
  const isAdmin = user.role === 'ADMIN';

  return (
    <Shell user={user} setUser={setUser} theme={theme} setTheme={setTheme}>
      <Routes>
        <Route path="/" element={<Dashboard user={user} />} />
        <Route path="/dashboard" element={<Dashboard user={user} />} />

        {/* Public recruitment preview route */}
        <Route path="/join/:trackSlug" element={<PublicRecruitment />} />
        <Route path="/join" element={<PublicRecruitment />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />

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
