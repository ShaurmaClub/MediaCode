import React, { useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { KeyRound, User, Lock, AlertCircle, CheckCircle2, ArrowRight, Eye, EyeOff } from 'lucide-react';

export default function FirstLogin({ user, onPasswordChanged, onLogout }) {
  const [login, setLogin] = useState(user.login || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd1, setShowPwd1] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();


  const handleLogout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
    if (onLogout) onLogout();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!login.trim()) {
      setError('Логин не может быть пустым');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setError('Новый пароль должен содержать не менее 6 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Введённые пароли не совпадают');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const res = await api('/auth/first-login-password-change', {
        method: 'POST',
        body: JSON.stringify({
          newPassword,
          newLogin: login.trim()
        })
      });
      toast.success('Учётная запись успешно настроена! Добро пожаловать!');
      onPasswordChanged(res.user);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-art">
        <div className="login-brand">
          <div className="login-brand-dual">
            <img src="/brand/kait20-white.png" alt="КАИТ20" className="login-brand-kait" />
            <div className="login-brand-divider" />
            <img src="/brand/mediacode.png" alt="МедиаКод" className="login-brand-mediacode" />
          </div>
          <span className="college-tag">Студенческий медиацентр</span>
        </div>

        <div className="login-quote">
          <h2>Первый вход в систему</h2>
          <p>
            Вы вошли по временным учётным данным. Для защиты вашей страницы и доступа ко всем возможностям «МедиаКод» задайте свой постоянный пароль и при желании обновите логин.
          </p>
        </div>

        <div className="art-orb art-orb-1" />
        <div className="art-orb art-orb-2" />
      </div>

      <div className="login-card-wrapper">
        <form className="login-card" onSubmit={handleSubmit} style={{ maxWidth: '460px' }}>
          <div className="login-card-header">
            <div className="eyebrow" style={{ color: 'var(--accent)' }}>БЕЗОПАСНОСТЬ</div>
            <h1>Настройте учётную запись</h1>
            <p className="muted">
              Здравствуйте, {user.first_name || 'медиаволонтёр'}! Установите постоянный пароль для входа в платформу.
            </p>
          </div>

          {error && (
            <div className="form-error-banner" style={{ marginBottom: '16px' }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label>
              <span>Ваш логин</span>
              <span className="field-hint" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Можно изменить</span>
            </label>
            <div className="input-with-icon">
              <User size={16} />
              <input
                type="text"
                required
                value={login}
                onChange={(e) => setLogin(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))}
                placeholder="Логин (латиница, цифры, _)"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Новый постоянный пароль *</label>
            <div className="input-with-icon" style={{ position: 'relative' }}>
              <Lock size={16} />
              <input
                type={showPwd1 ? "text" : "password"}
                required
                autoFocus
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Минимум 6 символов"
                style={{ paddingRight: '40px' }}
              />
              <button type="button" onClick={() => setShowPwd1(!showPwd1)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                {showPwd1 ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>Повторите новый пароль *</label>
            <div className="input-with-icon" style={{ position: 'relative' }}>
              <Lock size={16} />
              <input
                type={showPwd2 ? "text" : "password"}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Повторите пароль"
                style={{ paddingRight: '40px' }}
              />
              <button type="button" onClick={() => setShowPwd2(!showPwd2)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                {showPwd2 ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn primary wide"
            disabled={busy}
            style={{ marginTop: '12px' }}
          >
            {busy ? 'Сохранение данных…' : 'Сохранить и войти в систему'}
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
