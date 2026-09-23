import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  BookOpen,
  Trophy,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  Palette,
  Shield,
  Clock,
  Search,
  CheckCircle2,
  Inbox
} from 'lucide-react';
import { Avatar } from './UI.jsx';
import { api, THEMES } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';

export default function Shell({ user, setUser, theme, setTheme, children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingRecruitmentCount, setPendingRecruitmentCount] = useState(0);
  const [themeDropdown, setThemeDropdown] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const isStaffOrAdmin = user.role === 'STAFF' || user.role === 'ADMIN';

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Fetch unread notifications and pending recruitment count
  useEffect(() => {
    const fetchData = () => {
      api('/notifications')
        .then((res) => setUnreadCount(res.unreadCount || 0))
        .catch(() => {});

      if (isStaffOrAdmin) {
        api('/recruitment/applications?status=SUBMITTED')
          .then((res) => setPendingRecruitmentCount(res.pendingCount || 0))
          .catch(() => {});
      }
    };
    fetchData();
    window.addEventListener('notifications-updated', fetchData);
    const interval = setInterval(fetchData, 30000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('notifications-updated', fetchData);
    };
  }, [isStaffOrAdmin]);

  const handleLogout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
      toast.info('Вы вышли из системы');
      setUser(null);
      navigate('/');
    } catch (err) {
      toast.error('Не удалось выйти: ' + err.message);
    }
  };

  const handleSearch = (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      navigate(`/tasks?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const changeTheme = async (newTheme) => {
    setTheme(newTheme);
    setThemeDropdown(false);
    try {
      await api('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ theme: newTheme })
      });
    } catch {
      // Local fallback already saved in root App
    }
  };

  const roleLabels = {
    ADMIN: 'Администратор',
    STAFF: 'Сотрудник',
    STUDENT: 'Медиаволонтёр'
  };
  const userRoleLabel = roleLabels[user.role] || user.role;

  const navLinks = [
    { to: '/dashboard', label: 'Главная', icon: LayoutDashboard },
    { to: '/tasks', label: 'Мероприятия', icon: CalendarDays },
    { to: '/students', label: 'Медиаволонтёры', icon: Users },
    ...(isStaffOrAdmin
      ? [{ to: '/recruitment', label: 'Заявки на отбор', icon: Inbox, badge: pendingRecruitmentCount }]
      : []),
    { to: '/record-book', label: user.role === 'STUDENT' ? 'Моя зачётка' : 'Зачётка и баллы', icon: BookOpen },
    { to: '/leaderboard', label: 'Рейтинг медиаволонтёров', icon: Trophy },
    { to: '/notifications', label: 'Уведомления', icon: Bell, badge: unreadCount },
    ...(user.role === 'ADMIN'
      ? [
          { to: '/admin/users', label: 'Пользователи', icon: Shield },
          { to: '/admin/audit', label: 'Аудит', icon: Clock }
        ]
      : [])
  ];

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      {/* Mobile backdrop */}
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          {!collapsed && (
            <Link to="/dashboard" className="sidebar-brand-link" title="КАИТ20 · МедиаКод">
              <div className="sidebar-brand-dual">
                <img src="/brand/kait20-white.png" alt="КАИТ20" className="sidebar-brand-kait" />
                <div className="sidebar-brand-divider" />
                <img src="/brand/mediacode.png" alt="МедиаКод" className="sidebar-brand-mediacode" />
              </div>
            </Link>
          )}
          <button
            className="collapse-btn desktop-only"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {collapsed ? <Menu size={16} /> : <X size={16} />}
          </button>
          <button
            className="collapse-btn mobile-only"
            onClick={() => setMobileOpen(false)}
            aria-label="Закрыть меню"
          >
            <X size={16} />
          </button>
        </div>

        <div className="profile-mini" onClick={() => navigate('/settings')}>
          <Avatar firstName={user.first_name} lastName={user.last_name} size="normal" />
          <div className="profile-mini-info">
            <b className="truncate">
              {user.first_name} {user.last_name}
            </b>
            <small className="role-tag">{userRoleLabel}</small>
          </div>
        </div>

        <nav className="nav-menu">
          {navLinks.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to || (item.to !== '/dashboard' && location.pathname.startsWith(item.to));
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`nav-item ${isActive ? 'active' : ''}`}
                title={item.label}
              >
                <Icon size={18} className="nav-icon" />
                <span className="nav-label">{item.label}</span>
                {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <button
            className={`nav-item ${location.pathname === '/settings' ? 'active' : ''}`}
            onClick={() => navigate('/settings')}
            title="Настройки"
          >
            <Settings size={18} className="nav-icon" />
            <span className="nav-label">Настройки</span>
          </button>
          <button className="nav-item logout-btn" onClick={handleLogout} title="Выйти">
            <LogOut size={18} className="nav-icon" />
            <span className="nav-label">Выйти</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-wrapper">
        <header className="header">
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Открыть навигацию"
          >
            <Menu size={22} />
          </button>

          <div className="header-search">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Поиск по мероприятиям и навыкам… (нажмите Enter)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearch}
            />
          </div>

          <div className="header-actions">
            {/* Quick theme selector pill */}
            <div className="theme-dropdown-container">
              <button
                className="theme-pill"
                onClick={() => setThemeDropdown(!themeDropdown)}
                title="Сменить тему оформления"
              >
                <Palette size={15} />
                <span className="theme-current-name">
                  {THEMES.find((t) => t.id === theme)?.name || 'Тема'}
                </span>
              </button>

              {themeDropdown && (
                <div className="theme-popover">
                  <div className="theme-popover-title">Темы оформления</div>
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      className={`theme-option ${theme === t.id ? 'selected' : ''}`}
                      onClick={() => changeTheme(t.id)}
                    >
                      <span className={`theme-swatch theme-${t.id}`} />
                      <span>{t.name}</span>
                      {theme === t.id && <CheckCircle2 size={14} className="check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Notification bell */}
            <button
              className="icon-btn notif-btn"
              onClick={() => navigate('/notifications')}
              title="Уведомления"
              aria-label="Уведомления"
            >
              <Bell size={20} />
              {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>

            {/* Profile Avatar */}
            <div
              className="header-avatar-btn"
              onClick={() => navigate('/settings')}
              title="Мой профиль и настройки"
            >
              <Avatar firstName={user.first_name} lastName={user.last_name} size="small" />
            </div>
          </div>
        </header>

        <main className="content" onClick={() => themeDropdown && setThemeDropdown(false)}>
          {children}
        </main>
      </div>
    </div>
  );
}
