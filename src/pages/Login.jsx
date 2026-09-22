import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { Sparkles, ArrowRight, Shield, Camera, KeyRound, HelpCircle, X, Check } from 'lucide-react';
import Modal from '../components/Modal.jsx';

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ login: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetContact, setResetContact] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSuccess, setResetSuccess] = useState('');
  const toast = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.login || !form.password) {
      setError('Заполните логин и пароль');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      toast.success(`С возвращением, ${data.user.first_name}!`);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestReset = async (e) => {
    e.preventDefault();
    if (!resetContact.trim()) {
      toast.error('Укажите ваш логин, телефон или контакт в Макс');
      return;
    }

    setResetBusy(true);
    try {
      const res = await api('/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ loginOrContact: resetContact.trim() })
      });
      setResetSuccess(res.message);
      toast.success('Запрос на сброс пароля отправлен');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-art">
        <div className="login-brand">
          <div className="login-brand-dual">
            <img src="/brand/kait20.png" alt="КАИТ20" className="login-brand-kait" />
            <div className="login-brand-divider" />
            <img src="/brand/mediacode.png" alt="МедиаКод" className="login-brand-mediacode" />
          </div>
          <span className="college-tag">Студенческий медиацентр</span>
        </div>

        <div className="login-quote">
          <h2>Пространство, где идеи превращаются в яркие медиаистории.</h2>
          <p>
            Единая рабочая среда для фотографов, видеографов, авторов, дизайнеров и СММ медиаволонтёров колледжа.
            Участвуйте в съёмках, ведите учёт баллов и пополняйте своё портфолио.
          </p>
        </div>

        <div className="login-art-pills">
          <div className="art-pill"><Camera size={15} /> <span>Фото и видео</span></div>
          <div className="art-pill"><Sparkles size={15} /> <span>Электронная зачётка</span></div>
          <div className="art-pill"><Shield size={15} /> <span>Рейтинг медиаволонтёров</span></div>
        </div>

        <div className="art-orb art-orb-1" />
        <div className="art-orb art-orb-2" />
      </div>

      <div className="login-card-wrapper">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-card-header">
            <div className="eyebrow">АВТОРИЗАЦИЯ</div>
            <h1>Вход в систему</h1>
            <p className="muted">Войдите, чтобы получить доступ к мероприятиям и личному кабинету.</p>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="form-group">
            <label htmlFor="login-input">Логин пользователя</label>
            <input
              id="login-input"
              type="text"
              required
              autoFocus
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value })}
              placeholder="Введите ваш логин"
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="password-input">Пароль</label>
              <button
                type="button"
                className="text-link"
                style={{ fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => {
                  setResetSuccess('');
                  setShowResetModal(true);
                }}
              >
                Забыли пароль?
              </button>
            </div>
            <input
              id="password-input"
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Введите пароль"
            />
          </div>

          <button type="submit" className="btn primary wide" disabled={busy}>
            {busy ? 'Входим в систему…' : 'Войти в МедиаКод'}
            {!busy && <ArrowRight size={16} />}
          </button>

          <div className="recruitment-join-hint" style={{ marginTop: '20px', textAlign: 'center', fontSize: '14px' }}>
            <span className="muted">Хотите стать медиаволонтёром? </span>
            <Link to="/join" className="text-link" style={{ fontWeight: 600 }}>
              Подать заявку на отбор →
            </Link>
          </div>
        </form>
      </div>

      {/* Password Reset Modal */}
      {showResetModal && (
        <Modal
          title="Восстановление доступа"
          onClose={() => setShowResetModal(false)}
        >
          {resetSuccess ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{
                width: '48px', height: '48px', borderRadius: '50%', background: 'var(--success-bg)',
                color: 'var(--success)', display: 'grid', placeItems: 'center', margin: '0 auto 16px'
              }}>
                <Check size={24} />
              </div>
              <h4 style={{ marginBottom: '8px' }}>Запрос зарегистрирован</h4>
              <p className="muted" style={{ fontSize: '14px', lineHeight: 1.5, marginBottom: '20px' }}>
                {resetSuccess}
              </p>
              <button type="button" className="btn primary wide" onClick={() => setShowResetModal(false)}>
                Понятно
              </button>
            </div>
          ) : (
            <form onSubmit={handleRequestReset}>
              <p className="muted" style={{ fontSize: '13px', lineHeight: 1.5, marginBottom: '16px' }}>
                Укажите ваш логин, номер телефона или контакт в мессенджере Макс. Администратор или сотрудник медиацентра оперативно свяжется с вами для подтверждения личности и выдачи нового пароля.
              </p>
              <div className="form-group">
                <label>Логин, телефон или контакт в Макс *</label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Например: ivan_petrov или +7 (916) 123-45-67"
                  value={resetContact}
                  onChange={(e) => setResetContact(e.target.value)}
                />
              </div>
              <div className="modal-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="button" className="btn ghost" onClick={() => setShowResetModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn primary" disabled={resetBusy}>
                  {resetBusy ? 'Отправка…' : 'Отправить запрос'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
