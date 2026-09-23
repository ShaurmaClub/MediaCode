import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Award, BookOpen, Filter, Search, CheckCircle2, Calendar, AlertTriangle } from 'lucide-react';
import { api } from '../api.js';
import { Page, Loader, Empty, PointRow } from '../components/UI.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../context/ToastContext.jsx';

const CATEGORIES = [
  { id: 'ALL', label: 'Все категории' },
  { id: 'COMPLETION', label: 'Задания' },
  { id: 'EVENT', label: 'События' },
  { id: 'PHOTO_VIDEO', label: 'Фото и видео' },
  { id: 'SMM', label: 'СММ и Дизайн' },
  { id: 'BONUS', label: 'Бонусы' },
  { id: 'CORRECTION', label: 'Корректировки' },
  { id: 'OTHER', label: 'Прочее' }
];

export default function RecordBook({ user }) {
  const [searchParams] = useSearchParams();
  const targetStudentId = searchParams.get('userId');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();

  // Reversal modal state
  const [reversingPoint, setReversingPoint] = useState(null);
  const [reversalReason, setReversalReason] = useState('');
  const [busyReverse, setBusyReverse] = useState(false);

  const isStaffOrAdmin = user?.role === 'STAFF' || user?.role === 'ADMIN';

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

  const handleConfirmReverse = async (e) => {
    e.preventDefault();
    if (!reversingPoint) return;
    if (!reversalReason.trim()) {
      toast.error('Укажите причину отмены начисления');
      return;
    }

    setBusyReverse(true);
    try {
      await api(`/points/${reversingPoint.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reversalReason.trim() })
      });
      toast.success(`Начисление #${reversingPoint.id} (${reversingPoint.amount} баллов) успешно отменено`);
      setReversingPoint(null);
      setReversalReason('');
      loadRecordBook();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyReverse(false);
    }
  };

  if (loading || !data) return <Loader text="Загружаем зачётную книжку медиаволонтёра…" />;

  const filteredPoints = (data.points || []).filter((p) => {
    const matchesCategory = categoryFilter === 'ALL' || p.category === categoryFilter;
    const matchesSearch =
      !searchQuery.trim() ||
      p.reason.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.task_title && p.task_title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.issuer_name && p.issuer_name.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const completionCount = (data.points || []).filter((p) => p.category === 'COMPLETION' && p.is_reversed !== 1).length;
  const bonusCount = (data.points || []).filter((p) => p.category === 'BONUS' && p.is_reversed !== 1).length;

  return (
    <Page
      title={
        targetStudentId
          ? `Зачётная книжка: ${data.user.first_name} ${data.user.last_name}`
          : 'Электронная зачётная книжка медиаволонтёра'
      }
      subtitle="Официальный журнал начислений баллов медиацентра. Каждая запись защищена и неизменяема."
    >
      {/* Hero Record Book Card */}
      <div className="record-hero">
        <div className="record-hero-main">
          <span className="record-hero-eyebrow">ИТОГОВЫЙ БАЛАНС МЕДИАВОЛОНТЁРА</span>
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

      {/* История начислений */}
      <div className="panel">
        <div className="section-head">
          <div>
            <h2>История начислений</h2>
            <p className="muted">Полная история начислений с указанием сотрудника и даты.</p>
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
            filteredPoints.map((p) => (
              <PointRow
                key={p.id}
                point={p}
                detailed
                onReverse={user?.role === 'ADMIN' ? (point) => {
                  setReversingPoint(point);
                  setReversalReason('');
                } : null}
              />
            ))
          ) : (
            <Empty
              title="Записи не найдены"
              text="По выбранным фильтрам пока нет начислений в реестре."
            />
          )}
        </div>
      </div>

      {/* Point Reversal Modal for Staff / Admin */}
      {reversingPoint && (
        <Modal
          title="Отмена начисления баллов"
          onClose={() => setReversingPoint(null)}
        >
          <form onSubmit={handleConfirmReverse} style={{ padding: '4px 0' }}>
            <div style={{ display: 'flex', gap: '12px', background: 'var(--surface2)', padding: '14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', border: '1px solid var(--border)' }}>
              <AlertTriangle size={22} className="text-warning" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Внимание: отмена записи #{reversingPoint.id}</strong>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: '13px' }}>
                  Будет произведена отмена начисления <b>+{reversingPoint.amount} баллов</b> за: «{reversingPoint.reason}».
                  В зачётной книжке будет создана корректирующая запись со списанием баллов.
                </p>
              </div>
            </div>

            <div className="form-group">
              <label>Укажите причину отмены *</label>
              <textarea
                rows="3"
                required
                autoFocus
                placeholder="Например: ошибочное дублирование начисления сотрудником"
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setReversingPoint(null)}
                disabled={busyReverse}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn danger"
                disabled={busyReverse}
              >
                {busyReverse ? 'Отменяем…' : 'Подтвердить отмену начисления'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
