import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  MapPin,
  Users,
  Award,
  ArrowLeft,
  Edit,
  Trash2,
  Send,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ShieldCheck,
  FileText
} from 'lucide-react';
import { api, formatDate, formatDateTime, relativeTime } from '../api.js';
import { Page, Loader, Empty, StatusBadge, PriorityBadge, Avatar } from '../components/UI.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function TaskDetail({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applyComment, setApplyComment] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [submissionMethod, setSubmissionMethod] = useState('link');
  const [materialsUrl, setMaterialsUrl] = useState('');
  const [comment, setComment] = useState('');
  const [applying, setApplying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Completion modal state for staff
  const [completeModalUser, setCompleteModalUser] = useState(null);
  const [customPoints, setCustomPoints] = useState('');
  const [completionReason, setCompletionReason] = useState('');
  const [confirmingCompletion, setConfirmingCompletion] = useState(false);

  const parsedRoles = React.useMemo(() => {
    if (!task?.roles_needed) return [];
    try {
      const parsed = typeof task.roles_needed === 'string' ? JSON.parse(task.roles_needed) : task.roles_needed;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [task?.roles_needed]);

  const loadTask = async () => {
    try {
      setLoading(true);
      const res = await api(`/tasks/${id}`);
      setTask(res);
      setCustomPoints(res.points || 0);
      setCompletionReason(`Успешное выполнение: «${res.title}»`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTask();
  }, [id]);

  // Student applies
  const handleApply = async (e) => {
    e.preventDefault();
    if (parsedRoles.length > 0 && !selectedRole) {
      toast.error('Пожалуйста, выберите позицию/роль на мероприятии');
      return;
    }
    setApplying(true);
    try {
      await api(`/tasks/${id}/apply`, {
        method: 'POST',
        body: JSON.stringify({
          comment: applyComment,
          role_name: selectedRole || null
        })
      });
      toast.success('Заявка на участие успешно отправлена!');
      setApplyComment('');
      setSelectedRole('');
      loadTask();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setApplying(false);
    }
  };

  // Student withdraws
  const handleWithdraw = async () => {
    if (!window.confirm('Вы действительно хотите отозвать свою заявку?')) return;
    try {
      await api(`/tasks/${id}/withdraw`, { method: 'POST' });
      toast.info('Ваша заявка отозвана');
      loadTask();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Student submits completion proof
  const handleSubmitCompletion = async (e) => {
    e.preventDefault();
    if (submissionMethod === 'link') {
      if (!materialsUrl.trim()) return toast.error('Укажите ссылку на материалы');
      if (!isValidYandexDiskLink(materialsUrl.trim())) return toast.error('Укажите корректную ссылку на Яндекс Диск');
    }
    setSubmitting(true);
    try {
      await api(`/tasks/${id}/submit-completion`, {
        method: 'POST',
        body: JSON.stringify({ comment, materials_url: submissionMethod === 'link' ? materialsUrl.trim() : '', submission_method: submissionMethod })
      });
      toast.success('Отчёт о выполнении передан на проверку!');
      setMaterialsUrl('');
      setComment('');
      loadTask();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Staff updates application status (e.g. SELECTED, REJECTED, NO_SHOW)
  const handleUpdateStatus = async (appId, newStatus) => {
    try {
      await api(`/applications/${appId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      toast.success(`Статус заявки обновлён: ${newStatus}`);
      loadTask();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Staff confirms completion and awards points
  const handleConfirmCompletion = async () => {
    if (!completeModalUser) return;
    setConfirmingCompletion(true);
    try {
      await api(`/tasks/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          user_id: completeModalUser.user_id,
          points: parseInt(customPoints, 10) || task.points,
          reason: completionReason
        })
      });
      toast.success(`Выполнение подтверждено! Медиаволонтёру начислено ${customPoints} баллов.`);
      setCompleteModalUser(null);
      loadTask();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConfirmingCompletion(false);
    }
  };

  // Staff deletes/archives task
  const handleDeleteTask = async () => {
    if (!window.confirm(`Вы уверены, что хотите удалить или архивировать задание «${task.title}»?`)) return;
    try {
      const res = await api(`/tasks/${id}`, { method: 'DELETE' });
      toast.info(res.message || 'Задание удалено');
      navigate('/tasks');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading || !task) return <Loader text="Загружаем задание…" />;

  const isStaffOrAdmin = user.role !== 'STUDENT';
  const myApp = task.my_application;

  return (
    <Page
      title={task.title}
      subtitle={`Категория: ${task.category || 'Событие'} · Дата публикации: ${formatDate(task.created_at)}`}
      actions={
        <div className="page-actions-group">
          <Link to="/tasks" className="btn ghost">
            <ArrowLeft size={16} /> К списку мероприятий
          </Link>
          {isStaffOrAdmin && (
            <>
              <Link to={`/tasks/${id}/edit`} className="btn ghost">
                <Edit size={16} /> Редактировать
              </Link>
              <button className="btn danger-ghost" onClick={handleDeleteTask} title="Удалить мероприятие">
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="task-detail-grid">
        {/* Left column: main info and student workflow */}
        <div className="task-detail-main">
          <div className="panel detail-hero-panel">
            <div className="detail-hero-top">
              <div className="detail-badges">
                <span className="badge category-badge">{task.category || 'Событие'}</span>
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
              </div>
              <div className="detail-points-reward">
                <Award size={18} />
                <span>+{task.points} баллов</span>
              </div>
            </div>

            <div className="detail-description">
              <h3>Описание мероприятия</h3>
              <p className="detail-desc-text">{task.description || 'Описание отсутствует.'}</p>
            </div>

            <div className="detail-meta-grid">
              <div className="meta-box">
                <CalendarDays size={18} className="meta-icon" />
                <div>
                  <span className="meta-label">Дата и время</span>
                  <b>{formatDate(task.event_date)}</b>
                  <small className="muted">
                    {task.start_time || 'Время не указано'}
                    {task.end_time ? ` – ${task.end_time}` : ''}
                  </small>
                </div>
              </div>

              <div className="meta-box">
                <MapPin size={18} className="meta-icon" />
                <div>
                  <span className="meta-label">Место проведения</span>
                  <b>{task.location || 'Локация уточняется'}</b>
                </div>
              </div>

              <div className="meta-box">
                <Users size={18} className="meta-icon" />
                <div>
                  <span className="meta-label">Требуется медиаволонтёров</span>
                  <b>{task.required_volunteers} чел.</b>
                </div>
              </div>
            </div>

            {parsedRoles.length > 0 && (
              <div className="detail-extra-block">
                <h4>Требуемые позиции:</h4>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {parsedRoles.map((r, idx) => (
                    <span key={idx} className="badge badge-primary" style={{ fontSize: '12px', padding: '4px 10px' }}>
                      {r.name} — {r.count} чел.
                    </span>
                  ))}
                </div>
              </div>
            )}

            {task.skills && (
              <div className="detail-extra-block">
                <h4>Требуемые навыки:</h4>
                <div className="skill-tags">
                  {task.skills.split(',').map((s, idx) => (
                    <span key={idx} className="skill-pill">
                      {tSkill(s.trim())}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {task.equipment && (
              <div className="detail-extra-block">
                <h4>Необходимое оборудование:</h4>
                <p className="extra-text">{task.equipment}</p>
              </div>
            )}

            {task.notes && (
              <div className="detail-extra-block">
                <h4>Примечания и регламент:</h4>
                <p className="extra-text">{task.notes}</p>
              </div>
            )}

            {task.creator && (
              <div className="detail-creator-info">
                <span className="muted">Сотрудник медиацентра:</span>
                <b>{task.creator}</b>
                
              </div>
            )}
          </div>

          {/* STUDENT PARTICIPATION WORKFLOW */}
          {!isStaffOrAdmin && (
            <div className="panel student-action-panel">
              {/* Case 1: Never applied or Withdrawn */}
              {(!myApp || myApp.status === 'WITHDRAWN') && (
                <div>
                  {task.status === 'OPEN' ? (
                    <form onSubmit={handleApply}>
                      <h3>Хотите участвовать в этом задании?</h3>
                      <p className="muted">
                        Выберите желаемую позицию и при необходимости оставьте комментарий сотруднику (например, о технике или опыте).
                      </p>

                      {parsedRoles.length > 0 && (
                        <div className="form-group" style={{ marginBottom: '12px' }}>
                          <label style={{ fontSize: '13px', fontWeight: 600 }}>
                            Желаемая позиция / роль *
                          </label>
                          <select
                            value={selectedRole}
                            onChange={(e) => setSelectedRole(e.target.value)}
                            required
                          >
                            <option value="">-- Выберите роль на мероприятии --</option>
                            {parsedRoles.map((r, i) => (
                              <option key={i} value={r.name}>
                                {r.name} ({r.count} чел.)
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="form-group">
                        <textarea
                          rows="3"
                          placeholder="Ваш комментарий или пожелания (необязательно)…"
                          value={applyComment}
                          onChange={(e) => setApplyComment(e.target.value)}
                        />
                      </div>

                      <button type="submit" className="btn primary" disabled={applying}>
                        <Send size={16} /> {applying ? 'Отправляем…' : 'Подать заявку медиаволонтёра'}
                      </button>
                    </form>
                  ) : (
                    <div className="notice-box muted-box">
                      <AlertCircle size={20} />
                      <div>
                        <b>Приём заявок закрыт</b>
                        <p>Задание находится в статусе «{task.status}».</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Case 2: APPLIED */}
              {myApp && myApp.status === 'APPLIED' && (
                <div className="participation-card pending">
                  <div className="part-header">
                    <Clock size={22} className="part-icon" />
                    <div>
                      <h3>Ваша заявка на рассмотрении</h3>
                      <p className="muted">Сотрудник рассматривает отклики и скоро свяжется с вами.</p>
                    </div>
                  </div>
                  {myApp.comment && (
                    <div className="my-comment-box">
                      <span className="muted">Ваш комментарий:</span> «{myApp.comment}»
                    </div>
                  )}
                  <button className="btn danger-ghost" onClick={handleWithdraw}>
                    Отозвать заявку
                  </button>
                </div>
              )}

              {/* Case 3: SELECTED or IN_PROGRESS */}
              {myApp && ['SELECTED', 'IN_PROGRESS'].includes(myApp.status) && (
                <div className="participation-card selected-card">
                  <div className="part-header">
                    <CheckCircle2 size={24} className="part-icon success" />
                    <div>
                      <h3>Поздравляем! Вы выбраны медиаволонтёром!</h3>
                      <p>
                        Вы утверждены для участия в задании. Пожалуйста, будьте на связи с сотрудником.
                        После завершения работы отправьте ссылку на материалы или краткий отчёт.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleSubmitCompletion} className="submission-form">
                    <label>
                      <b>Сдать работу на проверку:</b>
                      <span className="muted">Прикрепите ссылку на диск с материалами или опишите результат</span>
                    </label>
                    <textarea
                      rows="3"
                      required
                      placeholder="Например: Ссылка на Яндекс.Диск с фоторепортажем (250 кадров) и отобранные лучшие фото…"
                      value={submissionNotes}
                      onChange={(e) => setSubmissionNotes(e.target.value)}
                    />
                    <div className="submission-actions">
                      <button type="submit" className="btn success" disabled={submitting}>
                        <CheckCircle2 size={16} /> {submitting ? 'Отправляем…' : 'Сдать работу сотруднику'}
                      </button>
                      <button type="button" className="btn danger-ghost" onClick={handleWithdraw}>
                        Отозвать участие
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Case 4: COMPLETION_SUBMITTED */}
              {myApp && myApp.status === 'COMPLETION_SUBMITTED' && (
                <div className="participation-card submitted-card">
                  <div className="part-header">
                    <Clock size={22} className="part-icon" />
                    <div>
                      <h3>Отчёт сдан на проверку</h3>
                      <p className="muted">Сотрудник проверяет выполненную работу. После подтверждения баллы поступят в зачётную книжку.</p>
                    </div>
                  </div>
                  {(task.my_versions && task.my_versions.length > 0) ? (
                    <div className="versions-history">
                      <h4>История отчётов</h4>
                      {task.my_versions.map(v => (
                        <div key={v.id} className="version-item" style={{ marginBottom: '8px', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px' }}>
                          <div className="muted" style={{ fontSize: '12px', marginBottom: '4px' }}>
                            Версия {v.version_number} — {new Date(v.created_at).toLocaleString('ru-RU')}
                          </div>
                          {v.materials_url && (
                            <div><b>Ссылка:</b> <a href={v.materials_url} target="_blank" rel="noreferrer">{v.materials_url}</a></div>
                          )}
                          {v.comment && (
                            <div><b>Комментарий:</b> {v.comment}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : myApp.submission_notes && (
                    <div className="my-comment-box">
                      <span className="muted">Ваш отчёт:</span> «{myApp.submission_notes}»
                    </div>
                  )}
                </div>
              )}

              {/* Case 5: COMPLETED */}
              {myApp && myApp.status === 'COMPLETED' && (
                <div className="participation-card completed-card">
                  <div className="part-header">
                    <Award size={26} className="part-icon success" />
                    <div>
                      <h3>Задание успешно выполнено!</h3>
                      <p>
                        Вам начислены баллы за это задание. Запись внесена в вашу зачётную книжку.
                      </p>
                    </div>
                  </div>
                  <Link to="/record-book" className="btn primary">
                    Открыть мою зачётную книжку →
                  </Link>
                </div>
              )}

              {/* Case 6: REJECTED or NO_SHOW */}
              {myApp && ['REJECTED', 'NO_SHOW'].includes(myApp.status) && (
                <div className="participation-card rejected-card">
                  <AlertCircle size={22} className="part-icon danger" />
                  <div>
                    <h3>Статус: {myApp.status === 'REJECTED' ? 'Заявка отклонена' : 'Отмечена неявка'}</h3>
                    <p className="muted">
                      К сожалению, в этот раз сотрудник выбрал других участников либо зафиксировал неявку.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column: Applicants management (Staff/Admin) or Team List (Student) */}
        <div className="task-detail-sidebar">
          {isStaffOrAdmin ? (
            <div className="panel applicants-panel">
              <div className="section-head">
                <div>
                  <h3>Заявки медиаволонтёров</h3>
                  <p className="muted">Управление составом команды</p>
                </div>
                <span className="section-count">{task.applicants?.length || 0}</span>
              </div>

              {task.applicants && task.applicants.length > 0 ? (
                <div className="applicants-list">
                  {task.applicants.map((app) => (
                    <div className="applicant-item" key={app.id}>
                      <div className="applicant-top">
                        <Avatar firstName={app.first_name} lastName={app.last_name} size="normal" />
                        <div className="applicant-header-text">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <b>{app.first_name} {app.last_name}</b>
                            {app.order_num && (
                              <span
                                style={{
                                  fontSize: '11px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  background: 'var(--surface2)',
                                  border: '1px solid var(--border)',
                                  color: 'var(--text-secondary)'
                                }}
                              >
                                №{app.order_num} · {app.created_at ? formatDateTime(app.created_at).slice(-5) : ''}
                              </span>
                            )}
                          </div>
                          <small className="muted">
                            {app.group_name} {app.year ? `· ${app.year} курс` : ''} · Баллов: {app.student_points}
                          </small>
                          {app.role_name && (
                            <div style={{ marginTop: '3px' }}>
                              <span className="badge badge-primary" style={{ fontSize: '11px', padding: '2px 8px' }}>
                                Позиция: {app.role_name}
                              </span>
                            </div>
                          )}
                        </div>
                        <StatusBadge status={app.status} />
                      </div>

                      {app.skills && (
                        <div className="applicant-skills">
                          <small className="muted">Навыки:</small> {app.skills}
                        </div>
                      )}

                      {app.comment && (
                        <div className="applicant-comment">
                          <FileText size={13} /> <span>«{app.comment}»</span>
                        </div>
                      )}

                      {(app.versions && app.versions.length > 0) ? (
                        <div className="versions-history" style={{ marginTop: '12px' }}>
                          <b>История изменений:</b>
                          {app.versions.map(v => (
                            <div key={v.id} className="version-item" style={{ marginTop: '8px', padding: '8px', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                              <div className="muted" style={{ fontSize: '12px', marginBottom: '4px' }}>
                                Версия {v.version_number} — {new Date(v.created_at).toLocaleString('ru-RU')}
                              </div>
                              {v.materials_url && (
                                <div><b>Ссылка:</b> <a href={v.materials_url} target="_blank" rel="noreferrer">{v.materials_url}</a></div>
                              )}
                              {v.comment && (
                                <div><b>Комментарий:</b> {v.comment}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : app.submission_notes && (
                        <div className="applicant-submission">
                          <b>Отчёт медиаволонтёра:</b>
                          <p>{app.submission_notes}</p>
                        </div>
                      )}

                      {/* Actions for Staff */}
                      <div className="applicant-actions">
                        {app.status === 'APPLIED' && (
                          <>
                            <button
                              className="btn tiny primary"
                              onClick={() => handleUpdateStatus(app.id, 'SELECTED')}
                            >
                              Выбрать медиаволонтёром
                            </button>
                            <button
                              className="btn tiny ghost"
                              onClick={() => handleUpdateStatus(app.id, 'REJECTED')}
                            >
                              Отклонить
                            </button>
                          </>
                        )}

                        {['SELECTED', 'IN_PROGRESS', 'COMPLETION_SUBMITTED'].includes(app.status) && (
                          <>
                            <button
                              className="btn tiny success"
                              onClick={() => setCompleteModalUser(app)}
                            >
                              <CheckCircle2 size={13} /> Подтвердить +{task.points} баллов
                            </button>
                            <button
                              className="btn tiny ghost"
                              onClick={() => handleUpdateStatus(app.id, 'NO_SHOW')}
                              title="Отметить неявку"
                            >
                              Неявка
                            </button>
                          </>
                        )}

                        {app.status === 'COMPLETED' && (
                          <div className="awarded-tag">
                            <CheckCircle2 size={14} /> Баллы начислены
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="Заявок пока нет"
                  text="Студенты увидят открытое задание и смогут откликнуться."
                />
              )}
            </div>
          ) : (
            <div className="panel selected-team-panel">
              <div className="section-head">
                <h3>Команда медиаволонтёров</h3>
                <span className="muted">{task.selected_volunteers?.length || 0} участников</span>
              </div>
              {task.selected_volunteers && task.selected_volunteers.length > 0 ? (
                <div className="team-list">
                  {task.selected_volunteers.map((vol) => (
                    <div className="team-member" key={vol.id}>
                      <Avatar firstName={vol.first_name} lastName={vol.last_name} size="small" />
                      <div>
                        <b>{vol.first_name} {vol.last_name}</b>
                        <small className="muted">{vol.group_name || 'Медиаволонтёр'}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="Команда формируется" text="Отобранные медиаволонтёры будут показаны здесь." />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Completion & Points Award Modal */}
      {completeModalUser && (
        <Modal
          isOpen={true}
          onClose={() => setCompleteModalUser(null)}
          title="Подтверждение выполнения и начисление баллов"
        >
          <div className="modal-form">
            <p className="muted">
              Вы подтверждаете завершение работы медиаволонтёром{' '}
              <b>
                {completeModalUser.first_name} {completeModalUser.last_name}
              </b>{' '}
              по заданию «{task.title}».
            </p>

            <div className="form-group">
              <label>Количество начисляемых баллов (до 100)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={customPoints}
                onChange={(e) => setCustomPoints(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Основание для записи в зачётную книжку</label>
              <input
                type="text"
                value={completionReason}
                onChange={(e) => setCompletionReason(e.target.value)}
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setCompleteModalUser(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn success"
                disabled={confirmingCompletion}
                onClick={handleConfirmCompletion}
              >
                {confirmingCompletion ? 'Начисляем…' : 'Подтвердить и начислить'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
