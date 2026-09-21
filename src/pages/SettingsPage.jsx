import React, { useState } from 'react';
import { Palette, CheckCircle2, User, Lock, Save, Sparkles, MessageCircle } from 'lucide-react';
import { api, THEMES } from '../api.js';
import { Page } from '../components/UI.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function SettingsPage({ theme, setTheme, user, setUser }) {
  const toast = useToast();

  // Profile form
  const [profileForm, setProfileForm] = useState({
    bio: user.bio || '',
    skills: user.skills || '',
    phone: user.phone || '',
    max_contact: user.max_contact || ''
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form
  const [passForm, setPassForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [savingPass, setSavingPass] = useState(false);

  const handleSelectTheme = async (tId) => {
    setTheme(tId);
    try {
      await api('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ theme: tId })
      });
      toast.success(`Тема «${THEMES.find((t) => t.id === tId)?.name}» сохранена!`);
    } catch {
      // Local storage fallback already works
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await api('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(profileForm)
      });
      setUser(res.user);
      toast.success('Данные вашего профиля успешно обновлены!');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (passForm.newPassword !== passForm.confirmPassword) {
      toast.error('Новый пароль и подтверждение не совпадают');
      return;
    }
    if (passForm.newPassword.length < 6) {
      toast.error('Пароль должен быть не менее 6 символов');
      return;
    }

    setSavingPass(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passForm.currentPassword,
          newPassword: passForm.newPassword
        })
      });
      toast.success('Пароль успешно изменён!');
      setPassForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingPass(false);
    }
  };

  return (
    <Page
      title="Настройки аккаунта"
      subtitle="Персонализация интерфейса, темы оформления, данные профиля волонтёра и безопасность."
    >
      <div className="settings-container">
        {/* THEMES */}
        <div className="panel settings-card">
          <div className="settings-card-header">
            <div className="settings-icon-wrap"><Palette size={20} /></div>
            <div>
              <h3>Тема оформления</h3>
              <p className="muted">
                Выберите цветовую палитру интерфейса. Выбранная тема сохраняется в вашем профиле.
              </p>
            </div>
          </div>

          <div className="theme-grid">
            {THEMES.map((t) => {
              const isSelected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`theme-card ${isSelected ? 'chosen' : ''}`}
                  onClick={() => handleSelectTheme(t.id)}
                  data-theme-card={t.id}
                >
                  <div className={`theme-preview-box preview-${t.id}`}>
                    <div className="preview-bar sidebar-color" />
                    <div className="preview-body">
                      <div className="preview-line surface-color" />
                      <div className="preview-chip accent-color" />
                    </div>
                  </div>
                  <div className="theme-card-body">
                    <b>{t.name}</b>
                    <small className="muted">{t.desc}</small>
                  </div>
                  {isSelected && <CheckCircle2 size={18} className="theme-check-icon" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* PROFILE EDIT */}
        <div className="panel settings-card">
          <div className="settings-card-header">
            <div className="settings-icon-wrap"><User size={20} /></div>
            <div>
              <h3>Профиль волонтёра</h3>
              <p className="muted">
                Информация видна кураторам медиацентра при рассмотрении заявок на задания.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="settings-form">
            <div className="form-grid-2">
              <div className="form-group">
                <label>Имя и фамилия</label>
                <input
                  type="text"
                  disabled
                  value={`${user.first_name || ''} ${user.last_name || ''}`}
                  className="disabled-input"
                />
              </div>

              <div className="form-group">
                <label>Группа / Роль</label>
                <input
                  type="text"
                  disabled
                  value={`${user.group_name || '—'} · ${user.role === 'ADMIN' ? 'Администратор' : user.role === 'STAFF' ? 'Сотрудник' : 'Волонтёр'}`}
                  className="disabled-input"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Контактный телефон</label>
                <input
                  type="tel"
                  placeholder="+7 (999) 000-00-00"
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Контакт в мессенджере MAX</label>
                <input
                  type="text"
                  placeholder="@username или телефон в MAX"
                  value={profileForm.max_contact}
                  onChange={(e) => setProfileForm({ ...profileForm, max_contact: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Ваши медиа-навыки и специализация (через запятую)</label>
              <input
                type="text"
                placeholder="Фотография, Видеосъёмка, Монтаж Premiere, SMM, Дизайн Figma…"
                value={profileForm.skills}
                onChange={(e) => setProfileForm({ ...profileForm, skills: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>О себе / Опыт работы с медиа</label>
              <textarea
                rows="3"
                placeholder="Расскажите о своей технике, опыте съёмок, любимых жанрах…"
                value={profileForm.bio}
                onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
              />
            </div>

            <button type="submit" className="btn primary" disabled={savingProfile}>
              <Save size={16} /> {savingProfile ? 'Сохраняем…' : 'Сохранить профиль'}
            </button>
          </form>
        </div>

        {/* CHANGE PASSWORD */}
        <div className="panel settings-card">
          <div className="settings-card-header">
            <div className="settings-icon-wrap"><Lock size={20} /></div>
            <div>
              <h3>Безопасность и пароль</h3>
              <p className="muted">Смените пароль для защиты вашего аккаунта.</p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="settings-form">
            <div className="form-group">
              <label>Текущий пароль</label>
              <input
                type="password"
                required
                placeholder="Введите ваш текущий пароль"
                value={passForm.currentPassword}
                onChange={(e) => setPassForm({ ...passForm, currentPassword: e.target.value })}
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Новый пароль (мин. 6 символов)</label>
                <input
                  type="password"
                  required
                  placeholder="Новый пароль"
                  value={passForm.newPassword}
                  onChange={(e) => setPassForm({ ...passForm, newPassword: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Подтвердите новый пароль</label>
                <input
                  type="password"
                  required
                  placeholder="Повторите новый пароль"
                  value={passForm.confirmPassword}
                  onChange={(e) => setPassForm({ ...passForm, confirmPassword: e.target.value })}
                />
              </div>
            </div>

            <button type="submit" className="btn ghost" disabled={savingPass}>
              <Lock size={16} /> {savingPass ? 'Меняем пароль…' : 'Сменить пароль'}
            </button>
          </form>
        </div>
      </div>
    </Page>
  );
}
