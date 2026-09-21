import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Save, CalendarDays, PlusCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../api.js';
import { Page, Loader } from '../components/UI.jsx';
import { useToast } from '../context/ToastContext.jsx';

const CATEGORIES = [
  'Событие',
  'Монтаж',
  'Фотография',
  'SMM',
  'Дизайн',
  'Стрим',
  'Интервью',
  'Другое'
];

const PRIORITIES = [
  { id: 'LOW', label: 'Низкий' },
  { id: 'NORMAL', label: 'Обычный' },
  { id: 'HIGH', label: 'Высокий' },
  { id: 'URGENT', label: 'Срочный' }
];

const STATUSES = [
  { id: 'OPEN', label: 'Открыто для заявок' },
  { id: 'DRAFT', label: 'Черновик (скрыто от волонтёров)' },
  { id: 'ASSIGNMENT_IN_PROGRESS', label: 'В работе (волонтёры набраны)' },
  { id: 'COMPLETED', label: 'Завершено' },
  { id: 'CANCELLED', label: 'Отменено' },
  { id: 'ARCHIVED', label: 'В архиве' }
];

export default function TaskForm({ user }) {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Событие',
    event_date: '',
    start_time: '',
    end_time: '',
    location: '',
    required_volunteers: 1,
    skills: '',
    points: 20,
    priority: 'NORMAL',
    deadline: '',
    status: 'OPEN',
    equipment: '',
    notes: ''
  });

  useEffect(() => {
    if (isEditing) {
      api(`/tasks/${id}`)
        .then((data) => {
          setForm({
            title: data.title || '',
            description: data.description || '',
            category: data.category || 'Событие',
            event_date: data.event_date || '',
            start_time: data.start_time || '',
            end_time: data.end_time || '',
            location: data.location || '',
            required_volunteers: data.required_volunteers || 1,
            skills: data.skills || '',
            points: data.points || 0,
            priority: data.priority || 'NORMAL',
            deadline: data.deadline || '',
            status: data.status || 'OPEN',
            equipment: data.equipment || '',
            notes: data.notes || ''
          });
          if (data.skills || data.equipment || data.notes || data.deadline || data.priority !== 'NORMAL' || data.status !== 'OPEN') {
            setShowAdvanced(true);
          }
        })
        .catch((err) => toast.error(err.message))
        .finally(() => setLoading(false));
    }
  }, [id, isEditing]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.event_date) {
      toast.error('Пожалуйста, укажите название мероприятия и дату проведения.');
      return;
    }

    setSaving(true);
    try {
      if (isEditing) {
        await api(`/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(form)
        });
        toast.success('Мероприятие успешно обновлено!');
        navigate(`/tasks/${id}`);
      } else {
        const res = await api('/tasks', {
          method: 'POST',
          body: JSON.stringify(form)
        });
        toast.success('Новое мероприятие успешно создано!');
        navigate(`/tasks/${res.id}`);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader text="Загружаем параметры мероприятия…" />;

  return (
    <Page
      title={isEditing ? 'Редактирование мероприятия' : 'Создание мероприятия'}
      subtitle={
        isEditing
          ? 'Обновите параметры события, дату проведения или требования к волонтёрам.'
          : 'Заполните основные параметры события для привлечения волонтёров медиацентра.'
      }
      actions={
        <Link to={isEditing ? `/tasks/${id}` : '/tasks'} className="btn ghost">
          <ArrowLeft size={16} /> Назад
        </Link>
      }
    >
      <form className="task-form-panel panel" onSubmit={handleSubmit}>
        {/* Primary Essential Section */}
        <div className="form-section">
          <h3>1. Основные параметры</h3>

          <div className="form-group">
            <label>Название мероприятия *</label>
            <input
              type="text"
              required
              placeholder="Например: Фоторепортаж со Дня студента"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="form-grid-3">
            <div className="form-group">
              <label>Категория</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Требуется волонтёров *</label>
              <input
                type="number"
                min="1"
                required
                value={form.required_volunteers}
                onChange={(e) => setForm({ ...form, required_volunteers: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Награда (баллов) *</label>
              <input
                type="number"
                min="0"
                required
                value={form.points}
                onChange={(e) => setForm({ ...form, points: e.target.value })}
              />
            </div>
          </div>

          {/* Date, Time, Location */}
          <div className="form-grid-3">
            <div className="form-group">
              <label>Дата проведения *</label>
              <input
                type="date"
                required
                value={form.event_date}
                onChange={(e) => setForm({ ...form, event_date: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Время начала</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Время окончания</label>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Место проведения (локация)</label>
            <input
              type="text"
              placeholder="например, Главный корпус, Актовый зал, Медиалаборатория…"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Описание и задачи для волонтёров</label>
            <textarea
              rows="3"
              placeholder="Опишите суть события, формат съёмки или материалы, которые необходимо подготовить…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>

        {/* Progressive Disclosure Section: Collapsible Advanced Settings */}
        <div className="advanced-accordion">
          <button
            type="button"
            className="advanced-toggle-btn"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span>
              {showAdvanced ? '▼' : '►'} Дополнительные параметры (приоритет, дедлайн, навыки, оборудование)
            </span>
            <small className="muted">{showAdvanced ? 'Скрыть' : 'Настроить'}</small>
          </button>

          {showAdvanced && (
            <div className="advanced-fields-box">
              <div className="form-grid-3">
                <div className="form-group">
                  <label>Приоритет мероприятия</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Дедлайн приёма заявок</label>
                  <input
                    type="date"
                    value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Статус мероприятия</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUSES.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Требуемые навыки (через запятую)</label>
                <input
                  type="text"
                  placeholder="например: Фотография, Свет, Lightroom, Репортаж"
                  value={form.skills}
                  onChange={(e) => setForm({ ...form, skills: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Необходимое оборудование</label>
                <input
                  type="text"
                  placeholder="например: Камера Sony A7, объектив 50mm, радиомикрофон Boya…"
                  value={form.equipment}
                  onChange={(e) => setForm({ ...form, equipment: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Внутренние примечания и контакты куратора</label>
                <textarea
                  rows="2"
                  placeholder="Особые инструкции для волонтёров, дресс-код, ссылки на чат…"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
          )}
        </div>

        {/* Form Actions */}
        <div className="form-actions-bottom">
          <Link to={isEditing ? `/tasks/${id}` : '/tasks'} className="btn ghost">
            Отмена
          </Link>
          <button type="submit" className="btn primary" disabled={saving}>
            <Save size={16} /> {saving ? 'Сохраняем…' : isEditing ? 'Сохранить изменения' : 'Опубликовать мероприятие'}
          </button>
        </div>
      </form>
    </Page>
  );
}
