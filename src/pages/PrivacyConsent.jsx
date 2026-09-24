import React, { useState } from 'react';
import { Shield, ArrowRight } from 'lucide-react';
import { api } from '../api.js';

export default function PrivacyConsent({ user, onConsented, onLogout }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!checked) {
      setError('Для продолжения необходимо дать согласие на обработку персональных данных.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/privacy-consent', {
        method: 'POST',
        body: JSON.stringify({ consent_version: 'draft-2026-09' })
      });
      onConsented(res.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
    if (onLogout) onLogout();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '20px' }}>
      <form className="login-card" style={{ width: '100%', maxWidth: '450px', margin: 0 }} onSubmit={handleSubmit}>
        <div className="login-card-header" style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--surface2)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: 'var(--accent)' }}>
            <Shield size={24} />
          </div>
          <h2 style={{ marginBottom: '8px' }}>Согласие на обработку персональных данных</h2>
          <p className="muted" style={{ fontSize: '13px', lineHeight: 1.5, margin: 0 }}>
            В соответствии с требованиями законодательства, просим вас ознакомиться с политикой и подтвердить согласие на обработку персональных данных.
          </p>
        </div>

        {error && <div className="error-banner" style={{ marginBottom: '16px' }}>{error}</div>}

        <div style={{ background: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', marginBottom: '24px' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer', margin: 0 }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={e => setChecked(e.target.checked)}
              style={{ flexShrink: 0, marginTop: "2px", accentColor: "var(--accent)" }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '14px', lineHeight: 1.4, fontWeight: 500 }}>
                Я даю согласие на <a href="/privacy-policy" target="_blank" className="text-link" style={{ display: "inline" }} onClick={e => e.stopPropagation()}>обработку персональных данных</a>
              </span>
              <span className="muted" style={{ fontSize: '12px', lineHeight: 1.4, fontWeight: 400 }}>
                Согласие требуется для работы личного кабинета медиаволонтёра.
              </span>
            </div>
          </label>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button type="submit" className="btn primary wide" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Подтвердить и продолжить'}
            {!busy && <ArrowRight size={16} />}
          </button>
          <button type="button" className="btn ghost wide" onClick={handleLogout} disabled={busy}>
            Выйти из аккаунта
          </button>
        </div>
      </form>
    </div>
  );
}


