import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ExternalLink, CalendarDays, Award } from 'lucide-react';
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
      await api('/notifications/read-all', { method: 'POST' });
      toast.success('Все уведомления отмечены как прочитанные');
      loadNotifications();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.read_at) {
      try {
        await api(`/notifications/${notif.id}/read`, { method: 'PATCH' });
      } catch {}
    }
    if (notif.link) {
      navigate(notif.link);
    } else {
      loadNotifications();
    }
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
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`notif-card ${!n.read_at ? 'unread' : ''}`}
                onClick={() => handleNotificationClick(n)}
                role="button"
                tabIndex={0}
              >
                <div className="notif-icon-circle">
                  <Bell size={18} />
                </div>
                <div className="notif-content-area">
                  <div className="notif-title-row">
                    <b>{n.title}</b>
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
            ))}
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
