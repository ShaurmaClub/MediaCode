import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ExternalLink, CalendarDays, Award, Sparkles } from 'lucide-react';
import { api, relativeTime } from '../api.js';
import { Page, Loader, Empty } from '../components/UI.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const toast = useToast();

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const res = await api('/notifications');
      setNotifications(res.notifications || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  const handleMarkAllRead = async () => {
    try {
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
      await api('/notifications/read-all', { method: 'POST' });
      window.dispatchEvent(new CustomEvent('notifications-updated'));
      toast.success('Все уведомления отмечены как прочитанные');
    } catch (err) {
      toast.error(err.message);
      loadNotifications();
    }
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.read_at) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read_at: new Date().toISOString() } : n))
      );
      try {
        await api(`/notifications/${notif.id}/read`, { method: 'PATCH' });
        window.dispatchEvent(new CustomEvent('notifications-updated'));
      } catch {}
    }
    if (notif.link) {
      navigate(notif.link);
    }
  };

  const getNotifMeta = (n) => {
    const t = (n.title || '').toLowerCase();
    const b = (n.body || '').toLowerCase();
    if (t.includes('отклик') || b.includes('откликнулся')) {
      return { tag: 'Отклик', color: '#60a5fa', icon: CalendarDays };
    }
    if (t.includes('балл') || b.includes('балл')) {
      return { tag: 'Баллы', color: '#34d399', icon: Award };
    }
    if (t.includes('отбор') || t.includes('кандидат') || b.includes('отбор')) {
      return { tag: 'Отбор', color: '#a78bfa', icon: Sparkles };
    }
    if (t.includes('выбран') || t.includes('одобрен') || b.includes('выбран')) {
      return { tag: 'Назначение', color: '#818cf8', icon: CheckCheck };
    }
    if (t.includes('мероприят') || b.includes('мероприят')) {
      return { tag: 'Мероприятие', color: '#f472b6', icon: CalendarDays };
    }
    return { tag: 'Инфо', color: '#9ca3af', icon: Bell };
  };

  if (loading) return <Loader text="Загружаем уведомления…" />;

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <Page
      title="Уведомления"
      subtitle="Важные обновления по вашим откликам, начислениям баллов и новым событиям."
      actions={
        unreadCount > 0 && (
          <button className="btn ghost" onClick={handleMarkAllRead}>
            <CheckCheck size={16} /> Отметить все прочитанными
          </button>
        )
      }
    >
      <div className="panel notifications-panel">
        <div className="section-head">
          <h2>Список уведомлений</h2>
          <span className="muted">
            {unreadCount > 0 ? `${unreadCount} новых` : 'Все прочитаны'}
          </span>
        </div>

        {notifications.length > 0 ? (
          <div className="notifications-full-list">
            {notifications.map((n) => {
              const meta = getNotifMeta(n);
              const IconComp = meta.icon;
              return (
                <div
                  key={n.id}
                  className={`notif-card ${!n.read_at ? 'unread' : ''}`}
                  onClick={() => handleNotificationClick(n)}
                  role="button"
                  tabIndex={0}
                  style={{ borderLeft: `3px solid ${meta.color}` }}
                >
                  <div className="notif-icon-circle" style={{ color: meta.color, background: `${meta.color}15` }}>
                    <IconComp size={18} />
                  </div>
                  <div className="notif-content-area">
                    <div className="notif-title-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="notif-type-badge" style={{ color: meta.color, background: `${meta.color}20`, fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px' }}>
                          {meta.tag}
                        </span>
                        <b>{n.title}</b>
                      </div>
                      {!n.read_at && <span className="unread-dot" title="Не прочитано" />}
                    </div>
                    <p className="notif-body-text">{n.body}</p>
                    <div className="notif-footer-row">
                      <time className="muted">{relativeTime(n.created_at)}</time>
                      {n.link && (
                        <span className="notif-link-hint">
                          Перейти к деталям <ExternalLink size={12} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            title="Уведомлений нет"
            text="Когда появятся новые события или обновления по вашим задачам, они отобразятся здесь."
          />
        )}
      </div>
    </Page>
  );
}
