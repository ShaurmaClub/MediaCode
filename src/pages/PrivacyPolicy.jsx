import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div className="login-page">
      <div className="login-card-wrapper" style={{ margin: '0 auto', flex: 1, display: 'flex', justifyContent: 'center' }}>
        <div className="login-card" style={{ width: '600px', padding: '32px' }}>
          <h2 style={{ marginBottom: '16px', fontSize: '24px' }}>Обработка персональных данных</h2>
          <p style={{ lineHeight: 1.6, marginBottom: '24px', fontSize: '15px' }}>
            Полная версия документа об обработке персональных данных будет опубликована здесь после утверждения.
          </p>
          <button 
            type="button" 
            className="btn ghost"
            onClick={() => window.history.back()}
          >
            Вернуться назад
          </button>
        </div>
      </div>
    </div>
  );
}
