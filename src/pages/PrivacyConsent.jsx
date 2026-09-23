import React, { useState } from 'react';
import { Shield, ArrowRight, Check } from 'lucide-react';
import { api } from '../api.js';

export default function PrivacyConsent({ user, onConsented }) {
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
        body: JSON.stringify({ consent_version: '2026-09' })
      });
      onConsented(res.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card-wrapper" style={{ margin: '0 auto', flex: 1, display: 'flex', justifyContent: 'center' }}>
        <form className="login-card" style={{ width: '450px' }} onSubmit={handleSubmit}>
          <div className="login-card-header" style={{ textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--surface2)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: 'var(--accent)' }}>
              <Shield size={24} />
            </div>
            <h2>Согласие на обработку персональных данных</h2>
            <p className="muted" style={{ fontSize: '13px', lineHeight: 1.5, marginTop: '8px' }}>
              В соответствии с требованиями законодательства, просим вас ознакомиться с политикой и подтвердить согласие на обработку персональных данных.
            </p>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div style={{ background: 'var(--surface)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', marginBottom: '24px' }}>
            <label className="checkbox-label" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={e => setChecked(e.target.checked)}
                style={{ marginTop: '2px' }}
              />
              <span style={{ fontSize: '13px', lineHeight: 1.5, fontWeight: 500 }}>
                Я даю <a href="/privacy.pdf" target="_blank" className="text-link" onClick={e => e.stopPropagation()}>согласие на обработку персональных данных</a>. Согласие требуется для работы личного кабинета медиаволонтёра.
              </span>
            </label>
          </div>

          <button type="submit" className="btn primary wide" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Подтвердить и продолжить'}
            {!busy && <ArrowRight size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
}
