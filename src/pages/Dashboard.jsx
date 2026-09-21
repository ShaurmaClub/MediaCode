import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  Users,
  BookOpen,
  Clock,
  ArrowUpRight,
  Plus,
  Sparkles,
  Award,
  Bell,
  CheckCircle2,
  AlertCircle,
  Inbox,
  UserCheck,
  Phone,
  MessageSquare,
  ExternalLink,
  FileText,
  ArrowRight
} from 'lucide-react';
import { api, formatDate, relativeTime } from '../api.js';
import { Page, Loader, Empty, TaskCard, PointRow, StatusBadge, Avatar } from '../components/UI.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Dashboard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [awardModalOpen, setAwardModalOpen] = useState(false);
  const [studentsList, setStudentsList] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [awardPointsAmount, setAwardPointsAmount] = useState(20);
  const [awardReasonText, setAwardReasonText] = useState('');
  const [awardCategoryVal, setAwardCategoryVal] = useState('BONUS');
  const [awardingLoading, setAwardingLoading] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const load = async () => {
    try {
      setLoading(true);
      const res = await api('/dashboard');
      setData(res);
    } catch (err) {
      toast.error('Не удалось загрузить данные дашборда: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleQuickApplicationAction = async (appId, status) => {
    try {
      await api(`/applications/${appId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      toast.success(`Статус заявки обновлён: ${status}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleOpenAwardModal = async () => {
    try {
      const res = await api('/users?role=STUDENT&status=ACTIVE');
      setStudentsList(res || []);
      if (res?.length > 0) setSelectedStudentId(String(res[0].id));
      setAwardModalOpen(true);
    } catch (err) {
      toast.error('Не удалось загрузить волонтёров: ' + err.message);
    }
  };

  const handleSubmitAward = async (e) => {
    e.preventDefault();
    if (!selectedStudentId) {
      toast.error('Выберите волонтёра');
      return;
    }
    if (!awardReasonText.trim()) {
      toast.error('Укажите причину начисления баллов');
      return;
    }

    setAwardingLoading(true);
    try {
      await api('/points/award', {
        method: 'POST',
        body: JSON.stringify({
          user_id: parseInt(selectedStudentId, 10),
          amount: parseInt(awardPointsAmount, 10),
          reason: awardReasonText.trim(),
          category: awardCategoryVal
        })
      });
      toast.success(`Успешно начислено ${awardPointsAmount} баллов волонтёру!`);
      setAwardModalOpen(false);
      setAwardReasonText('');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAwardingLoading(false);
    }
  };

  if (loading || !data) return <Loader text="Загружаем панель управления…" />;

  // ==========================================
  // STUDENT VIEW
  // ==========================================
  if (user.role === 'STUDENT') {
    const nextTask = data.myAssignments?.[0] || data.tasks?.[0];

    return (
      <Page
        title={`Привет, ${user.first_name}!`}
        subtitle="Твой персональный медиацентр: актуальные задания, статус заявок и баланс баллов."
        actions={
          <Link to="/tasks" className="btn primary">
            <CalendarDays size={16} /> Смотреть задания
          </Link>
        }
      >
        {/* Top Hero Balance & Next event */}
        <div className="hero-grid">
          <div className="score-card">
            <div className="score-card-content">
              <span className="score-subtitle">Твой баланс в системе</span>
              <strong className="score-number">{data.user.totalPoints}</strong>
              <div className="score-badge-row">
                <span className="score-label">баллов активности</span>
                <span className="score-dot">·</span>
                <span className="score-completed">
                  Выполнено заданий: {data.user.completedTasksCount || 0}
                </span>
              </div>
            </div>
            <div className="score-icon-ring">
              <Award size={28} />
            </div>
          </div>

          <div className="next-event-card">
            <div className="next-event-tag">
              <Clock size={14} /> Ближайшее мероприятие
            </div>
            {nextTask ? (
              <div className="next-event-body">
                <h3>{nextTask.title}</h3>
                <div className="next-event-meta">
                  <span>
                    <CalendarDays size={14} /> {formatDate(nextTask.event_date)}
                    {nextTask.start_time ? ` · ${nextTask.start_time}` : ''}
                  </span>
                  {nextTask.location && <span>· {nextTask.location}</span>}
                </div>
                <div className="next-event-footer">
                  <span className="task-points-pill">+{nextTask.points} баллов</span>
                  <Link to={`/tasks/${nextTask.id}`} className="text-link">
                    Перейти к заданию <ArrowUpRight size={15} />
                  </Link>
                </div>
              </div>
            ) : (
              <Empty title="Нет активных заданий" text="Подайте заявку на открытые задания ниже." />
            )}
          </div>
        </div>

        {/* My Active Assignments if any */}
        {data.myAssignments && data.myAssignments.length > 0 && (
          <div className="section-block">
            <div className="section-head">
              <h2>Мои текущие назначения</h2>
              <span className="section-count">{data.myAssignments.length} в работе</span>
            </div>
            <div className="task-grid">
              {data.myAssignments.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        )}

        {/* Available Tasks */}
        <div className="section-block">
          <div className="section-head">
            <h2>Возможности для участия</h2>
            <Link to="/tasks" className="text-link">
              Все задания ({data.tasks?.length || 0}) →
            </Link>
          </div>
          {data.tasks && data.tasks.length > 0 ? (
            <div className="task-grid">
              {data.tasks.slice(0, 3).map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          ) : (
            <Empty title="Пока нет открытых заданий" text="Загляните позже, кураторы скоро опубликуют новые задания." />
          )}
        </div>

        {/* Bottom Two-Column: Ledger history and Notifications */}
        <div className="two-col">
          <div className="panel">
            <div className="section-head">
              <h2>История начислений</h2>
              <Link to="/record-book" className="text-link">
                Вся зачётная книжка →
              </Link>
            </div>
            <div className="points-list">
              {data.points && data.points.length > 0 ? (
                data.points.map((p) => <PointRow key={p.id} point={p} />)
              ) : (
                <Empty title="Начислений пока нет" text="Выполняйте задания, чтобы получить свои первые баллы." />
              )}
            </div>
          </div>

          <div className="panel">
            <div className="section-head">
              <h2>Уведомления</h2>
              <Link to="/notifications" className="text-link">
                Все ({data.notifications?.length || 0}) →
              </Link>
            </div>
            <div className="notices-list-compact">
              {data.notifications && data.notifications.length > 0 ? (
                data.notifications.map((n) => (
                  <div className={`notice-item ${!n.read_at ? 'unread' : ''}`} key={n.id}>
                    <div className="notice-icon">
                      <Bell size={15} />
                    </div>
                    <div className="notice-text">
                      <b>{n.title}</b>
                      <p>{n.body}</p>
                      <small className="muted">{relativeTime(n.created_at)}</small>
                    </div>
                  </div>
                ))
              ) : (
                <Empty title="Уведомлений нет" text="Здесь будут появляться ответы на ваши заявки и начисления." />
              )}
            </div>
          </div>
        </div>
      </Page>
    );
  }

  // ==========================================
  // STAFF & ADMIN VIEW
  // ==========================================
  const isCuratorAdmin = user.role === 'ADMIN';

  return (
    <Page
      title={isCuratorAdmin ? 'Панель администратора' : 'Панель сотрудника'}
      subtitle="Управление мероприятиями медиацентра, рассмотрение заявок кандидатов и волонтёров."
      actions={
        <div className="staff-actions-row">
          <Link to="/tasks/new" className="btn primary">
            <Plus size={16} /> Создать мероприятие
          </Link>
          <Link to="/recruitment" className="btn ghost">
            <Inbox size={16} /> Рассмотреть заявки
            {data.stats.pendingRecruitment > 0 && (
              <span className="badge-count-pill">{data.stats.pendingRecruitment}</span>
            )}
          </Link>
          <button type="button" className="btn ghost" onClick={handleOpenAwardModal}>
            <Award size={16} /> Начислить баллы
          </button>
        </div>
      }
    >
      {/* 4 Key Metrics Cards: "Требуют внимания" */}
      <div className="attention-section">
        <div className="stats-grid">
          <Link to="/recruitment" className="stat-card highlight attention-card">
            <div className="stat-icon-wrap"><Inbox size={20} /></div>
            <div>
              <span className="stat-label">Заявки на отбор</span>
              <strong className="stat-value">{data.stats.pendingRecruitment || 0}</strong>
              <small className="attention-hint">Ожидают проверки тестовых</small>
            </div>
          </Link>

          <div className="stat-card attention-card">
            <div className="stat-icon-wrap"><CheckCircle2 size={20} /></div>
            <div>
              <span className="stat-label">Сданные отчёты</span>
              <strong className="stat-value">{data.stats.pendingSubmissions || 0}</strong>
              <small className="attention-hint">Ждут подтверждения баллов</small>
            </div>
          </div>

          <div className="stat-card attention-card">
            <div className="stat-icon-wrap"><Clock size={20} /></div>
            <div>
              <span className="stat-label">Отклики волонтёров</span>
              <strong className="stat-value">{data.stats.pendingApplications || 0}</strong>
              <small className="attention-hint">Ждут отбора на мероприятие</small>
            </div>
          </div>

          <Link to="/tasks" className="stat-card attention-card">
            <div className="stat-icon-wrap"><CalendarDays size={20} /></div>
            <div>
              <span className="stat-label">Открытые мероприятия</span>
              <strong className="stat-value">{data.stats.openTasks || 0}</strong>
              <small className="attention-hint">Идёт набор в команду</small>
            </div>
          </Link>
        </div>
      </div>

      {/* Fresh Recruitment Applications Queue */}
      {data.pendingRecruitmentList && data.pendingRecruitmentList.length > 0 && (
        <div className="panel review-panel">
          <div className="section-head">
            <div>
              <h2>Новые кандидаты на вступление</h2>
              <p className="muted">Тестовые задания, требующие проверки кураторами направлений.</p>
            </div>
            <Link to="/recruitment" className="text-link">
              Все заявки ({data.stats.pendingRecruitment}) →
            </Link>
          </div>

          <div className="candidate-list">
            {data.pendingRecruitmentList.map((app) => {
              const isMaxMatched = app.max_contact && (
                app.max_contact === app.phone ||
                app.max_contact.replace(/\D/g, '').endsWith((app.phone || '').replace(/\D/g, '').slice(-10))
              );
              const maxDisplay = isMaxMatched
                ? 'используется этот номер'
                : 'номер не подтверждён как используемый в MAX';

              return (
                <div className="candidate-card-row" key={app.id}>
                  <div className="candidate-main-col">
                    <div className="candidate-header-line">
                      <span className="candidate-track-badge">{app.track_name}</span>
                      <h3 className="candidate-name">{app.full_name}</h3>
                      <span className="candidate-id-badge">#{app.public_id}</span>
                    </div>

                    <div className="candidate-detail-line">
                      <span>{app.department || 'Отделение не указано'}</span>
                      <span className="candidate-contact-divider">•</span>
                      <span>Группа: <strong>{app.group_name}</strong></span>
                    </div>

                    <div className="candidate-contacts-line">
                      <span className="candidate-contact-item">
                        <Phone size={13} /> Телефон: <strong>{app.phone}</strong>
                      </span>
                      <span className="candidate-contact-divider">•</span>
                      <span className="candidate-contact-item">
                        <MessageSquare size={13} /> MAX: <em>{maxDisplay}</em>
                      </span>
                      {app.created_at && (
                        <>
                          <span className="candidate-contact-divider">•</span>
                          <span className="candidate-date-item muted">
                            Подано: {relativeTime(app.created_at)}
                          </span>
                        </>
                      )}
                    </div>

                    {(app.submission_url || app.submission_text || app.comment) && (
                      <div className="candidate-materials-summary">
                        {app.submission_url && (
                          <span className="material-pill">
                            <ExternalLink size={12} /> Облачные материалы
                          </span>
                        )}
                        {app.submission_text && (
                          <span className="material-pill">
                            <FileText size={12} /> Текст задания
                          </span>
                        )}
                        {app.comment && (
                          <span className="candidate-comment-snippet" title={app.comment}>
                            «{app.comment}»
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="candidate-action-col">
                    <Link to="/recruitment" className="btn sm primary candidate-review-btn">
                      Рассмотреть <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Volunteer Applications Queue for Events */}
      {data.pendingList && data.pendingList.length > 0 && (
        <div className="panel review-panel">
          <div className="section-head">
            <div>
              <h2>Отклики волонтёров на мероприятия</h2>
              <p className="muted">Студенты, подавшие заявку на участие в мероприятиях.</p>
            </div>
            <span className="badge status-applied">{data.pendingList.length} новых</span>
          </div>

          <div className="pending-queue">
            {data.pendingList.map((app) => (
              <div className="pending-row" key={app.id}>
                <div className="pending-user">
                  <Avatar firstName={app.first_name} lastName={app.last_name} size="normal" />
                  <div>
                    <b>{app.first_name} {app.last_name}</b>
                    <small className="muted">{app.group_name} · {app.skills || 'Навыки не указаны'}</small>
                  </div>
                </div>

                <div className="pending-task-info">
                  <span className="muted">Мероприятие:</span>
                  <Link to={`/tasks/${app.task_id}`} className="pending-task-link">
                    {app.task_title}
                  </Link>
                  {app.comment && <div className="pending-comment">«{app.comment}»</div>}
                </div>

                <div className="pending-actions">
                  <button
                    className="btn tiny primary"
                    onClick={() => handleQuickApplicationAction(app.id, 'SELECTED')}
                  >
                    Отобрать
                  </button>
                  <button
                    className="btn tiny ghost"
                    onClick={() => handleQuickApplicationAction(app.id, 'REJECTED')}
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Events Grid */}
      <div className="section-block">
        <div className="section-head">
          <h2>Ближайшие мероприятия</h2>
          <Link to="/tasks" className="text-link">Все мероприятия →</Link>
        </div>
        <div className="task-grid">
          {data.tasks && data.tasks.length > 0 ? (
            data.tasks.map((task) => <TaskCard key={task.id} task={task} isStaff />)
          ) : (
            <Empty title="Нет мероприятий" text="Создайте первое мероприятие для команды волонтёров." />
          )}
        </div>
      </div>

      {/* Recent Activity Audit Stream */}
      {data.recentActivity && data.recentActivity.length > 0 && (
        <div className="panel">
          <div className="section-head">
            <h2>Последняя активность в медиацентре</h2>
            {user.role === 'ADMIN' && <Link to="/admin/audit" className="text-link">Полный журнал аудита →</Link>}
          </div>
          <div className="activity-stream">
            {data.recentActivity.map((act) => (
              <div className="activity-row" key={act.id}>
                <div className="activity-dot" />
                <div className="activity-info">
                  <b>{act.actor_name || 'Система'}</b>
                  <span className="activity-action">{act.human_description || act.action}</span>
                </div>
                <time className="muted activity-time">{relativeTime(act.created_at)}</time>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AWARD POINTS QUICK MODAL */}
      {awardModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setAwardModalOpen(false)}
          title="Начисление баллов волонтёру"
          maxWidth="500px"
        >
          <form onSubmit={handleSubmitAward} className="modal-form">
            <div className="form-group">
              <label>Выберите волонтёра *</label>
              <select
                required
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
              >
                {studentsList.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.first_name} {st.last_name} ({st.group_name || 'Студент'}) — текущий баланс: {st.totalPoints || 0} б.
                  </option>
                ))}
              </select>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Количество баллов *</label>
                <input
                  type="number"
                  required
                  min="1"
                  max="500"
                  value={awardPointsAmount}
                  onChange={(e) => setAwardPointsAmount(parseInt(e.target.value, 10) || 0)}
                />
              </div>

              <div className="form-group">
                <label>Категория</label>
                <select
                  value={awardCategoryVal}
                  onChange={(e) => setAwardCategoryVal(e.target.value)}
                >
                  <option value="BONUS">Бонус / Инициатива</option>
                  <option value="SPECIAL">Особая заслуга</option>
                  <option value="CORRECTION">Корректировка</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Причина начисления в зачётку *</label>
              <textarea
                rows="2"
                required
                placeholder="например, За оперативную съёмку репортажа к Дню студента"
                value={awardReasonText}
                onChange={(e) => setAwardReasonText(e.target.value)}
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setAwardModalOpen(false)}
                disabled={awardingLoading}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={awardingLoading}
              >
                {awardingLoading ? 'Начисление…' : 'Внести в зачётку'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
