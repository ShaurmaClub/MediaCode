import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Save, CalendarDays, PlusCircle, Trash2, AlertCircle } from 'lucide-react';
import { api } from '../api.js';
import { Page, Loader } from '../components/UI.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { EVENT_CATEGORIES, STANDARD_EVENT_ROLES, MAX_POINTS_PER_TRANSACTION } from '../config/eventCategories.js';
import { DEPARTMENTS } from '../config/departments.js';

const PRIORITIES = [
  { id: 'LOW', label: 'Низкий' },
  { id: 'NORMAL', label: 'Обычный' },
  { id: 'HIGH', label: 'Высокий' },
  { id: 'URGENT', label: 'Срочный' }
];

const STATUSES = [
  { id: 'OPEN', label: 'Открыто для заявок' },
  { id: 'DRAFT', label: 'Черновик (скрыто от медиаволонтёров)' },
  { id: 'ASSIGNMENT_IN_PROGRESS', label: 'В работе (медиаволонтёры набраны)' },
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

  // Form State
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: EVENT_CATEGORIES[0] || 'Съёмка и фоторепортаж',
    custom_category: '',
    event_date: '',
    start_time: '',
    end_time: '',
    location_type: 'department', // 'department' | 'custom'
    location_dept: DEPARTMENTS[0] || '',
    location_custom: '',
    required_volunteers: 1,
    skills: '',
    points: 20,
    priority: 'NORMAL',
    deadline: '',
    status: 'OPEN',
    equipment: '',
    notes: ''
  });

  // Roles needed builder: array of { id, name, count }
  const [rolesNeeded, setRolesNeeded] = useState([]);
  const [newRoleName, setNewRoleName] = useState(STANDARD_EVENT_ROLES[0] || '');
  const [newRoleCustom, setNewRoleCustom] = useState('');
  const [newRoleCount, setNewRoleCount] = useState(1);

  useEffect(() => {
    if (isEditing) {
      api(`/tasks/${id}`)
        .then((data) => {
          let parsedRoles = [];
          if (data.roles_needed) {
            try {
              parsedRoles = typeof data.roles_needed === 'string' ? JSON.parse(data.roles_needed) : data.roles_needed;
            } catch (e) {
              parsedRoles = [];
            }
          }
          if (Array.isArray(parsedRoles) && parsedRoles.length > 0) {
            setRolesNeeded(parsedRoles);
          }

          const isDept = DEPARTMENTS.includes(data.location);

          setForm({
            title: data.title || '',
            description: data.description || '',
            category: data.category || EVENT_CATEGORIES[0],
            custom_category: data.custom_category || '',
            event_date: data.event_date || '',
            start_time: data.start_time || '',
            end_time: data.end_time || '',
            location_type: data.location_type || (isDept ? 'department' : 'custom'),
            location_dept: isDept ? data.location : (DEPARTMENTS[0] || ''),
            location_custom: !isDept ? (data.location || '') : '',
            required_volunteers: data.required_volunteers || 1,
            skills: data.skills || '',
            points: Math.min(MAX_POINTS_PER_TRANSACTION, data.points || 0),
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

  // Add role to builder
  const handleAddRole = (e) => {
    e.preventDefault();
    const finalName = newRoleName === 'Другая роль' ? newRoleCustom.trim() : newRoleName;
    if (!finalName) {
      toast.error('Укажите название позиции');
      return;
    }
    const count = Math.max(1, parseInt(newRoleCount, 10) || 1);

    const updated = [...rolesNeeded, { id: Date.now(), name: finalName, count }];
    setRolesNeeded(updated);

    // Auto-update total required volunteers
    const totalCount = updated.reduce((sum, r) => sum + r.count, 0);
    setForm((prev) => ({ ...prev, required_volunteers: totalCount }));

    if (newRoleName === 'Другая роль') {
      setNewRoleCustom('');
      setNewRoleName(STANDARD_EVENT_ROLES[0]);
    }
    setNewRoleCount(1);
  };

  const handleRemoveRole = (roleId) => {
    const updated = rolesNeeded.filter((r) => r.id !== roleId);
    setRolesNeeded(updated);
    if (updated.length > 0) {
      const totalCount = updated.reduce((sum, r) => sum + r.count, 0);
      setForm((prev) => ({ ...prev, required_volunteers: totalCount }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.event_date) {
      toast.error('Пожалуйста, укажите название мероприятия и дату проведения.');
      return;
    }

    if (form.start_time && form.end_time && form.end_time < form.start_time) {
      toast.error('Время окончания не может быть раньше времени начала');
      return;
    }

    const numPoints = parseInt(form.points, 10) || 0;
    if (numPoints > MAX_POINTS_PER_TRANSACTION) {
      toast.error(`Количество баллов за мероприятие не может превышать ${MAX_POINTS_PER_TRANSACTION}`);
      return;
    }

    const finalLocation = form.location_type === 'department' ? form.location_dept : form.location_custom.trim();
    if (!finalLocation) {
      toast.error('Укажите место проведения мероприятия');
      return;
    }

    const payload = {
      ...form,
      points: Math.min(MAX_POINTS_PER_TRANSACTION, Math.max(0, numPoints)),
      location: finalLocation,
      custom_category: form.category === 'Другое' ? form.custom_category.trim() : null,
      roles_needed: rolesNeeded.length > 0 ? rolesNeeded : null
    };

    setSaving(true);
    try {
      if (isEditing) {
        await api(`/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        toast.success('Мероприятие успешно обновлено!');
        navigate(`/tasks/${id}`);
      } else {
        const res = await api('/tasks', {
          method: 'POST',
          body: JSON.stringify(payload)
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
          ? 'Обновите параметры события, дату проведения или позиции для медиаволонтёров.'
          : 'Заполните параметры события для привлечения медиаволонтёров медиацентра.'
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
                {EVENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Требуется медиаволонтёров *</label>
              <input
                type="number"
                min="1"
                required
                value={form.required_volunteers}
                onChange={(e) => setForm({ ...form, required_volunteers: parseInt(e.target.value, 10) || 1 })}
              />
            </div>

            <div className="form-group">
              <label>
                <span>Награда (баллов) *</span>
                <span className="field-hint" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  макс. {MAX_POINTS_PER_TRANSACTION}
                </span>
              </label>
              <input
                type="number"
                min="0"
                max={MAX_POINTS_PER_TRANSACTION}
                required
                value={form.points}
                onChange={(e) => setForm({ ...form, points: Math.min(MAX_POINTS_PER_TRANSACTION, parseInt(e.target.value, 10) || 0) })}
              />
            </div>
          </div>

          {/* If Category is "Другое", show custom category text input */}
          {form.category === 'Другое' && (
            <div className="form-group" style={{ marginTop: '-4px', marginBottom: '16px' }}>
              <label>Укажите своё название категории *</label>
              <input
                type="text"
                required
                placeholder="Например: Мастер-класс по свету"
                value={form.custom_category}
                onChange={(e) => setForm({ ...form, custom_category: e.target.value })}
              />
            </div>
          )}

          {/* Date & Time */}
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

          {/* Location Selector: College Department vs Custom */}
          <div className="form-group">
            <label style={{ marginBottom: '8px', display: 'block' }}>Место проведения (локация) *</label>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                <input
                  type="radio"
                  name="location_type"
                  value="department"
                  checked={form.location_type === 'department'}
                  onChange={() => setForm({ ...form, location_type: 'department' })}
                />
                <span>Учебное отделение колледжа</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                <input
                  type="radio"
                  name="location_type"
                  value="custom"
                  checked={form.location_type === 'custom'}
                  onChange={() => setForm({ ...form, location_type: 'custom' })}
                />
                <span>Другая площадка / Своя локация</span>
              </label>
            </div>

            {form.location_type === 'department' ? (
              <select
                value={form.location_dept}
                onChange={(e) => setForm({ ...form, location_dept: e.target.value })}
              >
                {DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                required={form.location_type === 'custom'}
                placeholder="например: ВДНХ, Павильон 57 или Медиалаборатория 304…"
                value={form.location_custom}
                onChange={(e) => setForm({ ...form, location_custom: e.target.value })}
              />
            )}
          </div>

          <div className="form-group">
            <label>Описание и задачи для медиаволонтёров</label>
            <textarea
              rows="3"
              placeholder="Опишите суть события, формат съёмки или материалы, которые необходимо подготовить…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>

        {/* Roles Needed Positions Builder */}
        <div className="form-section">
          <h3>2. Требуемые роли и позиции медиаволонтёров</h3>
          <p className="muted" style={{ fontSize: '13px', marginTop: '-6px', marginBottom: '14px' }}>
            Вы можете указать конкретные позиции (например: 2 фотографа, 1 видеограф, 1 СММ), чтобы медиаволонтёры откликались на нужную роль.
          </p>

          {rolesNeeded.length > 0 && (
            <div className="roles-list-table" style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {rolesNeeded.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'var(--surface2)',
                      padding: '8px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span className="badge badge-primary">{r.name}</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        Количество: <strong>{r.count} чел.</strong>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn tiny ghost"
                      onClick={() => handleRemoveRole(r.id)}
                      title="Удалить позицию"
                    >
                      <Trash2 size={14} className="text-danger" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add role sub-form */}
          <div
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              background: 'var(--surface)',
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px dashed var(--border)'
            }}
          >
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ fontSize: '12px', marginBottom: '4px', display: 'block' }}>Позиция / Роль</label>
              <select
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
              >
                {STANDARD_EVENT_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
                <option value="Другая роль">Другая роль…</option>
              </select>
            </div>

            {newRoleName === 'Другая роль' && (
              <div style={{ flex: '1 1 180px' }}>
                <label style={{ fontSize: '12px', marginBottom: '4px', display: 'block' }}>Своё название роли</label>
                <input
                  type="text"
                  placeholder="Название роли"
                  value={newRoleCustom}
                  onChange={(e) => setNewRoleCustom(e.target.value)}
                />
              </div>
            )}

            <div style={{ width: '90px' }}>
              <label style={{ fontSize: '12px', marginBottom: '4px', display: 'block' }}>Человек</label>
              <input
                type="number"
                min="1"
                max="20"
                value={newRoleCount}
                onChange={(e) => setNewRoleCount(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="btn secondary"
              onClick={handleAddRole}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '40px' }}
            >
              <PlusCircle size={15} /> Добавить роль
            </button>
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
                  placeholder="Особые инструкции для медиаволонтёров, дресс-код, ссылки на чат…"
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
