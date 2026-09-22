import React, { useState, useEffect } from 'react';
import { Trophy, Award, Medal, Users, ArrowUpRight } from 'lucide-react';
import { api } from '../api.js';
import { Page, Loader, Empty, Avatar } from '../components/UI.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Leaderboard({ user }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api('/leaderboard')
      .then(setRows)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader text="Загружаем рейтинг медиаволонтёров…" />;

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <Page
      title="Рейтинг медиаволонтёров медиацентра"
      subtitle="Прозрачная система поощрения вклада студентов. Расти в рейтинге, создавай медиа и побеждай в сезоне!"
    >
      {/* Podium for Top 3 */}
      {top3.length > 0 && (
        <div className="podium-section">
          <div className="podium-grid">
            {/* 2nd place */}
            {top3[1] && (
              <div className={`podium-card podium-rank-2 ${top3[1].id === user.id ? 'is-me' : ''}`}
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
                <span className="podium-completed">{top3[1].completed} заданий</span>
              </div>
            )}

            {/* 1st place */}
            {top3[0] && (
              <div className={`podium-card podium-rank-1 ${top3[0].id === user.id ? 'is-me' : ''}`}
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
                <span className="podium-completed">{top3[0].completed} заданий</span>
              </div>
            )}

            {/* 3rd place */}
            {top3[2] && (
              <div className={`podium-card podium-rank-3 ${top3[2].id === user.id ? 'is-me' : ''}`}
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
                <span className="podium-completed">{top3[2].completed} заданий</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full Leaderboard Table */}
      <div className="panel leaderboard-panel">
        <div className="section-head">
          <h2>Таблица лидеров сезона</h2>
          <span className="muted">Всего медиаволонтёров: {rows.length}</span>
        </div>

        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '60px' }}>Ранг</th>
                <th>Медиаволонтёр</th>
                <th>Группа / Курс</th>
                <th>Навыки</th>
                <th style={{ textAlign: 'center' }}>Завершено</th>
                <th style={{ textAlign: 'right' }}>Баллы</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isCurrent = r.id === user.id;
                return (
                  <tr key={r.id} className={isCurrent ? 'current-user-row' : ''}>
                    <td>
                      <div className={`rank-indicator rank-badge-${r.position <= 3 ? r.position : 'other'}`}>
                        #{r.position}
                      </div>
                    </td>
                    <td>
                      <div className="table-user-cell">
                        <Avatar firstName={r.first_name} lastName={r.last_name} size="small" />
                        <div>
                          <b>
                            {r.first_name} {r.last_name} {isCurrent && <span className="you-pill">Вы</span>}
                          </b>
                          <small className="muted">@{r.login}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span>{r.group_name || '—'}</span>
                      {r.year && <small className="muted"> · {r.year} курс</small>}
                    </td>
                    <td>
                      <div className="skill-tags-inline">
                        {r.skills
                          ? r.skills.split(',').slice(0, 2).map((s, i) => (
                              <span key={i} className="skill-pill-sm">
                                {s.trim()}
                              </span>
                            ))
                          : '—'}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="completed-badge">{r.completed} задач</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong className="points-cell">{r.points} баллов</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}
