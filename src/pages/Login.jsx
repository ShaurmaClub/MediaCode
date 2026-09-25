import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { Sparkles, ArrowRight, Shield, Camera, KeyRound, HelpCircle, X, Check, Eye, EyeOff } from 'lucide-react';
import Modal from '../components/Modal.jsx';

const formatPhone = (val) => {
  let digits = val.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('8') || digits.startsWith('7')) {
    digits = '7' + digits.slice(1);
  } else if (digits.length > 0 && digits[0] !== '7') {
    digits = '7' + digits;
  }
  digits = digits.slice(0, 11);
  let formatted = '+7';
  if (digits.length > 1) formatted += ' (' + digits.substring(1, 4);
  if (digits.length >= 5) formatted += ') ' + digits.substring(4, 7);
  if (digits.length >= 8) formatted += '-' + digits.substring(7, 9);
  if (digits.length >= 10) formatted += '-' + digits.substring(9, 11);
  return formatted;
};

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ login: '', password: '' });
  const [activationMode, setActivationMode] = useState(false);
  const [loginMode, setLoginMode] = useState('phone'); // 'phone' or 'login'
  const [showPassword, setShowPassword] = useState(false);
  const [showActPassword, setShowActPassword] = useState(false);
  const [activationPhone, setActivationPhone] = useState('');
  const [actForm, setActForm] = useState({
    token: '', first_name: '', last_name: '', department: '', group_name: '', login: '', password: ''
  });
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetContact, setResetContact] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSuccess, setResetSuccess] = useState('');
  const toast = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loginMode === 'activation') {
      if (form.login.replace(/\D/g, '').length < 11) {
        setError('Введите корректный номер телефона.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        if (!registrationConsent) {
          setError('Требуется согласие на обработку персональных данных.');
          return;
        }
        const res = await fetch('/api/auth/registration-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: form.login, privacy_consent: true })
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.notFound) {
            setError('Номер не найден. Хотите подать заявку в медиацентр?');
          } else {
            setError(data.error || 'Ошибка проверки номера');
          }
          return;
        }
        setActivationPhone(form.login);
        if (data.user) {
          setActForm({ ...actForm, first_name: data.user.first_name || '', last_name: data.user.last_name || '', group_name: data.user.group_name || '' });
        }
        setActivationMode(true);
      } catch (err) {
        setError('Сбой сети. Попробуйте еще раз.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (loginMode === 'phone' && form.login.replace(/\D/g, '').length < 11) {
      setError('Введите корректный номер телефона.');
      return;
    }
    if (loginMode === 'login' && /^\d+$/.test(form.login.trim())) {
      setError('Логин не может состоять только из цифр. Если это телефон, переключите вкладку.');
      return;
    }
    if (!form.login || !form.password) {
      setError('Заполните логин/телефон и пароль');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(form) });
      if (data.requiresActivation) {
        setActivationPhone(data.phone || form.login);
        setActivationMode(true);
        return;
      }
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
      toast.error('Укажите ваш логин или телефон');
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

  const handleActivate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: activationPhone, ...actForm })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка активации');
      toast.success(data.message);
      setActivationMode(false);
      setForm({ login: actForm.login, password: actForm.password });
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (activationMode) {
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
          <form className="login-card" onSubmit={handleActivate}>
            <div className="login-card-header">
              <div className="eyebrow">АКТИВАЦИЯ АККАУНТА</div>
              <h2>Регистрация медиаволонтёра</h2>
              <p className="muted">Ваш номер <b>{activationPhone}</b> найден. Пожалуйста, заполните профиль для завершения регистрации.</p>
            </div>

            {error && (
            <div className="error-banner">
              {error}
              {error.includes('подать заявку') && (
                <div style={{ marginTop: '8px' }}>
                  <Link to="/join" className="btn primary tiny">Заполнить анкету</Link>
                </div>
              )}
            </div>
          )}

            

            

            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Имя <span className="required">*</span></label>
                <input type="text" required value={actForm.first_name} onChange={e => setActForm({...actForm, first_name: e.target.value})} placeholder="Иван" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Фамилия <span className="required">*</span></label>
                <input type="text" required value={actForm.last_name} onChange={e => setActForm({...actForm, last_name: e.target.value})} placeholder="Иванов" />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Отделение <span className="required">*</span></label>
                  <input type="text" list="departments" required value={actForm.department} onChange={e => setActForm({...actForm, department: e.target.value})} placeholder="Моссовет" />
                  <datalist id="departments">
                    <option value="Учебное отделение «Моссовет»" />
                    <option value="Учебное отделение «Техно»" />
                    <option value="Учебное отделение «Датахаб»" />
                    <option value="Учебное отделение «АртТех»" />
                    <option value="Учебное отделение «Кибер»" />
                    <option value="Учебное отделение «Диджитал»" />
                  </datalist>
              </div>
              <div className="form-group" style={{ width: '120px' }}>
                <label>Группа <span className="required">*</span></label>
                <input type="text" required value={actForm.group_name} onChange={e => setActForm({...actForm, group_name: e.target.value})} placeholder="ИСП-123" />
              </div>
            </div>

            <div className="form-group">
              <label>Желаемый логин <span className="required">*</span></label>
              <input type="text" required value={actForm.login} onChange={e => setActForm({...actForm, login: e.target.value})} placeholder="ivan_petrov" />
              <small className="muted">Используйте латинские буквы и цифры</small>
            </div>

            <div className="form-group">
              <label>Пароль <span className="required">*</span></label>
              <div style={{ position: 'relative' }}>
                <input type={showActPassword ? 'text' : 'password'} required minLength="6" value={actForm.password} onChange={e => setActForm({...actForm, password: e.target.value})} placeholder="Минимум 8 символов" style={{ width: '100%', paddingRight: '40px' }} />
                <button type="button" onClick={() => setShowActPassword(!showActPassword)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  {showActPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn primary" style={{ width: '100%', marginTop: '8px' }} disabled={busy}>
              {busy ? 'Активация...' : 'Активировать аккаунт'}
            </button>
            <button type="button" className="btn ghost" style={{ width: '100%', marginTop: '8px' }} onClick={() => setActivationMode(false)}>
              Вернуться ко входу
            </button>
          </form>
        </div>
      </div>
    );
  }

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

          {error && (
            <div className="error-banner">
              {error}
              {error.includes('подать заявку') && (
                <div style={{ marginTop: '8px' }}>
                  <Link to="/join" className="btn primary tiny">Заполнить анкету</Link>
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px", background: "var(--surface2)", padding: "4px", borderRadius: "var(--radius-md)" }}>
              <button type="button" onClick={() => { setLoginMode("phone"); setForm({...form, login: "", password: ""}); }} className={`btn auth-tab-btn ${loginMode === "phone" ? "active" : ""}`} >
                По телефону
              </button>
              <button type="button" onClick={() => { setLoginMode("login"); setForm({...form, login: "", password: ""}); }} className={`btn auth-tab-btn ${loginMode === "login" ? "active" : ""}`} >
                По логину
              </button>
              <button type="button" onClick={() => { setLoginMode("activation"); setForm({...form, login: "", password: ""}); setError(""); }} className={`btn auth-tab-btn ${loginMode === "activation" ? "active" : ""}`} >
                Первый вход / Активация
              </button>
            </div>

            <div className="form-group">
              <label htmlFor="login-input">{(loginMode === 'phone' || loginMode === 'activation') ? 'Номер телефона' : 'Логин'}</label>
              <input
                id="login-input"
                type={(loginMode === 'phone' || loginMode === 'activation') ? 'tel' : 'text'}
                required
                autoFocus
                value={form.login}
                onChange={(e) => {
                  let val = e.target.value;
                  if (loginMode === 'phone' || loginMode === 'activation') {
                    val = formatPhone(val);
                  }
                  setForm({ ...form, login: val });
                }}
                placeholder={(loginMode === 'phone' || loginMode === 'activation') ? '+7 (900) 000-00-00' : 'Например: ivan_petrov'}
              />
              {loginMode === 'login' && /^\+?[0-9\s\-\(\)]{10,}$/.test(form.login) && (
                <small className="text-warning" style={{ marginTop: '4px', display: 'block' }}>Похоже на номер телефона. Используйте вкладку «По номеру телефона».</small>
              )}
            </div>

          {loginMode === 'activation' && (
            <div className="form-group">
              <label className="checkbox-label" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <input type="checkbox" required checked={registrationConsent} onChange={e => setRegistrationConsent(e.target.checked)} />
                <span>Я даю согласие на обработку персональных данных</span>
              </label>
              <div style={{ fontSize: '12px', marginTop: '6px' }}>
                <a href="/privacy-consent" target="_blank" rel="noreferrer" className="text-link">Согласие на обработку персональных данных</a><br />
                <a href="https://st.educom.ru/eduoffices/gateways/get_file.php?id={C6751185-7D3C-F320-3D87-C704B3683104}&name=politika_v_otnoshenii_pd_rkait20.pdf" target="_blank" rel="noreferrer" className="text-link">Политика обработки персональных данных ГБПОУ КАИТ №20</a>
              </div>
            </div>
          )}

          {loginMode !== 'activation' && (
            <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="password-input">Пароль</label>
              <a
                href="https://t.me/Vadim112005"
                target="_blank"
                rel="noreferrer"
                className="text-link"
                style={{ fontSize: '12px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Проблемы со входом?
              </a>
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
          )}

          <button type="submit" className="btn primary wide" disabled={busy}>
            {busy ? (loginMode === 'activation' ? 'Проверка...' : 'Входим в систему…') : (loginMode === 'activation' ? 'Продолжить' : 'Войти в МедиаКод')}
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
          title="Не получается войти?"
          onClose={() => setShowResetModal(false)}
        >
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "24px" }}>
              Если вы забыли пароль или потеряли доступ к платформе, напишите об этом в чат команды медиацентра. Сотрудник поможет восстановить доступ.
            </p>
            <button type="button" className="btn primary wide" onClick={() => setShowResetModal(false)}>
              Понятно
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}






