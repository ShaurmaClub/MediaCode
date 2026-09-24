import React, { useState } from 'react';
import { Palette, CheckCircle2, User, Lock, Save, Sparkles, MessageCircle, Eye, EyeOff } from 'lucide-react';
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
  const [showPwd1, setShowPwd1] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const [showPwd3, setShowPwd3] = useState(false);
  const [showPwd4, setShowPwd4] = useState(false);

  // Login change form
  const [loginForm, setLoginForm] = useState({
    newLogin: '',
    currentPassword: ''
  });
  const formatRussianPhone = (val) => {
    const digits = val.replace(/\D/g, '');
    let d = digits;
    if (d.startsWith('8')) d = '7' + d.slice(1);
    if (!d.startsWith('7') && d.length > 0) d = '7' + d;
    d = d.slice(0, 11);

    if (d.length <= 1) return '+7 (';
    if (d.length <= 4) return `+7 (${d.slice(1)}`;
    if (d.length <= 7) return `+7 (${d.slice(1, 4)}) ${d.slice(4)}`;
    if (d.length <= 9) return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  };

  const [savingLogin, setSavingLogin] = useState(false);

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

  const handleChangeLogin = async (e) => {
    e.preventDefault();
    if (!loginForm.newLogin.trim()) {
      toast.error('Укажите новый логин');
      return;
    }
    setSavingLogin(true);
    try {
      const res = await api('/auth/change-login', {
        method: 'POST',
        body: JSON.stringify({
          newLogin: loginForm.newLogin.trim(),
          currentPassword: loginForm.currentPassword
        })
      });
      setUser(res.user);
      toast.success(res.message || 'Логин успешно изменён!');
      setLoginForm({ newLogin: '', currentPassword: '' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingLogin(false);
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
      subtitle="Персонализация интерфейса, темы оформления, данные профиля и безопасность."
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
              <h3>{user.role === 'STUDENT' ? 'Профиль медиаволонтёра' : 'Данные профиля'}</h3>
              <p className="muted">
                Информация видна сотрудникам медиацентра при рассмотрении заявок на задания.
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
                  value={`${user.group_name || '—'} · ${user.role === 'ADMIN' ? 'Администратор' : user.role === 'STAFF' ? 'Сотрудник' : 'Медиаволонтёр'}`}
                  className="disabled-input"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Телефон для связи</label>
                <input
                  type="tel"
                  placeholder="+7 (___) ___-__-__"
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm({ ...profileForm, phone: formatRussianPhone(e.target.value) })}
                />
              </div>

              <div className="form-group">
                <label>Номер телефона, зарегистрированный в Макс</label>
                <input
                  type="tel"
                  placeholder="+7 (___) ___-__-__"
                  value={profileForm.max_contact}
                  onChange={(e) => setProfileForm({ ...profileForm, max_contact: formatRussianPhone(e.target.value) })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Мои навыки и специализация (через запятую)</label>
              <input
                type="text"
                placeholder="Фотография, Видеосъёмка, Монтаж Premiere, СММ, Графический дизайн…"
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
              <div style={{ position: 'relative' }}>
                <input
                  type={showPwd1 ? "text" : "password"}
                  required
                  placeholder="Введите ваш текущий пароль"
                  value={passForm.currentPassword}
                  onChange={(e) => setPassForm({ ...passForm, currentPassword: e.target.value })}
                  style={{ paddingRight: '40px' }}
                />
                <button type="button" onClick={() => setShowPwd1(!showPwd1)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>{showPwd1 ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label>Новый пароль (мин. 6 символов)</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPwd2 ? "text" : "password"}
                    required
                    placeholder="Новый пароль"
                    value={passForm.newPassword}
                    onChange={(e) => setPassForm({ ...passForm, newPassword: e.target.value })}
                    style={{ paddingRight: '40px' }}
                  />
                  <button type="button" onClick={() => setShowPwd2(!showPwd2)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>{showPwd2 ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </div>

              <div className="form-group">
                <label>Подтвердите новый пароль</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPwd3 ? "text" : "password"}
                    required
                    placeholder="Повторите новый пароль"
                    value={passForm.confirmPassword}
                    onChange={(e) => setPassForm({ ...passForm, confirmPassword: e.target.value })}
                    style={{ paddingRight: '40px' }}
                  />
                  <button type="button" onClick={() => setShowPwd3(!showPwd3)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>{showPwd3 ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </div>
            </div>

            <button type="submit" className="btn ghost" disabled={savingPass}>
              <Lock size={16} /> {savingPass ? 'Меняем пароль…' : 'Сменить пароль'}
            </button>
          </form>
        </div>

        {/* CHANGE LOGIN */}
        <div className="panel settings-card">
          <div className="settings-card-header">
            <div className="settings-icon-wrap"><User size={20} /></div>
            <div>
              <h3>Смена логина учётной записи</h3>
              <p className="muted">
                Текущий логин: <b>@{user.login}</b>. Для смены укажите новый уникальный логин и подтвердите текущим паролем.
              </p>
            </div>
          </div>

          <form onSubmit={handleChangeLogin} className="settings-form">
            <div className="form-grid-2">
              <div className="form-group">
                <label>Новый логин *</label>
                <input
                  type="text"
                  required
                  placeholder="ivan_petrov"
                  value={loginForm.newLogin}
                  onChange={(e) => setLoginForm({ ...loginForm, newLogin: e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, '') })}
                />
              </div>

              <div className="form-group">
                <label>Текущий пароль для подтверждения *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPwd4 ? "text" : "password"}
                    required
                    placeholder="Ваш текущий пароль"
                    value={loginForm.currentPassword}
                    onChange={(e) => setLoginForm({ ...loginForm, currentPassword: e.target.value })}
                    style={{ paddingRight: '40px' }}
                  />
                  <button type="button" onClick={() => setShowPwd4(!showPwd4)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>{showPwd4 ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </div>
            </div>

            <button type="submit" className="btn ghost" disabled={savingLogin}>
              <User size={16} /> {savingLogin ? 'Сохраняем…' : 'Обновить логин'}
            </button>
          </form>
        </div>
      </div>
    </Page>
  );
}

