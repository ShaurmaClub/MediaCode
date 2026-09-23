import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Award,
  BookOpen,
  Calendar,
  PlusCircle,
  Phone,
  MessageSquare,
  Mail,
  UserCheck,
  Trophy,
  Medal,
  Clock,
  ArrowUpRight
} from 'lucide-react';
import { api, formatDate, relativeTime } from '../api.js';
import { Page, Loader, Empty, Avatar } from '../components/UI.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Students({ user }) {
  const [activeTab, setActiveTab] = useState('directory'); // 'directory' | 'leaderboard'
  const [students, setStudents] = useState([]);
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const toast = useToast();

  // Selected student for Profile modal
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentDetails, setStudentDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [profileTab, setProfileTab] = useState('overview'); // 'overview' | 'tasks' | 'points'

  // Award points modal for staff
  const [awardModalOpen, setAwardModalOpen] = useState(false);
  const [awardAmount, setAwardAmount] = useState(20);
  const [awardReason, setAwardReason] = useState('');
  const [awardCategory, setAwardCategory] = useState('BONUS');
  const [awarding, setAwarding] = useState(false);

  const loadStudents = async () => {
    try {
      setLoading(true);
      const res = await api(`/users?role=STUDENT&status=ACTIVE&search=${encodeURIComponent(search.trim())}`);
      setStudents(res);
    } catch (err) {
      toast.error('Не удалось загрузить медиаволонтёров: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadLeaderboard = async () => {
    try {
      setLoading(true);
      const res = await api('/leaderboard');
      setLeaderboardRows(res);
    } catch (err) {
      toast.error('Не удалось загрузить рейтинг: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'directory') {
      loadStudents();
    } else {
      loadLeaderboard();
    }
  }, [activeTab]);

  const handleOpenProfile = async (s) => {
    setSelectedStudent(s);
    setProfileTab('overview');
    setDetailsLoading(true);
    try {
      const res = await api(`/users/${s.id}`);
      setStudentDetails(res);
    } catch (err) {
      toast.error('Не удалось загрузить профиль: ' + err.message);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleAwardPoints = async (e) => {
    e.preventDefault();
    if (!awardReason.trim()) {
      toast.error('Укажите причину начисления баллов');
      return;
    }
    setAwarding(true);
    try {
      await api('/points/award', {
        method: 'POST',
        body: JSON.stringify({
          user_id: selectedStudent.id,
          amount: parseInt(awardAmount, 10),
          reason: awardReason.trim(),
          category: awardCategory
        })
      });
      toast.success(`Успешно начислено ${awardAmount} баллов медиаволонтёру!`);
      setAwardModalOpen(false);
      setAwardReason('');
      // Reload profile & directory
      handleOpenProfile(selectedStudent);
      if (activeTab === 'directory') loadStudents();
      else loadLeaderboard();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAwarding(false);
    }
  };

  const isStaffOrAdmin = user.role !== 'STUDENT';

  const top3 = leaderboardRows.slice(0, 3);

  return (
    <Page
      title="Команда медиаволонтёров"
      subtitle="Каталог участников медиацентра, специализации, зачётки и сезонный рейтинг активности."
      actions={
        <div className="tab-pills-row">
          <button
            type="button"
            className={`tab-pill-btn ${activeTab === 'directory' ? 'active' : ''}`}
            onClick={() => setActiveTab('directory')}
          >
            Каталог медиаволонтёров
          </button>
          <button
            type="button"
            className={`tab-pill-btn ${activeTab === 'leaderboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('leaderboard')}
          >
            <Trophy size={14} /> Рейтинг активности
          </button>
        </div>
      }
    >
      {/* DIRECTORY VIEW */}
      {activeTab === 'directory' && (
        <>
          {/* Search Bar */}
          <div className="toolbar">
            <form
              className="search-box"
              onSubmit={(e) => {
                e.preventDefault();
                loadStudents();
              }}
            >
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Поиск по имени, группе или навыкам (фото, видео, монтаж, СММ)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" className="btn tiny primary">
                Найти
              </button>
            </form>
          </div>

          {/* Volunteers Grid */}
          {loading ? (
            <Loader text="Загружаем каталог медиаволонтёров…" />
          ) : students.length > 0 ? (
            <div className="students-grid">
              {students.map((s) => (
                <div
                  key={s.id}
                  className="student-card"
                  onClick={() => handleOpenProfile(s)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="student-card-header">
                    <Avatar firstName={s.first_name} lastName={s.last_name} size="big" />
                    <div className="student-card-score">
                      <strong>{s.points || s.totalPoints || 0}</strong>
                      <small>баллов</small>
                    </div>
                  </div>

                  <h3>
                    {s.first_name} {s.last_name}
                  </h3>
                  <p className="student-group-text">
                    {s.group_name || 'Группа не указана'}
                    {s.year ? ` · ${s.year} курс` : ''}
                  </p>

                  {s.bio && <p className="student-bio-preview clamp">{s.bio}</p>}

                  <div className="skill-row">
                    {s.skills ? (
                      s.skills.split(',').slice(0, 3).map((sk, idx) => (
                        <span key={idx} className="skill-pill-sm">
                          {sk.trim()}
                        </span>
                      ))
                    ) : (
                      <span className="skill-pill-sm muted-pill">Медиа</span>
                    )}
                  </div>

                  <div className="student-card-foot">
                    <span className="completed-count">
                      <UserCheck size={13} /> {s.completed || 0} мероприятий
                    </span>
                    <span className="view-profile-link">Подробнее →</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="Медиаволонтёры не найдены"
              text="Попробуйте изменить поисковый запрос."
            />
          )}
        </>
      )}

      {/* LEADERBOARD VIEW */}
      {activeTab === 'leaderboard' && (
        <div className="embedded-leaderboard">
          {loading ? (
            <Loader text="Загружаем рейтинг медиаволонтёров…" />
          ) : (
            <>
              {/* Podium for Top 3 */}
              {top3.length > 0 && (
                <div className="podium-section">
                  <div className="podium-grid">
                    {/* 2nd place */}
                    {top3[1] && (
                      <div
                        className={`podium-card podium-rank-2 ${top3[1].id === user.id ? 'is-me' : ''}`}
                        onClick={() => handleOpenProfile(top3[1])}
                      >
                        <div className="podium-medal-badge rank-2">
                          <Medal size={16} /> 2 место
                        </div>
                        <Avatar firstName={top3[1].first_name} lastName={top3[1].last_name} size="big" />
                        <h3 className="podium-name">
                          {top3[1].first_name} {top3[1].last_name}
                        </h3>
                        <small className="muted">{top3[1].group_name || 'Медиаволонтёр'}</small>
                        <div className="podium-score">
                          <strong>{top3[1].points}</strong> <small>баллов</small>
                        </div>
                        <span className="podium-completed">{top3[1].completed} мероприятий</span>
                      </div>
                    )}

                    {/* 1st place */}
                    {top3[0] && (
                      <div
                        className={`podium-card podium-rank-1 ${top3[0].id === user.id ? 'is-me' : ''}`}
                        onClick={() => handleOpenProfile(top3[0])}
                      >
                        <div className="podium-crown">👑</div>
                        <div className="podium-medal-badge rank-1">
                          <Trophy size={16} /> 1 место
                        </div>
                        <Avatar firstName={top3[0].first_name} lastName={top3[0].last_name} size="huge" />
                        <h3 className="podium-name">
                          {top3[0].first_name} {top3[0].last_name}
                        </h3>
                        <small className="muted">{top3[0].group_name || 'Медиаволонтёр'}</small>
                        <div className="podium-score gold">
                          <strong>{top3[0].points}</strong> <small>баллов</small>
                        </div>
                        <span className="podium-completed">{top3[0].completed} мероприятий</span>
                      </div>
                    )}

                    {/* 3rd place */}
                    {top3[2] && (
                      <div
                        className={`podium-card podium-rank-3 ${top3[2].id === user.id ? 'is-me' : ''}`}
                        onClick={() => handleOpenProfile(top3[2])}
                      >
                        <div className="podium-medal-badge rank-3">
                          <Medal size={16} /> 3 место
                        </div>
                        <Avatar firstName={top3[2].first_name} lastName={top3[2].last_name} size="big" />
                        <h3 className="podium-name">
                          {top3[2].first_name} {top3[2].last_name}
                        </h3>
                        <small className="muted">{top3[2].group_name || 'Медиаволонтёр'}</small>
                        <div className="podium-score">
                          <strong>{top3[2].points}</strong> <small>баллов</small>
                        </div>
                        <span className="podium-completed">{top3[2].completed} мероприятий</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Leaderboard Table */}
              <div className="panel leaderboard-panel">
                <div className="section-head">
                  <h2>Таблица лидеров сезона</h2>
                  <span className="muted">Всего медиаволонтёров: {leaderboardRows.length}</span>
                </div>

                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>Место</th>
                        <th>Медиаволонтёр</th>
                        <th>Группа</th>
                        <th>Выполнено</th>
                        <th style={{ textAlign: 'right' }}>Баллы</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboardRows.map((r) => (
                        <tr
                          key={r.id}
                          className={`leader-row ${r.id === user.id ? 'is-me' : ''}`}
                          onClick={() => handleOpenProfile(r)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <strong className="rank-num">#{r.position}</strong>
                          </td>
                          <td>
                            <div className="table-user-cell">
                              <Avatar firstName={r.first_name} lastName={r.last_name} size="small" />
                              <div>
                                <b>{r.first_name} {r.last_name}</b>
                                {r.id === user.id && <span className="me-tag">Вы</span>}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span>{r.group_name || '—'}</span>
                            {r.year && <small className="muted"> · {r.year} курс</small>}
                          </td>
                          <td>
                            <span>{r.completed} мероприятий</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <strong className="score-gold">{r.points}</strong>
                            <small className="muted"> баллов</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* COMBINED VOLUNTEER PROFILE MODAL */}
      {selectedStudent && (
        <Modal
          isOpen={true}
          onClose={() => {
            setSelectedStudent(null);
            setStudentDetails(null);
          }}
          title="Профиль медиаволонтёра"
          maxWidth="680px"
        >
          {detailsLoading || !studentDetails ? (
            <Loader text="Загрузка профиля медиаволонтёра…" />
          ) : (
            <div className="profile-modal-body">
              {/* Header Meta */}
              <div className="profile-modal-header">
                <Avatar
                  firstName={studentDetails.user.first_name}
                  lastName={studentDetails.user.last_name}
                  size="huge"
                />
                <div className="profile-modal-meta">
                  <h2>
                    {studentDetails.user.first_name} {studentDetails.user.last_name}
                  </h2>
                  <p className="muted">
                    {studentDetails.user.group_name || 'Медиаволонтёр'}
                    {studentDetails.user.year ? ` · ${studentDetails.user.year} курс` : ''}
                  </p>

                  <div className="profile-contact-chips">
                    {studentDetails.user.phone && (
                      <a href={`tel:${studentDetails.user.phone}`} className="contact-chip">
                        <Phone size={13} /> {studentDetails.user.phone}
                      </a>
                    )}
                  </div>
                </div>

                <div className="profile-modal-score">
                  <span className="muted">Баланс в зачётке</span>
                  <strong>{studentDetails.user.totalPoints}</strong>
                  <small className="muted">баллов</small>
                </div>
              </div>

              {/* Sub-tabs in Profile */}
              <div className="profile-subtabs">
                <button
                  type="button"
                  className={`profile-subtab ${profileTab === 'overview' ? 'active' : ''}`}
                  onClick={() => setProfileTab('overview')}
                >
                  Обзор
                </button>
                <button
                  type="button"
                  className={`profile-subtab ${profileTab === 'tasks' ? 'active' : ''}`}
                  onClick={() => setProfileTab('tasks')}
                >
                  Мероприятия ({studentDetails.completedTasks?.length || 0})
                </button>
                <button
                  type="button"
                  className={`profile-subtab ${profileTab === 'points' ? 'active' : ''}`}
                  onClick={() => setProfileTab('points')}
                >
                  Зачётка ({studentDetails.pointsHistory?.length || 0})
                </button>
              </div>

              {/* TAB 1: OVERVIEW */}
              {profileTab === 'overview' && (
                <div className="profile-tab-content">
                  {studentDetails.user.bio && (
                    <div className="profile-modal-section">
                      <h4>О себе и опыт:</h4>
                      <p className="profile-bio-text">{studentDetails.user.bio}</p>
                    </div>
                  )}

                  <div className="profile-modal-section">
                    <h4>Специализация и навыки:</h4>
                    <div className="skill-tags">
                      {studentDetails.user.skills ? (
                        studentDetails.user.skills.split(',').map((sk, idx) => (
                          <span key={idx} className="skill-pill">
                            {sk.trim()}
                          </span>
                        ))
                      ) : (
                        <span className="muted">Навыки не указаны</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: COMPLETED TASKS */}
              {profileTab === 'tasks' && (
                <div className="profile-tab-content">
                  {studentDetails.completedTasks && studentDetails.completedTasks.length > 0 ? (
                    <div className="completed-tasks-list">
                      {studentDetails.completedTasks.map((ct) => (
                        <div className="completed-task-item" key={ct.id}>
                          <div>
                            <Link to={`/tasks/${ct.id}`} className="completed-task-title">
                              {ct.title}
                            </Link>
                            <small className="muted">
                              {ct.category} · {formatDate(ct.event_date)}
                            </small>
                          </div>
                          {ct.points_earned !== null && (
                            <span className="points-badge">+{ct.points_earned} баллов</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">Пока нет завершённых мероприятий.</p>
                  )}
                </div>
              )}

              {/* TAB 3: POINTS / RECORD BOOK */}
              {profileTab === 'points' && (
                <div className="profile-tab-content">
                  {studentDetails.pointsHistory && studentDetails.pointsHistory.length > 0 ? (
                    <div className="points-history-list">
                      {studentDetails.pointsHistory.map((p) => {
                        const isPos = p.amount > 0;
                        return (
                          <div className="point-row" key={p.id}>
                            <div className={`point-icon ${!isPos ? 'negative' : ''}`}>
                              <ArrowUpRight size={16} />
                            </div>
                            <div className="point-details">
                              <b>{p.reason}</b>
                              <small className="muted">
                                Категория: {p.category}
                                {p.issuer_name ? ` · Начислил: ${p.issuer_name}` : ''}
                              </small>
                            </div>
                            <div className="point-right">
                              <strong className={`point-amount ${!isPos ? 'negative' : 'positive'}`}>
                                {isPos ? '+' : ''}{p.amount}
                              </strong>
                              <time className="muted">{relativeTime(p.created_at)}</time>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                      Записей в зачётной книжке пока нет.
                    </p>
                  )}
                </div>
              )}

              {/* Staff controls */}
              <div className="profile-modal-footer">
                <Link
                  to={`/record-book?userId=${studentDetails.user.id}`}
                  className="btn ghost"
                >
                  <BookOpen size={16} /> Полная зачётка медиаволонтёра
                </Link>

                {isStaffOrAdmin && (
                  <button
                    className="btn primary"
                    onClick={() => setAwardModalOpen(true)}
                  >
                    <PlusCircle size={16} /> Начислить баллы
                  </button>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Award Points Modal (Staff/Admin) */}
      {awardModalOpen && selectedStudent && (
        <Modal
          isOpen={true}
          onClose={() => setAwardModalOpen(false)}
          title={`Начисление баллов в зачётку: ${selectedStudent.first_name} ${selectedStudent.last_name}`}
        >
          <form onSubmit={handleAwardPoints} className="modal-form">
            <div className="form-group">
              <label>Количество баллов (до 100)</label>
              <input
                type="number"
                min="1"
                max="100"
                required
                value={awardAmount}
                onChange={(e) => setAwardAmount(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Категория начисления</label>
              <select
                value={awardCategory}
                onChange={(e) => setAwardCategory(e.target.value)}
              >
                <option value="BONUS">Бонус за активность</option>
                <option value="EVENT">Участие в мероприятии</option>
                <option value="PHOTO_VIDEO">Фото и видео</option>
                <option value="SMM">СММ и дизайн</option>
                <option value="PENALTY">Корректировка</option>
                <option value="OTHER">Прочее</option>
              </select>
            </div>

            <div className="form-group">
              <label>Основание для начисления (будет видно в зачётке медиаволонтёра)</label>
              <input
                type="text"
                required
                placeholder="например: За качественную съёмку репортажа на Дне открытых дверей"
                value={awardReason}
                onChange={(e) => setAwardReason(e.target.value)}
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setAwardModalOpen(false)}
              >
                Отмена
              </button>
              <button type="submit" className="btn success" disabled={awarding}>
                {awarding ? 'Вносим запись…' : 'Внести в зачётку'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
