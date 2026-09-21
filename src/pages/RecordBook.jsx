import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Award, BookOpen, Filter, Search, CheckCircle2, Calendar } from 'lucide-react';
import { api } from '../api.js';
import { Page, Loader, Empty, PointRow } from '../components/UI.jsx';
import { useToast } from '../context/ToastContext.jsx';

const CATEGORIES = [
  { id: 'ALL', label: 'Все категории' },
  { id: 'COMPLETION', label: 'Задания (COMPLETION)' },
  { id: 'EVENT', label: 'События (EVENT)' },
  { id: 'PHOTO_VIDEO', label: 'Фото/Видео (PHOTO_VIDEO)' },
  { id: 'SMM', label: 'SMM и Дизайн (SMM)' },
  { id: 'BONUS', label: 'Бонусы (BONUS)' },
  { id: 'OTHER', label: 'Прочее (OTHER)' }
];

export default function RecordBook({ user }) {
  const [searchParams] = useSearchParams();
  const targetStudentId = searchParams.get('userId');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();

  const loadRecordBook = async () => {
    try {
      setLoading(true);
      const endpoint = targetStudentId ? `/record-book/${targetStudentId}` : '/record-book';
      const res = await api(endpoint);
      setData(res);
    } catch (err) {
      toast.error('Не удалось загрузить зачётную книжку: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecordBook();
  }, [targetStudentId]);

  if (loading || !data) return <Loader text="Загружаем зачётную книжку волонтёра…" />;

  const filteredPoints = (data.points || []).filter((p) => {
    const matchesCategory = categoryFilter === 'ALL' || p.category === categoryFilter;
    const matchesSearch =
      !searchQuery.trim() ||
      p.reason.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.task_title && p.task_title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.issuer_name && p.issuer_name.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const completionCount = (data.points || []).filter((p) => p.category === 'COMPLETION').length;
  const bonusCount = (data.points || []).filter((p) => p.category === 'BONUS').length;

  return (
    <Page
      title={
        targetStudentId
          ? `Зачётная книжка: ${data.user.first_name} ${data.user.last_name}`
          : 'Электронная зачётная книжка волонтёра'
      }
      subtitle="Официальный журнал начислений баллов медиацентра. Каждая запись защищена и неизменяема."
    >
      {/* Hero Record Book Card */}
      <div className="record-hero">
        <div className="record-hero-main">
          <span className="record-hero-eyebrow">ИТОГОВЫЙ БАЛАНС ВОЛОНТЁРА</span>
          <strong className="record-hero-points">{data.user.totalPoints}</strong>
          <p className="record-hero-desc">
            Владелец книжки: <b>{data.user.first_name} {data.user.last_name}</b>{' '}
            {data.user.group_name ? `(${data.user.group_name})` : ''}
          </p>
        </div>

        <div className="record-stats-pill-group">
          <div className="record-stat-box">
            <b>{completionCount}</b>
            <span>выполненных задач</span>
          </div>
          <div className="record-stat-box">
            <b>{bonusCount}</b>
            <span>бонусных наград</span>
          </div>
          <div className="record-stat-box">
            <b>{data.points?.length || 0}</b>
            <span>всего транзакций</span>
          </div>
        </div>
      </div>

      {/* Ledger Table / List */}
      <div className="panel">
        <div className="section-head">
          <div>
            <h2>История транзакций в ledger</h2>
            <p className="muted">Полная история начислений с указанием куратора и даты.</p>
          </div>

          <div className="toolbar-inline">
            <div className="search-box-inline">
              <Search size={14} />
              <input
                type="text"
                placeholder="Поиск по основанию…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="category-select-wrap">
              <Filter size={14} />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="points-list detailed">
          {filteredPoints.length > 0 ? (
            filteredPoints.map((p) => <PointRow key={p.id} point={p} detailed />)
          ) : (
            <Empty
              title="Записи не найдены"
              text="По выбранным фильтрам пока нет начислений в реестре."
            />
          )}
        </div>
      </div>
    </Page>
  );
}
