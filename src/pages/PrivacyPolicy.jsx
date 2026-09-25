import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '20px' }}>
      <div className="login-card" style={{ width: '100%', maxWidth: '600px', margin: 0, padding: '32px' }}>
        <h1 style={{ marginBottom: '16px', fontSize: '24px' }}>Согласие на обработку персональных данных в информационной системе MediaCode</h1>
        <p>Оператор: ГБПОУ КАИТ №20.</p>
        <p>Цели обработки: создание и обслуживание учётной записи, идентификация пользователя, организация деятельности студенческого медиацентра, участие в мероприятиях и заданиях, рассмотрение заявок, учёт работ и баллов, внутренние уведомления, безопасность и аудит действий системы.</p>
        <p>Обрабатываемые данные: фамилия, имя, отчество (если указано), телефон, учебное отделение, учебная группа, логин, добровольно добавленные данные профиля, MAX-контакт (если предоставлен), сведения об участии в мероприятиях, заявки, комментарии, ссылки и загруженные пользователем материалы/файлы.</p>
        <p>Согласие может быть отозвано путём обращения к оператору.</p>
        <p><a className="text-link" href="https://st.educom.ru/eduoffices/gateways/get_file.php?id={C6751185-7D3C-F320-3D87-C704B3683104}&name=politika_v_otnoshenii_pd_rkait20.pdf" target="_blank" rel="noreferrer">Официальная политика обработки персональных данных ГБПОУ КАИТ №20</a></p>
        <button 
          type="button" 
          className="btn ghost"
                    onClick={() => { if (window.history.length > 1) { window.history.back(); } else { window.close(); window.location.href = "/"; } }}
        >
          Вернуться назад
        </button>
      </div>
    </div>
  );
}
