import React, { useState, useEffect } from 'react';
import {
  Shield,
  Plus,
  Edit,
  Key,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  UserPlus,
  Lock,
  Copy,
  Check,
  Sparkles
} from 'lucide-react';
import { api } from '../api.js';
import { Page, Loader, Empty, Avatar } from '../components/UI.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../context/ToastContext.jsx';

const ROLE_LABELS = {
  ADMIN: 'Администратор',
  STAFF: 'Сотрудник',
  STUDENT: 'Медиаволонтёр'
};

export default function AdminUsers({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const toast = useToast();

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [passwordModalUser, setPasswordModalUser] = useState(null);
  const [createdCredentialsNotice, setCreatedCredentialsNotice] = useState(null);
  const [copiedField, setCopiedField] = useState(null);

  // Forms
  const [createForm, setCreateForm] = useState({
    login: '',
    generate_password: true,
    password: '',
    role: 'STUDENT',
    first_name: '',
    last_name: '',
    email: '',
    group_name: '',
    year: 1,
    skills: '',
    bio: '',
    phone: '',
    max_contact: ''
  });

  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (search.trim()) query.set('search', search.trim());
      if (roleFilter !== 'ALL') query.set('role', roleFilter);
      if (statusFilter !== 'ALL') query.set('status', statusFilter);

      const res = await api(`/users?${query.toString()}`);
      setUsers(res);
    } catch (err) {
      toast.error('Не удалось загрузить пользователей: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [roleFilter, statusFilter]);

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api('/users', {
        method: 'POST',
        body: JSON.stringify(createForm)
      });
      toast.success(`Пользователь «${res.login || createForm.login}» успешно создан!`);
      setCreateModalOpen(false);
      setCreatedCredentialsNotice({
        title: 'Учётная запись успешно создана',
        subtitle: `Пользователь ${createForm.first_name || ''} ${createForm.last_name || ''} зарегистрирован. Сохраните временные данные для входа:`,
        login: res.login || createForm.login,
        temporaryPassword: res.temporaryPassword
      });
      setCreateForm({
        login: '',
        generate_password: true,
        password: '',
        role: 'STUDENT',
        first_name: '',
        last_name: '',
        email: '',
        group_name: '',
        year: 1,
        skills: '',
        bio: '',
        phone: '',
        max_contact: ''
      });
      loadUsers();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editUser) return;
    setBusy(true);
    try {
      await api(`/users/${editUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editUser)
      });
      toast.success('Данные пользователя обновлены!');
      setEditUser(null);
      loadUsers();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleStatus = async (targetUser) => {
    const nextStatus = targetUser.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const msg =
      nextStatus === 'INACTIVE'
        ? `Деактивировать аккаунт ${targetUser.login}? Пользователь не сможет войти в систему.`
        : `Активировать аккаунт ${targetUser.login}?`;

    if (!window.confirm(msg)) return;

    try {
      await api(`/users/${targetUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus })
      });
      toast.success(`Статус аккаунта ${targetUser.login} изменён на ${nextStatus}`);
      loadUsers();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleResetPasswordSubmit = async (e, forceGenerate = false) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!passwordModalUser) return;
    setBusy(true);
    try {
      const body = forceGenerate || !newPassword ? { generate: true } : { newPassword };
      const res = await api(`/users/${passwordModalUser.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast.success(`Пароль для @${passwordModalUser.login} сброшен!`);
      const targetLogin = passwordModalUser.login;
      setPasswordModalUser(null);
      setNewPassword('');
      setCreatedCredentialsNotice({
        title: 'Временный пароль установлен',
        subtitle: `Новые учётные данные для пользователя @${targetLogin}. При входе потребуется сменить пароль:`,
        login: targetLogin,
        temporaryPassword: res.temporaryPassword
      });
      loadUsers();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Управление пользователями"
      subtitle="Администрирование учётных записей, распределение ролей и контроль статуса доступа."
      actions={
        <button className="btn primary" onClick={() => setCreateModalOpen(true)}>
          <UserPlus size={16} /> Создать пользователя
        </button>
      }
    >
      {/* Search & Filter Toolbar */}
      <div className="toolbar">
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault();
            loadUsers();
          }}
        >
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Поиск по логину, имени, группе…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn tiny primary">
            Найти
          </button>
        </form>

        <div className="toolbar-filters">
          <div className="category-select-wrap">
            <Filter size={14} />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="ALL">Все роли</option>
              <option value="STUDENT">Медиаволонтёры</option>
              <option value="STAFF">Кураторы и сотрудники</option>
              <option value="ADMIN">Администраторы</option>
            </select>
          </div>

          <div className="category-select-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">Все статусы</option>
              <option value="ACTIVE">Только активные</option>
              <option value="INACTIVE">Деактивированные</option>
            </select>
          </div>
        </div>
      </div>

      {/* Users Data Table */}
      <div className="panel table-wrap">
        <div className="section-head">
          <h2>Пользователи системы</h2>
          <span className="muted">Всего: {users.length}</span>
        </div>

        {loading ? (
          <Loader text="Загружаем список учётных записей…" />
        ) : users.length > 0 ? (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Роль</th>
                  <th>Группа / Курс</th>
                  <th>Статус</th>
                  <th>Баллы</th>
                  <th style={{ textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="table-user-cell">
                        <Avatar firstName={u.first_name} lastName={u.last_name} size="small" />
                        <div>
                          <b>
                            {u.first_name} {u.last_name}
                          </b>
                          <small className="muted">@{u.login} {u.email ? `· ${u.email}` : ''}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`role-chip role-${u.role.toLowerCase()}`}>{ROLE_LABELS[u.role] || u.role}</span>
                    </td>
                    <td>
                      <span>{u.group_name || '—'}</span>
                      {u.year && <small className="muted"> · {u.year} курс</small>}
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          u.status === 'ACTIVE' ? 'status-active' : 'status-inactive'
                        }`}
                      >
                        {u.status === 'ACTIVE' ? 'Активен' : 'Заблокирован'}
                      </span>
                    </td>
                    <td>
                      <b>{u.totalPoints || 0} баллов</b>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="table-actions">
                        <button
                          className="btn tiny ghost"
                          title="Редактировать профиль"
                          onClick={() => setEditUser({ ...u })}
                        >
                          <Edit size={13} />
                        </button>
                        <button
                          className="btn tiny ghost"
                          title="Сбросить пароль"
                          onClick={() => {
                            setPasswordModalUser(u);
                            setNewPassword('Demo123!');
                          }}
                        >
                          <Key size={13} />
                        </button>
                        <button
                          className={`btn tiny ${u.status === 'ACTIVE' ? 'danger-ghost' : 'success-ghost'}`}
                          title={u.status === 'ACTIVE' ? 'Деактивировать' : 'Активировать'}
                          onClick={() => handleToggleStatus(u)}
                        >
                          {u.status === 'ACTIVE' ? <XCircle size={13} /> : <CheckCircle size={13} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Пользователи не найдены" text="Попробуйте изменить параметры поиска." />
        )}
      </div>

      {/* CREATE USER MODAL */}
      {createModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setCreateModalOpen(false)}
          title="Создание нового пользователя"
          maxWidth="640px"
        >
          <form onSubmit={handleCreateSubmit} className="modal-form">
            <div className="form-group">
              <label>Логин *</label>
              <input
                type="text"
                required
                placeholder="ivan_petrov"
                value={createForm.login}
                onChange={(e) => setCreateForm({ ...createForm, login: e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, '') })}
              />
            </div>

            <div className="form-group" style={{ background: 'var(--surface2)', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: '14px' }}>
              <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                <input
                  type="checkbox"
                  checked={createForm.generate_password}
                  onChange={(e) => setCreateForm({ ...createForm, generate_password: e.target.checked })}
                />
                <span style={{ fontWeight: 600, fontSize: '13px' }}>Сгенерировать надёжный временный пароль автоматически</span>
              </label>
              <small className="muted" style={{ display: 'block', marginTop: '4px', fontSize: '11.5px' }}>
                Пароль будет показан вам в отдельном окне после создания для копирования и передачи пользователю.
              </small>

              {!createForm.generate_password && (
                <div style={{ marginTop: '10px' }}>
                  <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>Пароль вручную *</label>
                  <input
                    type="password"
                    required={!createForm.generate_password}
                    placeholder="Минимум 6 знаков"
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label>Роль в системе</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                >
                  <option value="STUDENT">Медиаволонтёр</option>
                  <option value="STAFF">Куратор / Сотрудник</option>
                  <option value="ADMIN">Администратор</option>
                </select>
              </div>

              <div className="form-group">
                <label>Имя</label>
                <input
                  type="text"
                  value={createForm.first_name}
                  onChange={(e) => setCreateForm({ ...createForm, first_name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Фамилия</label>
                <input
                  type="text"
                  value={createForm.last_name}
                  onChange={(e) => setCreateForm({ ...createForm, last_name: e.target.value })}
                />
              </div>
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Группа</label>
                <input
                  type="text"
                  placeholder="Например: ИБС111"
                  value={createForm.group_name}
                  onChange={(e) => setCreateForm({ ...createForm, group_name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Курс</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={createForm.year}
                  onChange={(e) => setCreateForm({ ...createForm, year: parseInt(e.target.value, 10) || 1 })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Навыки (через запятую)</label>
              <input
                type="text"
                placeholder="Фотография, Видеомонтаж, СММ, Копирайтинг"
                value={createForm.skills}
                onChange={(e) => setCreateForm({ ...createForm, skills: e.target.value })}
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Телефон</label>
                <input
                  type="tel"
                  placeholder="+7 (999) 000-00-00"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Контакт в мессенджере Макс</label>
                <input
                  type="text"
                  placeholder="@ник или телефон в Макс"
                  value={createForm.max_contact}
                  onChange={(e) => setCreateForm({ ...createForm, max_contact: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Краткая биография / Описание</label>
              <textarea
                rows="2"
                value={createForm.bio}
                onChange={(e) => setCreateForm({ ...createForm, bio: e.target.value })}
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setCreateModalOpen(false)}
              >
                Отмена
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Создаём…' : 'Создать аккаунт'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* EDIT USER MODAL */}
      {editUser && (
        <Modal
          isOpen={true}
          onClose={() => setEditUser(null)}
          title={`Редактирование: ${editUser.first_name} ${editUser.last_name} (@${editUser.login})`}
          maxWidth="640px"
        >
          <form onSubmit={handleEditSubmit} className="modal-form">
            <div className="form-grid-2">
              <div className="form-group">
                <label>Роль</label>
                <select
                  value={editUser.role}
                  onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}
                >
                  <option value="STUDENT">Медиаволонтёр</option>
                  <option value="STAFF">Куратор / Сотрудник</option>
                  <option value="ADMIN">Администратор</option>
                </select>
              </div>

              <div className="form-group">
                <label>Статус аккаунта</label>
                <select
                  value={editUser.status}
                  onChange={(e) => setEditUser({ ...editUser, status: e.target.value })}
                >
                  <option value="ACTIVE">Активен</option>
                  <option value="INACTIVE">Деактивирован</option>
                </select>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Имя</label>
                <input
                  type="text"
                  value={editUser.first_name || ''}
                  onChange={(e) => setEditUser({ ...editUser, first_name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Фамилия</label>
                <input
                  type="text"
                  value={editUser.last_name || ''}
                  onChange={(e) => setEditUser({ ...editUser, last_name: e.target.value })}
                />
              </div>
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={editUser.email || ''}
                  onChange={(e) => setEditUser({ ...editUser, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Группа</label>
                <input
                  type="text"
                  placeholder="Например: ИБС111"
                  value={editUser.group_name || ''}
                  onChange={(e) => setEditUser({ ...editUser, group_name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Курс</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={editUser.year || 1}
                  onChange={(e) => setEditUser({ ...editUser, year: parseInt(e.target.value, 10) || null })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Навыки</label>
              <input
                type="text"
                value={editUser.skills || ''}
                onChange={(e) => setEditUser({ ...editUser, skills: e.target.value })}
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Телефон</label>
                <input
                  type="tel"
                  placeholder="+7 (999) 000-00-00"
                  value={editUser.phone || ''}
                  onChange={(e) => setEditUser({ ...editUser, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Контакт в мессенджере Макс</label>
                <input
                  type="text"
                  placeholder="@ник или телефон в Макс"
                  value={editUser.max_contact || ''}
                  onChange={(e) => setEditUser({ ...editUser, max_contact: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>О себе / Биография</label>
              <textarea
                rows="2"
                value={editUser.bio || ''}
                onChange={(e) => setEditUser({ ...editUser, bio: e.target.value })}
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setEditUser(null)}
              >
                Отмена
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Сохраняем…' : 'Сохранить изменения'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* RESET PASSWORD MODAL */}
      {passwordModalUser && (
        <Modal
          isOpen={true}
          onClose={() => setPasswordModalUser(null)}
          title={`Сброс пароля: @${passwordModalUser.login}`}
        >
          <form onSubmit={(e) => handleResetPasswordSubmit(e, false)} className="modal-form">
            <p className="muted" style={{ fontSize: '13px', lineHeight: 1.5 }}>
              Сброс пароля для <b>{passwordModalUser.first_name} {passwordModalUser.last_name}</b> (@{passwordModalUser.login}). Вы можете сгенерировать временный пароль автоматически или задать его вручную.
            </p>

            <div className="form-group" style={{ marginTop: '12px' }}>
              <label>Пароль вручную (или оставьте пустым для автогенерации)</label>
              <input
                type="text"
                placeholder="Минимум 6 символов или оставьте пустым"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setPasswordModalUser(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => handleResetPasswordSubmit(null, true)}
                disabled={busy}
              >
                <Sparkles size={15} /> Сгенерировать пароль
              </button>
              {newPassword && (
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Сохраняем…' : 'Установить пароль'}
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {/* ONE-TIME CREDENTIALS NOTICE MODAL */}
      {createdCredentialsNotice && (
        <Modal
          isOpen={true}
          onClose={() => setCreatedCredentialsNotice(null)}
          title={createdCredentialsNotice.title}
          maxWidth="500px"
        >
          <div style={{ padding: '4px 0' }}>
            <p className="muted" style={{ fontSize: '13px', lineHeight: 1.5, marginBottom: '16px' }}>
              {createdCredentialsNotice.subtitle}
            </p>

            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <span className="muted" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Логин пользователя</span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                  <code style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {createdCredentialsNotice.login}
                  </code>
                  <button
                    type="button"
                    className="btn tiny secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(createdCredentialsNotice.login);
                      setCopiedField('login');
                      setTimeout(() => setCopiedField(null), 2000);
                    }}
                  >
                    {copiedField === 'login' ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                    <span>{copiedField === 'login' ? 'Скопировано' : 'Копировать'}</span>
                  </button>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                <span className="muted" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Временный пароль (показывается разово)</span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                  <code style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--accent)' }}>
                    {createdCredentialsNotice.temporaryPassword}
                  </code>
                  <button
                    type="button"
                    className="btn tiny secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(createdCredentialsNotice.temporaryPassword);
                      setCopiedField('password');
                      setTimeout(() => setCopiedField(null), 2000);
                    }}
                  >
                    {copiedField === 'password' ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                    <span>{copiedField === 'password' ? 'Скопировано' : 'Копировать'}</span>
                  </button>
                </div>
              </div>
            </div>

            <p className="muted" style={{ fontSize: '12px', marginTop: '14px', lineHeight: 1.4 }}>
              ✦ Пользователь обязан сменить этот временный пароль при первом входе в систему.
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '18px' }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  const text = `Логин: ${createdCredentialsNotice.login}\nВременный пароль: ${createdCredentialsNotice.temporaryPassword}`;
                  navigator.clipboard.writeText(text);
                  setCopiedField('all');
                  setTimeout(() => setCopiedField(null), 2000);
                }}
              >
                {copiedField === 'all' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                <span>{copiedField === 'all' ? 'Все данные скопированы' : 'Скопировать всё'}</span>
              </button>

              <button
                type="button"
                className="btn primary"
                onClick={() => setCreatedCredentialsNotice(null)}
              >
                Понятно, закрыть
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
