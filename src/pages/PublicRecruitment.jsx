import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Camera,
  Video,
  Palette,
  Share2,
  CheckCircle2,
  UploadCloud,
  FileCheck,
  Link as LinkIcon,
  Copy,
  Check,
  AlertCircle,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Moon,
  Sun,
  LogIn,
  ArrowLeft,
  FileText,
  Trash2,
  ExternalLink,
  Film,
  Mic,
  Image as ImageIcon
} from 'lucide-react';
import { Loader } from '../components/UI.jsx';
import { RECRUITMENT_TRACKS, TRACK_ICONS } from '../config/recruitmentTracks.js';
import { DEPARTMENTS } from '../config/departments.js';

export default function PublicRecruitment() {
  const params = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Detect track slug from subdomain or route param
  const getSubdomainSlug = () => {
    const host = window.location.hostname.toLowerCase();
    for (const t of RECRUITMENT_TRACKS) {
      if (host.startsWith(`${t.slug}.`) || host.startsWith(`${t.type.toLowerCase()}.`)) {
        return t.slug;
      }
    }
    return null;
  };

  const subdomainSlug = getSubdomainSlug();
  const effectiveSlug = params.trackSlug ? params.trackSlug.toLowerCase() : subdomainSlug;

  const [trackData, setTrackData] = useState(null);
  const [departments, setDepartments] = useState(DEPARTMENTS);
  const [maxSizeMB, setMaxSizeMB] = useState(50);
  const [loading, setLoading] = useState(Boolean(effectiveSlug));
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submittedData, setSubmittedData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  // Form State
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState(DEPARTMENTS[0] || '');
  const [groupName, setGroupName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneIsMax, setPhoneIsMax] = useState(false);
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [submissionUrl, setSubmissionUrl] = useState('');
  const [submissionText, setSubmissionText] = useState('');
  const [comment, setComment] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [consent, setConsent] = useState(false);

  // Load track info when effectiveSlug is defined
  useEffect(() => {
    if (!effectiveSlug) {
      setLoading(false);
      setTrackData(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setErrorMessage('');

    // Pre-populate with local canonical config immediately
    const localTrack = RECRUITMENT_TRACKS.find(
      (t) => t.slug === effectiveSlug || t.type.toLowerCase() === effectiveSlug
    );
    if (localTrack) {
      setTrackData(localTrack);
    }

    fetch(`/api/public/recruitment/track/${effectiveSlug}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Направление не найдено');
        }
        return res.json();
      })
      .then((data) => {
        if (isMounted) {
          setTrackData(data.track);
          if (data.departments && data.departments.length > 0) {
            setDepartments(data.departments);
            if (!department) {
              setDepartment(data.departments[0]);
            }
          }
          setMaxSizeMB(data.maxUploadSizeMB || 50);
        }
      })
      .catch((err) => {
        if (isMounted && !localTrack) {
          setErrorMessage(err.message);
          setTrackData(null);
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [effectiveSlug]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);

      if (effectiveSlug === 'photo') {
        // Photo track file handling: validate strictly JPEG
        const nonJpegs = newFiles.filter((f) => {
          const name = (f.name || '').toLowerCase();
          const isExt = name.endsWith('.jpg') || name.endsWith('.jpeg');
          const isMime = f.type === 'image/jpeg' || f.type === 'image/pjpeg';
          return !isExt && !isMime;
        });

        if (nonJpegs.length > 0) {
          setErrorMessage('Для направления Фотография разрешены только файлы в формате JPEG (.jpg, .jpeg).');
          return;
        }

        const totalCount = selectedFiles.length + newFiles.length;
        if (totalCount > 10) {
          setErrorMessage('Для направления Фотография требуется прикрепить ровно 10 фотографий. Вы не можете выбрать больше 10 файлов.');
          return;
        }
      } else {
        const totalCount = selectedFiles.length + newFiles.length;
        if (totalCount > 10) {
          setErrorMessage('Максимальное количество прикрепляемых файлов — 10. Пожалуйста, соберите файлы в архив или укажите ссылку на Яндекс Диск.');
          return;
        }
      }

      for (const file of newFiles) {
        if (file.size > maxSizeMB * 1024 * 1024) {
          setErrorMessage(`Файл «${file.name}» превышает допустимый размер ${maxSizeMB} МБ. Файлы большего размера рекомендуем прикреплять ссылкой на Яндекс Диск.`);
          return;
        }
      }

      setSelectedFiles((prev) => [...prev, ...newFiles]);
      setErrorMessage('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (indexToRemove) => {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const formatRussianPhoneInput = (val) => {
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

  const handlePhoneChange = (e) => {
    const formatted = formatRussianPhoneInput(e.target.value);
    setPhone(formatted);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    // 1. FIO validation (Russian Cyrillic letters only)
    if (!fullName.trim() || fullName.trim().length < 2) {
      setErrorMessage('Укажите ваше ФИО полностью.');
      return;
    }
    const cyrillicFioRegex = /^[А-Яа-яЁё\s-]+$/;
    if (!cyrillicFioRegex.test(fullName.trim())) {
      setErrorMessage('Введите ФИО русскими буквами');
      return;
    }

    // 2. Department & Group validation
    if (!department) {
      setErrorMessage('Выберите отделение колледжа.');
      return;
    }
    if (!groupName.trim()) {
      setErrorMessage('Укажите учебную группу.');
      return;
    }

    // 3. Phone validation
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setErrorMessage('Укажите корректный номер телефона РФ (например, +7 (999) 000-00-00).');
      return;
    }

    // 4. Consent validation
    if (!consent) {
      setErrorMessage('Для отправки заявки необходимо дать согласие на обработку персональных данных.');
      return;
    }

    // 6. Track-specific submission validation
    if (effectiveSlug === 'photo') {
      if (selectedFiles.length !== 10) {
        setErrorMessage('Для направления Фотография требуется прикрепить ровно 10 фотографий в формате JPEG');
        return;
      }
      const allJpegs = selectedFiles.every((f) => {
        const name = (f.name || '').toLowerCase();
        const isExt = name.endsWith('.jpg') || name.endsWith('.jpeg');
        const isMime = f.type === 'image/jpeg' || f.type === 'image/pjpeg';
        return isExt || isMime;
      });
      if (!allJpegs) {
        setErrorMessage('Для направления Фотография требуется прикрепить ровно 10 фотографий в формате JPEG');
        return;
      }
    } else if (effectiveSlug === 'smm') {
      if (!submissionText.trim() && !submissionUrl.trim()) {
        setErrorMessage('Введите ответ на тестовое задание в текстовое поле или прикрепите ссылку на Яндекс Диск');
        return;
      }
    } else {
      if (selectedFiles.length === 0 && !submissionUrl.trim()) {
        setErrorMessage('Прикрепите файл с выполненным заданием или укажите ссылку на Яндекс Диск');
        return;
      }
    }

    setSubmitting(true);
    const formData = new FormData();
    formData.append('full_name', fullName.trim());
    formData.append('department', department);
    formData.append('group_name', groupName.trim());
    formData.append('phone', phone.trim());
    formData.append('phone_is_max', phoneIsMax ? 'true' : 'false');
    formData.append('portfolio_url', portfolioUrl.trim());
    formData.append('submission_url', submissionUrl.trim());
    formData.append('submission_text', submissionText.trim());
    formData.append('comment', comment.trim());
    formData.append('consent', 'true');

    for (const file of selectedFiles) {
      formData.append('files', file);
    }

    try {
      const res = await fetch(`/api/public/recruitment/apply/${effectiveSlug}`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка при отправке заявки');
      }

      setSubmittedData({
        ...data,
        fullName: fullName.trim(),
        phone: phone.trim(),
        phoneIsMax,
        filesCount: selectedFiles.length,
        hasText: Boolean(submissionText.trim()),
        hasLink: Boolean(submissionUrl.trim())
      });
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const copyPublicId = () => {
    if (submittedData?.public_id) {
      navigator.clipboard.writeText(submittedData.public_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const resetForm = () => {
    setSubmittedData(null);
    setFullName('');
    setGroupName('');
    setPhone('');
    setPhoneIsMax(false);
    setPortfolioUrl('');
    setSubmissionUrl('');
    setSubmissionText('');
    setComment('');
    setSelectedFiles([]);
    setConsent(false);
    setErrorMessage('');
  };

  const toggleTheme = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  };

  const TrackIcon =
    trackData?.type && TRACK_ICONS[trackData.type]
      ? TRACK_ICONS[trackData.type]
      : Sparkles;

  return (
    <div className="public-portal-wrapper">
      {/* Top Header */}
      <header className="public-header">
        <div className="public-header-inner">
          <Link to="/" className="public-brand">
            <img src="/mediacode-logo.png" alt="МедиаКод" className="brand-img-lg" />
            <span className="public-brand-tag">Отбор медиаволонтёров</span>
          </Link>

          <div className="public-header-actions">
            <button
              type="button"
              className="public-theme-btn"
              onClick={toggleTheme}
              title="Переключить тему оформления"
            >
              <Sun size={17} className="light-icon" />
              <Moon size={17} className="dark-icon" />
            </button>

            <Link to="/dashboard" className="public-login-link">
              <LogIn size={15} />
              <span>Вход для команды</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="public-main">
        {/* CASE 1: No slug in URL -> Show Track Selection Directory */}
        {!effectiveSlug && (
          <div className="track-directory-section">
            <div className="track-directory-hero">
              <h1>Направления отбора в «МедиаКод»</h1>
              <p className="track-directory-sub">
                Выберите ваше творческое направление, ознакомьтесь с условиями тестового задания и отправьте выполненные материалы кураторам.
              </p>
            </div>

            <div className="track-directory-grid">
              {RECRUITMENT_TRACKS.map((t) => {
                const Icon = t.icon || Sparkles;
                return (
                  <Link to={`/join/${t.slug}`} key={t.slug} className="track-directory-card">
                    <div className="track-directory-card-top">
                      <div className="track-directory-icon-wrap">
                        <Icon size={24} />
                      </div>
                      <span className="track-open-badge">Приём открыт</span>
                    </div>
                    <h3>{t.name}</h3>
                    <p>{t.description}</p>
                    <div className="track-directory-card-action">
                      <span>Перейти к заданию</span>
                      <ArrowRight size={16} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* CASE 2: Specific track slug provided and loading */}
        {effectiveSlug && loading && !trackData && (
          <div className="public-card public-loading">
            <Loader text="Загрузка тестового задания…" />
          </div>
        )}

        {/* Error State */}
        {effectiveSlug && !loading && errorMessage && !trackData && (
          <div className="public-card error-card">
            <AlertCircle size={32} className="error-icon" />
            <h2>Направление не найдено</h2>
            <p>{errorMessage}</p>
            <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
              <Link to="/join" className="btn ghost">
                ← Все направления
              </Link>
              <Link to="/join/photo" className="btn primary">
                К фотослужбе
              </Link>
            </div>
          </div>
        )}

        {/* CASE 3: Submission Confirmation Screen */}
        {effectiveSlug && submittedData && (
          <div className="public-card confirmation-card">
            <div className="confirmation-header">
              <div className="confirmation-badge">
                <CheckCircle2 size={44} />
              </div>
              <h1>Заявка отправлена</h1>
              <p className="confirmation-sub">
                Мы проверим материалы и свяжемся с вами в мессенджере MAX или по телефону.
              </p>
            </div>

            {/* Compact service ID line */}
            <div className="public-id-compact-row">
              <span className="public-id-service-label">Номер обращения:</span>
              <code className="public-id-service-code">#{submittedData.public_id}</code>
              <button
                type="button"
                className="copy-btn-compact"
                onClick={copyPublicId}
                title="Скопировать номер обращения"
              >
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                <span>{copied ? 'Скопировано' : 'Копировать'}</span>
              </button>
            </div>

            {/* Next Steps Information */}
            <div className="next-steps-panel">
              <h3>Порядок рассмотрения:</h3>
              <ul className="next-steps-list">
                <li>
                  <strong>1. Изучение материалов.</strong> Куратор направления внимательно отсмотрит ваше тестовое задание в течение нескольких дней.
                </li>
                <li>
                  <strong>2. Обратная связь.</strong> Наш куратор напишет вам в MAX или позвонит по номеру <code>{submittedData.phone}</code>.
                </li>
                <li>
                  <strong>3. Приглашение в команду.</strong> После успешного отбора вы получите доступ к системе «МедиаКод» и первые приветственные баллы волонтёра!
                </li>
              </ul>
            </div>

            <div className="confirmation-actions">
              <button type="button" className="btn ghost" onClick={resetForm}>
                Подать ещё одну заявку
              </button>
              <Link to="/join" className="btn secondary">
                К списку направлений
              </Link>
            </div>
          </div>
        )}

        {/* CASE 4: Active Application Form for the Selected Track */}
        {effectiveSlug && trackData && !submittedData && (
          <div className="public-container">
            {/* Top Back Breadcrumb */}
            <div className="public-top-nav">
              <Link to="/join" className="back-link">
                <ArrowLeft size={16} />
                <span>Все направления отбора</span>
              </Link>
            </div>

            <div className="public-grid">
              {/* Left Column: Track Info & Assignment Description */}
              <section className="public-track-info">
                <div className="track-hero-card">
                  <div className="track-hero-badge">
                    <TrackIcon size={18} />
                    <span>{trackData.name}</span>
                  </div>
                  <h2>{trackData.title || `Тестовое задание — ${trackData.name}`}</h2>
                  <p className="track-hero-desc">{trackData.description}</p>
                </div>

                {/* Assignment details card */}
                <div className="public-card assignment-card">
                  <div className="assignment-header">
                    <Sparkles size={20} className="sparkle-icon" />
                    <h3>Тестовое задание</h3>
                  </div>

                  <div className="assignment-content">
                    <div className="assignment-text">
                      {trackData.instructions ? (
                        <div style={{ whiteSpace: 'pre-line' }}>{trackData.instructions}</div>
                      ) : (
                        <p>
                          Выполните творческое задание по направлению и прикрепите материалы в форме справа.
                        </p>
                      )}
                    </div>

                    {/* ONLY MONTAGE has materials button! Never show for photo, video, design, smm, content */}
                    {effectiveSlug === 'montage' && trackData.materials_url && (
                      <div className="materials-btn-block" style={{ marginTop: '16px' }}>
                        <a
                          href={trackData.materials_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn primary sm"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                        >
                          <ExternalLink size={14} />
                          <span>Скачать архив с исходными материалами</span>
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="perks-block">
                    <h4>Что даёт участие в команде «МедиаКод»?</h4>
                    <ul className="perks-list">
                      <li>✦ Реальная практика на съёмках и событиях колледжа</li>
                      <li>✦ Доступ к студийному свету, технике и монтажным станциям</li>
                      <li>✦ Накопление баллов активности, электронная зачётка волонтёра</li>
                      <li>✦ Пополнение личного портфолио сильными проектами</li>
                    </ul>
                  </div>
                </div>
              </section>

              {/* Right Column: Submission Form */}
              <section className="public-form-section">
                <div className="public-card form-card">
                  <div className="form-card-head">
                    <div>
                      <h3>Анкета кандидата</h3>
                      <p className="muted" style={{ fontSize: '13px', margin: '4px 0 0' }}>
                        Направление: <strong>«{trackData.name}»</strong>
                      </p>
                    </div>
                    <span className="required-notice">* Обязательные поля</span>
                  </div>

                  {errorMessage && (
                    <div className="form-error-banner">
                      <AlertCircle size={17} />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="recruitment-form">
                    {/* Full Name */}
                    <div className="form-group">
                      <label htmlFor="fullName">ФИО полностью *</label>
                      <input
                        id="fullName"
                        type="text"
                        required
                        placeholder="Иванов Иван Иванович"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>

                    {/* Department & Group */}
                    <div className="form-grid-2">
                      <div className="form-group">
                        <label htmlFor="department">Отделение колледжа *</label>
                        <select
                          id="department"
                          required
                          value={department}
                          onChange={(e) => setDepartment(e.target.value)}
                        >
                          {departments.map((dep) => (
                            <option key={dep} value={dep}>
                              {dep}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="groupName">Учебная группа *</label>
                        <input
                          id="groupName"
                          type="text"
                          required
                          placeholder="например, ИС-21"
                          value={groupName}
                          onChange={(e) => setGroupName(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Phone & MAX Checkbox */}
                    <div className="form-group">
                      <label htmlFor="phone">Контактный телефон *</label>
                      <input
                        id="phone"
                        type="tel"
                        required
                        placeholder="+7 (___) ___-__-__"
                        value={phone}
                        onChange={handlePhoneChange}
                      />
                      <label
                        className="checkbox-label"
                        style={{
                          marginTop: '10px',
                          fontSize: '12.5px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={phoneIsMax}
                          onChange={(e) => setPhoneIsMax(e.target.checked)}
                        />
                        <span>Этот номер телефона используется в MAX</span>
                      </label>
                      {phoneIsMax ? (
                        <small className="muted" style={{ display: 'block', marginTop: '6px', fontSize: '11.5px', color: 'var(--accent)' }}>
                          ✓ Номер {phone || 'телефона'} будет использоваться кураторами для оперативной связи в мессенджере MAX
                        </small>
                      ) : (
                        <small className="muted" style={{ display: 'block', marginTop: '6px', fontSize: '11.5px' }}>
                          Если у вас есть аккаунт в мессенджере MAX на этом номере, отметьте галочку для связи.
                        </small>
                      )}
                    </div>

                    {/* Portfolio URL: strictly Yandex Disk */}
                    <div className="form-group">
                      <label htmlFor="portfolioUrl">Ссылка на портфолио в Яндекс Диске (если есть)</label>
                      <input
                        id="portfolioUrl"
                        type="url"
                        placeholder="https://disk.yandex.ru/..."
                        value={portfolioUrl}
                        onChange={(e) => setPortfolioUrl(e.target.value)}
                      />
                    </div>

                    {/* Test Assignment Materials Section */}
                    <div className="materials-upload-box">
                      <div className="materials-box-header">
                        <label className="submission-label" style={{ margin: 0, fontWeight: 700 }}>
                          {effectiveSlug === 'photo'
                            ? 'Материалы задания: ровно 10 фотографий JPEG *'
                            : effectiveSlug === 'smm'
                            ? 'Ответ на тестовое задание *'
                            : 'Материалы выполненного задания *'}
                        </label>
                        <span className="muted" style={{ fontSize: '12px' }}>
                          {effectiveSlug === 'photo'
                            ? 'Ровно 10 файлов JPEG'
                            : effectiveSlug === 'smm'
                            ? 'Текст задания или Яндекс Диск'
                            : 'Файл или Яндекс Диск'}
                        </span>
                      </div>

                      {/* SMM: Primary Large Textarea */}
                      {effectiveSlug === 'smm' && (
                        <div className="form-group" style={{ marginTop: '12px' }}>
                          <label htmlFor="submissionText" style={{ fontSize: '13px', fontWeight: 600 }}>
                            Ответ на тестовое задание *
                          </label>
                          <textarea
                            id="submissionText"
                            rows="12"
                            className="submission-textarea"
                            style={{ fontFamily: 'inherit', lineHeight: 1.5, whiteSpace: 'pre-wrap', resize: 'vertical' }}
                            placeholder="1. Встреча со студенческими организациями и клубами:&#10;План взаимодействия со студсоветом...&#10;&#10;2. Визуальная концепция и Tone of Voice...&#10;&#10;3. Исправление неудачного поста...&#10;&#10;4. Освещение события: 10 лучших фото и 3 видеоролика...&#10;&#10;5. Интерактив для Telegram-канала..."
                            value={submissionText}
                            onChange={(e) => setSubmissionText(e.target.value)}
                          />
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '11px', color: 'var(--muted)' }}>
                            <span>Сохраняются абзацы, списки, переносы строк и эмодзи ✨</span>
                            <span>{submissionText.length} знаков</span>
                          </div>
                        </div>
                      )}

                      {/* Montage raw materials alert/button */}
                      {effectiveSlug === 'montage' && trackData.materials_url && (
                        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                          <div>
                            <strong style={{ fontSize: '13px', display: 'block' }}>Исходные материалы для монтажа:</strong>
                            <small className="muted" style={{ fontSize: '11px' }}>Скачайте архив с видеоматериалами для выполнения задания</small>
                          </div>
                          <a
                            href={trackData.materials_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn tiny primary"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                          >
                            <ExternalLink size={13} /> Скачать архив с исходными материалами
                          </a>
                        </div>
                      )}

                      {/* File Upload Dropzone (NOT primary for SMM) */}
                      {effectiveSlug !== 'smm' && (
                        <div className="upload-block" style={{ marginTop: '14px' }}>
                          <div
                            className="multi-file-dropzone"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <input
                              type="file"
                              multiple={effectiveSlug === 'photo'}
                              accept={
                                effectiveSlug === 'photo'
                                  ? '.jpg,.jpeg,image/jpeg'
                                  : effectiveSlug === 'design'
                                  ? '.png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf'
                                  : 'video/mp4,video/quicktime,.mp4,.mov,.zip,.rar'
                              }
                              ref={fileInputRef}
                              style={{ display: 'none' }}
                              onChange={handleFileChange}
                            />
                            <UploadCloud size={24} className="upload-icon" />
                            <div className="dropzone-text">
                              <strong>
                                {effectiveSlug === 'photo'
                                  ? `Прикрепить фотографии (ровно 10 снимков JPEG, до ${maxSizeMB} МБ на файл)`
                                  : effectiveSlug === 'design'
                                  ? `Прикрепить макет афиши (PNG / JPG / PDF, до ${maxSizeMB} МБ)`
                                  : `Прикрепить видеофайл (MP4 / MOV, до ${maxSizeMB} МБ)`}
                              </strong>
                              <small className="muted">
                                {effectiveSlug === 'photo'
                                  ? `Выбрано: ${selectedFiles.length} из 10 фото JPEG`
                                  : effectiveSlug === 'design'
                                  ? 'PNG, JPG или PDF высокого разрешения'
                                  : 'Формат MP4 или MOV'}
                              </small>
                            </div>
                          </div>

                          {selectedFiles.length > 0 && (
                            <div className="selected-files-list">
                              {selectedFiles.map((f, idx) => (
                                <div key={idx} className="selected-file-chip">
                                  <FileCheck size={16} className="file-chip-icon" />
                                  <span className="file-chip-name">{f.name}</span>
                                  <span className="file-chip-size">({(f.size / (1024 * 1024)).toFixed(2)} МБ)</span>
                                  <button
                                    type="button"
                                    className="file-chip-del"
                                    onClick={() => handleRemoveFile(idx)}
                                    title="Удалить файл"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* SMM: Optional document link or file */}
                      {effectiveSlug === 'smm' && (
                        <div className="form-group" style={{ marginTop: '14px' }}>
                          <label htmlFor="submissionUrl" style={{ fontSize: '12px', fontWeight: 600 }}>
                            Ссылка на документ в Яндекс Диске (необязательно)
                          </label>
                          <div className="url-input-wrap">
                            <LinkIcon size={16} className="url-icon" />
                            <input
                              id="submissionUrl"
                              type="url"
                              placeholder="https://disk.yandex.ru/..."
                              value={submissionUrl}
                              onChange={(e) => setSubmissionUrl(e.target.value)}
                            />
                          </div>
                          <small className="muted" style={{ display: 'block', marginTop: '4px', fontSize: '11px' }}>
                            Если вы оформили тестовое задание в Яндекс Документах, прикрепите ссылку с открытым доступом на чтение.
                          </small>
                        </div>
                      )}

                      {/* Design / Video / Montage / Content Cloud URL */}
                      {effectiveSlug !== 'smm' && effectiveSlug !== 'photo' && (
                        <div className="form-group" style={{ marginTop: '14px' }}>
                          <label htmlFor="submissionUrl" style={{ fontSize: '12px', fontWeight: 600 }}>
                            {effectiveSlug === 'design'
                              ? 'Ссылка на макет в Figma или папку на Яндекс Диске'
                              : 'Ссылка на видео на Яндекс Диске (если файл загружен в облако)'}
                          </label>
                          <div className="url-input-wrap">
                            <LinkIcon size={16} className="url-icon" />
                            <input
                              id="submissionUrl"
                              type="url"
                              placeholder={
                                effectiveSlug === 'design'
                                  ? 'https://disk.yandex.ru/... или ссылка на Figma'
                                  : 'https://disk.yandex.ru/...'
                              }
                              value={submissionUrl}
                              onChange={(e) => setSubmissionUrl(e.target.value)}
                            />
                          </div>
                          <small className="muted" style={{ display: 'block', marginTop: '4px', fontSize: '11px', lineHeight: 1.4 }}>
                            {effectiveSlug === 'design'
                              ? 'Вы можете прикрепить ссылку на проект в Figma или исходники на Яндекс Диске с открытым доступом.'
                              : 'Большие видеоролики хронометражем до 1-2 минут рекомендуем загружать на Яндекс Диск с открытым доступом.'}
                          </small>
                        </div>
                      )}

                      {/* Non-SMM optional note */}
                      {effectiveSlug !== 'smm' && (
                        <div className="form-group" style={{ marginTop: '14px' }}>
                          <label htmlFor="submissionText" style={{ fontSize: '12px', fontWeight: 600 }}>
                            Пояснение к выполненному заданию (необязательно)
                          </label>
                          <textarea
                            id="submissionText"
                            rows="3"
                            className="submission-textarea"
                            placeholder="Дополнительные примечания к работе, идея или используемые приёмы…"
                            value={submissionText}
                            onChange={(e) => setSubmissionText(e.target.value)}
                          />
                        </div>
                      )}
                    </div>

                    {/* Cover Comment */}
                    <div className="form-group">
                      <label htmlFor="comment">Комментарий к заявке (необязательно)</label>
                      <textarea
                        id="comment"
                        rows="2"
                        placeholder="Расскажите о вашей технике, опыте или творческих целях в медиацентре…"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                      />
                    </div>

                    {/* Mandatory Consent Checkbox (UNCHECKED BY DEFAULT) */}
                    <div className="consent-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          required
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        <span>
                          Я даю согласие на{' '}
                          <button
                            type="button"
                            className="text-link inline-policy-btn"
                            onClick={() => setShowPrivacyModal(true)}
                          >
                            обработку персональных данных
                          </button>{' '}
                          в целях участия в конкурсном отборе медиацентра «МедиаКод» *
                        </span>
                      </label>
                    </div>

                    {/* Submit Button */}
                    <button
                      type="submit"
                      className="btn primary submit-recruitment-btn wide"
                      disabled={submitting}
                    >
                      {submitting ? 'Отправка заявки…' : 'Отправить тестовое задание'}
                      {!submitting && <ArrowRight size={17} />}
                    </button>
                  </form>
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* Privacy Policy Modal */}
      {showPrivacyModal && (
        <div className="privacy-modal-backdrop" onClick={() => setShowPrivacyModal(false)}>
          <div className="privacy-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="privacy-modal-header">
              <ShieldCheck size={22} className="shield-icon" />
              <h3>Согласие на обработку персональных данных</h3>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setShowPrivacyModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="privacy-modal-body">
              <p>
                <strong>1. Цель обработки данных</strong>
                <br />
                Предоставленные персональные данные (ФИО, учебная группа, контактный телефон, аккаунт в мессенджере MAX, ссылки на материалы и портфолио) обрабатываются исключительно в целях организации конкурсного отбора волонтёров в студенческий медиацентр «МедиаКод».
              </p>
              <p>
                <strong>2. Конфиденциальность и безопасность</strong>
                <br />
                Все полученные сведения хранятся во внутреннем контуре системы медиацентра, доступны только авторизованным кураторам и администраторам и не передаются третьим лицам.
              </p>
              <p>
                <strong>3. Связь с кандидатом</strong>
                <br />
                Номер телефона и контакт MAX используются куратором направления для информирования о результатах рассмотрения тестового задания и координации дальнейших встреч.
              </p>
            </div>
            <div className="privacy-modal-footer">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setConsent(true);
                  setShowPrivacyModal(false);
                }}
              >
                Принять и продолжить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
