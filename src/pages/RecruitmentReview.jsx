import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Inbox,
  Filter,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  Download,
  ExternalLink,
  UserCheck,
  UserPlus,
  Phone,
  MessageSquare,
  FileText,
  AlertCircle,
  Eye,
  Camera,
  Video,
  Palette,
  Share2,
  Film,
  Mic
} from 'lucide-react';
import { api, formatDateTime, formatDate, relativeTime } from '../api.js';
import { Page, Loader, Empty, Avatar } from '../components/UI.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../context/ToastContext.jsx';

const TRACK_ICONS = {
  PHOTO: Camera,
  VIDEO: Video,
  MONTAGE: Film,
  DESIGN: Palette,
  SMM: Share2,
  CONTENT: Mic
};

const STATUS_LABELS = {
  SUBMITTED: { label: 'Новая заявка', cls: 'status-open' },
  IN_REVIEW: { label: 'На рассмотрении', cls: 'status-progress' },
  APPROVED: { label: 'Одобрена (в команде)', cls: 'status-completed' },
  REJECTED: { label: 'Отклонена', cls: 'status-cancelled' },
  WITHDRAWN: { label: 'Отозвана', cls: 'status-withdrawn' }
};

export default function RecruitmentReview({ currentUser }) {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [trackFilter, setTrackFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [pendingCount, setPendingCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const toast = useToast();

  // Detail Modal
  const [selectedApp, setSelectedApp] = useState(null);
  const [appDetails, setAppDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Approval confirmation modal
  const [approvingApp, setApprovingApp] = useState(null);
  const [customPassword, setCustomPassword] = useState('Demo123!');
  const [busyAction, setBusyAction] = useState(false);
  const [createdUserNotice, setCreatedUserNotice] = useState(null);

  const loadApplications = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (trackFilter !== 'ALL') query.set('track', trackFilter);
      if (statusFilter !== 'ALL') query.set('status', statusFilter);
      if (search.trim()) query.set('search', search.trim());

      const res = await api(`/recruitment/applications?${query.toString()}`);
      setApplications(res.applications || []);
      setPendingCount(res.pendingCount || 0);
      setTotalCount(res.totalCount || 0);
    } catch (err) {
      toast.error('Не удалось загрузить заявки: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplications();
  }, [trackFilter, statusFilter]);

  const handleOpenDetail = async (app) => {
    setSelectedApp(app);
    setDetailsLoading(true);
    try {
      const res = await api(`/recruitment/applications/${app.id}`);
      setAppDetails(res);
    } catch (err) {
      toast.error('Ошибка загрузки деталей заявки: ' + err.message);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleUpdateStatus = async (appId, newStatus) => {
    try {
      setBusyAction(true);
      await api(`/recruitment/applications/${appId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      toast.success(`Статус заявки обновлён: ${STATUS_LABELS[newStatus]?.label || newStatus}`);
      if (selectedApp && selectedApp.id === appId) {
        handleOpenDetail({ id: appId });
      }
      loadApplications();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyAction(false);
    }
  };

  const handleApproveAndCreate = async (e) => {
    e.preventDefault();
    if (!approvingApp) return;

    try {
      setBusyAction(true);
      const res = await api(`/recruitment/applications/${approvingApp.id}/approve-and-create-user`, {
        method: 'POST',
        body: JSON.stringify(customPassword && customPassword.trim() ? { password: customPassword.trim() } : {})
      });

      toast.success('Кандидат успешно принят в команду медиацентра!');
      setCreatedUserNotice({
        ...res,
        temporaryPassword: res.temporaryPassword || res.initialPassword
      });
      setApprovingApp(null);
      if (selectedApp && selectedApp.id === approvingApp.id) {
        handleOpenDetail({ id: approvingApp.id });
      }
      loadApplications();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <Page
      title="Заявки на отбор"
      subtitle="Проверка тестовых заданий будущих медиаволонтёров медиацентра, связь с кандидатами и зачисление в команду."
      eyebrow="РЕКРУТИНГ"
      actions={
        <div className="recruitment-head-stats">
          <div className="stat-pill-badge">
            <Clock size={14} />
            <span>Требуют ответа: <strong>{pendingCount}</strong></span>
          </div>
          <div className="stat-pill-badge muted-pill">
            <span>Всего заявок: <strong>{totalCount}</strong></span>
          </div>
        </div>
      }
    >
      {/* Filters Toolbar */}
      <div className="toolbar">
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault();
            loadApplications();
          }}
        >
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Поиск по ФИО, номеру заявки (MC-V-0001), группе или телефону…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn tiny primary">
            Найти
          </button>
        </form>

        <div className="toolbar-filters">
          {/* Track Filter */}
          <div className="category-select-wrap">
            <Filter size={14} />
            <select
              value={trackFilter}
              onChange={(e) => setTrackFilter(e.target.value)}
            >
              <option value="ALL">Все направления</option>
              <option value="PHOTO">Фотография</option>
              <option value="VIDEO">Видеограф</option>
              <option value="MONTAGE">Монтажёр</option>
              <option value="DESIGN">Графический дизайнер</option>
              <option value="SMM">СММ</option>
              <option value="CONTENT">Ведущий / корреспондент</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="category-select-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">Все статусы</option>
              <option value="SUBMITTED">Новые заявки</option>
              <option value="IN_REVIEW">На рассмотрении</option>
              <option value="APPROVED">Зачислены в команду</option>
              <option value="REJECTED">Отклонены</option>
            </select>
          </div>
        </div>
      </div>

      {/* Success Notification banner if student just created */}
      {createdUserNotice && (
        <div className="success-banner-card">
          <CheckCircle size={24} className="text-success" />
          <div className="banner-text">
            <h4>Аккаунт медиаволонтёра создан: {createdUserNotice.user?.name}</h4>
            <p>
              Логин для входа: <code>{createdUserNotice.user?.login}</code> · Стартовый пароль:{' '}
              <code>{createdUserNotice.temporaryPassword}</code> · Начислено +{createdUserNotice.user?.bonusPoints} приветственных баллов.
            </p>
          </div>
          <button
            type="button"
            className="btn tiny ghost"
            onClick={() => setCreatedUserNotice(null)}
          >
            Закрыть
          </button>
        </div>
      )}

      {/* Applications Table */}
      <div className="panel table-wrap">
        <div className="section-head">
          <h2>Список поданных заявок</h2>
          <span className="muted">Отображается: {applications.length}</span>
        </div>

        {loading ? (
          <Loader text="Загружаем заявки на отбор…" />
        ) : applications.length > 0 ? (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Заявка</th>
                  <th>Кандидат</th>
                  <th>Направление</th>
                  <th>Контакты</th>
                  <th>Материалы</th>
                  <th>Статус</th>
                  <th>Дата</th>
                  <th style={{ textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => {
                  const Icon = TRACK_ICONS[app.track_type] || Camera;
                  const statusInfo = STATUS_LABELS[app.status] || { label: app.status, cls: 'status-default' };

                  return (
                    <tr key={app.id}>
                      {/* Public ID */}
                      <td>
                        <strong className="public-id-badge">{app.public_id}</strong>
                      </td>

                      {/* Candidate */}
                      <td>
                        <div className="candidate-cell">
                          <b>{app.full_name}</b>
                          <small className="muted">
                            {app.department} · {app.group_name}
                          </small>
                        </div>
                      </td>

                      {/* Track */}
                      <td>
                        <div className="track-badge-cell">
                          <Icon size={14} />
                          <span>{app.track_name}</span>
                        </div>
                      </td>

                      {/* Contacts: Phone & MAX */}
                      <td>
                        <div className="contacts-cell">
                          <span className="contact-line">
                            <Phone size={12} /> {app.phone}
                          </span>
                          <span className="contact-line" style={{ fontSize: '11px' }}>
                            <MessageSquare size={12} /> {
                              (app.max_contact && (app.max_contact === app.phone || app.max_contact.replace(/\D/g, '').endsWith((app.phone || '').replace(/\D/g, '').slice(-10))))
                                ? 'используется этот номер'
                                : 'не подтверждён'
                            }
                          </span>
                        </div>
                      </td>

                      {/* Materials */}
                      <td>
                        <div className="materials-cell">
                          {app.files_count > 0 && (
                            <span className="pill-file-tag">
                              <Download size={12} /> {app.files_count > 1 ? `Файлы (${app.files_count})` : 'Файл'}
                            </span>
                          )}
                          {app.submission_text && (
                            <span className="pill-text-tag">
                              <FileText size={12} /> Текст
                            </span>
                          )}
                          {app.submission_url && (
                            <a
                              href={app.submission_url}
                              target="_blank"
                              rel="noreferrer"
                              className="pill-link-tag"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink size={12} /> Ссылка
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td>
                        <span className={`badge ${statusInfo.cls}`}>
                          <span className="badge-dot" />
                          {statusInfo.label}
                        </span>
                      </td>

                      {/* Date */}
                      <td>
                        <small className="muted">{relativeTime(app.created_at)}</small>
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="btn tiny ghost"
                            title="Открыть анкету и материалы"
                            onClick={() => handleOpenDetail(app)}
                          >
                            <Eye size={14} /> Открыть
                          </button>

                          {app.status !== 'APPROVED' && (
                            <button
                              type="button"
                              className="btn tiny primary"
                              title="Принять в команду и создать аккаунт"
                              onClick={() => setApprovingApp(app)}
                            >
                              <UserCheck size={14} /> Принять
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Заявки не найдены"
            text="Новые тестовые задания кандидатов появятся здесь сразу после отправки формы."
          />
        )}
      </div>

      {/* APPLICATION DETAIL MODAL */}
      {selectedApp && (
        <Modal
          isOpen={true}
          onClose={() => {
            setSelectedApp(null);
            setAppDetails(null);
          }}
          title={`Заявка ${selectedApp.public_id}: ${selectedApp.full_name}`}
          maxWidth="700px"
        >
          {detailsLoading || !appDetails ? (
            <Loader text="Загрузка материалов заявки…" />
          ) : (
            <div className="app-detail-modal">
              {/* Prominent Track Banner */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.15), rgba(79, 70, 229, 0.1))',
                  border: '1px solid rgba(124, 58, 237, 0.3)',
                  marginBottom: '16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '10px',
                      background: 'var(--accent)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {(() => {
                      const Icon = TRACK_ICONS[appDetails.application.track_type] || Camera;
                      return <Icon size={20} />;
                    })()}
                  </div>
                  <div>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', fontWeight: 700, display: 'block' }}>
                      Направление отбора
                    </span>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                      {appDetails.application.track_name}
                    </h3>
                  </div>
                </div>
                <span className={`badge ${STATUS_LABELS[appDetails.application.status]?.cls || 'status-default'}`} style={{ fontSize: '12px', padding: '6px 12px' }}>
                  {STATUS_LABELS[appDetails.application.status]?.label || appDetails.application.status}
                </span>
              </div>

              {/* Header Info */}
              <div className="app-detail-head">
                <div>
                  <h3>{appDetails.application.full_name}</h3>
                  <p className="muted">
                    Отделение: <strong>{appDetails.application.department}</strong> · Учебная группа: <strong>{appDetails.application.group_name}</strong>
                  </p>
                </div>
              </div>

              {/* Contacts Grid */}
              <div className="app-contacts-box">
                <div className="contact-box-item">
                  <span className="muted">Телефон:</span>
                  <a href={`tel:${appDetails.application.phone}`} className="contact-value">
                    <Phone size={14} /> {appDetails.application.phone}
                  </a>
                </div>
                <div className="contact-box-item">
                  <span className="muted">Макс на этом номере:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="contact-value">
                      <MessageSquare size={14} /> {
                        (appDetails.application.max_contact && (
                          appDetails.application.max_contact === appDetails.application.phone ||
                          appDetails.application.max_contact.replace(/\D/g, '').endsWith((appDetails.application.phone || '').replace(/\D/g, '').slice(-10))
                        ))
                          ? 'Используется номер телефона'
                          : 'Номер не подтверждён в Макс'
                      }
                    </span>
                  </div>
                </div>
                {appDetails.application.portfolio_url && (
                  <div className="contact-box-item">
                    <span className="muted">Портфолио:</span>
                    <a
                      href={appDetails.application.portfolio_url}
                      target="_blank"
                      rel="noreferrer"
                      className="contact-value text-link"
                    >
                      <ExternalLink size={14} /> Смотреть портфолио
                    </a>
                  </div>
                )}
              </div>

              {/* Candidate Comment */}
              {appDetails.application.comment && (
                <div className="app-section">
                  <h4>Комментарий кандидата:</h4>
                  <blockquote className="app-comment-quote">
                    «{appDetails.application.comment}»
                  </blockquote>
                </div>
              )}

              {/* Submission Files & Links */}
              <div className="app-section">
                <h4>Материалы тестового задания:</h4>

                {/* Assignment Text */}
                {appDetails.application.submission_text && (
                  <div className="submission-text-box" style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <FileText size={16} style={{ color: 'var(--accent)' }} />
                      <strong style={{ fontSize: '13px' }}>Текст тестового задания (СММ / копирайтинг / концепт):</strong>
                    </div>
                    <div
                      style={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontFamily: 'inherit',
                        lineHeight: 1.6,
                        background: 'var(--surface2)',
                        padding: '14px 16px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        fontSize: '13px'
                      }}
                    >
                      {appDetails.application.submission_text}
                    </div>
                  </div>
                )}

                {/* Cloud submission link */}
                {appDetails.application.submission_url && (
                  <div className="submission-link-banner">
                    <ExternalLink size={18} />
                    <div className="link-banner-text">
                      <strong>Внешняя ссылка на материалы</strong>
                      <small className="muted truncate">{appDetails.application.submission_url}</small>
                    </div>
                    <a
                      href={appDetails.application.submission_url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn tiny primary"
                    >
                      Открыть
                    </a>
                  </div>
                )}

                {/* Attached files */}
                {appDetails.files && appDetails.files.length > 0 ? (
                  <div className="files-list">
                    {appDetails.files.map((file) => (
                      <div className="file-item-row" key={file.id}>
                        <FileText size={20} className="file-icon" />
                        <div className="file-meta">
                          <b>{file.original_name}</b>
                          <small className="muted">
                            {(file.file_size / (1024 * 1024)).toFixed(2)} МБ · {formatDateTime(file.created_at)}
                          </small>
                        </div>
                        <a
                          href={`/api/recruitment/files/${file.id}/download`}
                          className="btn tiny ghost"
                          download
                        >
                          <Download size={14} /> Скачать файл
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  !appDetails.application.submission_url && (
                    <p className="muted">Файлы не прикреплены.</p>
                  )
                )}
              </div>

              {/* Consent & Audit info */}
              <div className="app-audit-meta">
                <small className="muted">
                  Подано: {formatDateTime(appDetails.application.created_at)} · Согласие ПДн v{appDetails.application.consent_version} подтверждено
                  {appDetails.application.reviewer_name && ` · Проверил: ${appDetails.application.reviewer_name}`}
                </small>
              </div>

              {/* Reviewer Action Buttons */}
              <div className="modal-actions app-review-actions">
                {appDetails.application.status === 'SUBMITTED' && (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busyAction}
                    onClick={() => handleUpdateStatus(appDetails.application.id, 'IN_REVIEW')}
                  >
                    Взять на рассмотрение
                  </button>
                )}

                {appDetails.application.status !== 'REJECTED' && (
                  <button
                    type="button"
                    className="btn danger-ghost"
                    disabled={busyAction}
                    onClick={() => handleUpdateStatus(appDetails.application.id, 'REJECTED')}
                  >
                    <XCircle size={15} /> Отклонить заявку
                  </button>
                )}

                {user?.role === 'ADMIN' && (
                  <button
                    type="button"
                    className="btn outline"
                    disabled={busyAction}
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/recruitment/applications/${appDetails.application.id}/allow-resubmission`, {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                        });
                        const data = await res.json();
                        if (res.ok) {
                          toast.success(data.message);
                          fetchApplicationDetails(appDetails.application.id);
                        } else {
                          toast.error(data.error);
                        }
                      } catch (err) {
                        toast.error('Ошибка сети');
                      }
                    }}
                  >
                    Разрешить повторную подачу
                  </button>
                )}

                {appDetails.application.status !== 'APPROVED' ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyAction}
                    onClick={() => {
                      setApprovingApp(appDetails.application);
                    }}
                  >
                    <UserCheck size={16} /> Одобрить и создать профиль медиаволонтёра
                  </button>
                ) : (
                  <span className="approved-badge-lg">
                    <CheckCircle size={16} /> Кандидат зачислен в команду (логин: @{appDetails.application.student_login})
                  </span>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* APPROVE & CREATE STUDENT MODAL */}
      {approvingApp && (
        <Modal
          isOpen={true}
          onClose={() => setApprovingApp(null)}
          title={`Зачисление кандидата: ${approvingApp.full_name}`}
          maxWidth="520px"
        >
          <form onSubmit={handleApproveAndCreate} className="modal-form">
            <p className="modal-intro">
              После подтверждения для кандидата будет автоматически создан аккаунт медиаволонтёра со специализацией{' '}
              <strong>«{approvingApp.track_name}»</strong> и начислено стартовое поощрение (+10 баллов).
            </p>

            <div className="form-group">
              <label>Кандидат</label>
              <input
                type="text"
                disabled
                value={`${approvingApp.full_name} (${approvingApp.group_name})`}
                className="disabled-input"
              />
            </div>

            <div className="form-group">
              <label>Контакты</label>
              <input
                type="text"
                disabled
                value={`Телефон: `}
                className="disabled-input"
              />
            </div>

            <div className="form-group">
              <label>Пароль для первого входа (необязательно)</label>
              <input
                type="text"
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
                placeholder="Случайный надёжный пароль (если оставить пустым)"
              />
              <small className="muted">Если оставить поле пустым, система сгенерирует надёжный случайный пароль. При первом входе в систему студенту потребуется сменить временный пароль на постоянный.</small>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setApprovingApp(null)}
                disabled={busyAction}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={busyAction}
              >
                {busyAction ? 'Создаём аккаунт…' : 'Подтвердить и зачислить'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
