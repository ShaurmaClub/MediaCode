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

export const isValidYandexDiskLink = (url) => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    /^https?:\/\/(disk\.)?(360\.)?yandex\.(ru|com|by|kz)\//i.test(trimmed) ||
    /^https?:\/\/disk\.360\.yandex\.(ru|com|by|kz)\//i.test(trimmed) ||
    /^https?:\/\/yadi\.sk\//i.test(trimmed)
  );
};

const SUBMISSION_METHODS = {
  photo: [
    { id: 'files', label: 'Загрузить 10 JPEG на сайт', icon: UploadCloud },
    { id: 'link', label: 'Ссылка на Яндекс Диск', icon: LinkIcon }
  ],
  video: [
    { id: 'files', label: 'Загрузить видео', icon: UploadCloud },
    { id: 'link', label: 'Ссылка на Яндекс Диск', icon: LinkIcon }
  ],
  montage: [
    { id: 'files', label: 'Загрузить готовое видео', icon: UploadCloud },
    { id: 'link', label: 'Ссылка на Яндекс Диск', icon: LinkIcon }
  ],
  design: [
    { id: 'files', label: 'Загрузить макет', icon: UploadCloud },
    { id: 'link', label: 'Ссылка на Яндекс Диск', icon: LinkIcon }
  ],
  smm: [
    { id: 'text', label: 'Ответить прямо в форме', icon: FileText },
    { id: 'link', label: 'Ссылка на Яндекс Документ', icon: LinkIcon }
  ],
  content: [
    { id: 'files', label: 'Загрузить видео', icon: UploadCloud },
    { id: 'link', label: 'Ссылка на Яндекс Диск', icon: LinkIcon }
  ]
};

const DEFAULT_SUBMISSION_METHODS = [
  { id: 'files', label: 'Загрузить файлы', icon: UploadCloud },
  { id: 'link', label: 'Ссылка на Яндекс Диск', icon: LinkIcon }
];

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
  const [phoneIsMax, setPhoneIsMax] = useState(true);
  const [maxContactPhone, setMaxContactPhone] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [submissionUrl, setSubmissionUrl] = useState('');
  const [submissionText, setSubmissionText] = useState('');
  const [comment, setComment] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [submissionMethod, setSubmissionMethod] = useState(
    effectiveSlug === 'smm' ? 'text' : 'files'
  );
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    setSubmissionMethod(effectiveSlug === 'smm' ? 'text' : 'files');
    setSelectedFiles([]);
    setSubmissionUrl('');
    setSubmissionText('');
  }, [effectiveSlug]);

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

    if (!phoneIsMax) {
      const maxDigits = maxContactPhone.replace(/\D/g, '');
      if (maxDigits.length < 10) {
        setErrorMessage('Укажите корректный номер телефона РФ для мессенджера Макс.');
        return;
      }
    }

    // 4. Consent validation
    if (!consent) {
      setErrorMessage('Для отправки заявки необходимо дать согласие на обработку персональных данных.');
      return;
    }

    // 5. Portfolio validation (if provided, must be Yandex Disk)
    if (portfolioUrl.trim()) {
      if (!isValidYandexDiskLink(portfolioUrl.trim())) {
        setErrorMessage('Укажите корректную ссылку на портфолио в Яндекс Диске (https://disk.yandex.ru/... или https://disk.360.yandex.ru/...)');
        return;
      }
    }

    // 6. Track-specific submission validation according to chosen submission method
    let filesToSend = [];
    let urlToSend = '';
    let textToSend = submissionText.trim();

    if (submissionMethod === 'files') {
      if (effectiveSlug === 'photo') {
        if (selectedFiles.length !== 10) {
          setErrorMessage('Для направления Фотография требуется прикрепить ровно 10 фотографий JPEG или переключитесь на отправку ссылки на Яндекс Диск');
          return;
        }
        const allJpegs = selectedFiles.every((f) => {
          const name = (f.name || '').toLowerCase();
          const isExt = name.endsWith('.jpg') || name.endsWith('.jpeg');
          const isMime = f.type === 'image/jpeg' || f.type === 'image/pjpeg';
          return isExt || isMime;
        });
        if (!allJpegs) {
          setErrorMessage('Все 10 файлов должны быть фотографиями в формате JPEG (.jpg / .jpeg)');
          return;
        }
      } else {
        if (selectedFiles.length === 0) {
          setErrorMessage('Прикрепите файл с выполненным заданием или переключитесь на ссылку на Яндекс Диск');
          return;
        }
      }
      filesToSend = selectedFiles;
    } else if (submissionMethod === 'link') {
      if (!submissionUrl.trim()) {
        setErrorMessage('Укажите ссылку на выполненное задание на Яндекс Диске');
        return;
      }
      if (!isValidYandexDiskLink(submissionUrl.trim())) {
        setErrorMessage('Укажите корректную ссылку на Яндекс Диск (https://disk.yandex.ru/... или https://disk.360.yandex.ru/...)');
        return;
      }
      urlToSend = submissionUrl.trim();
    } else if (submissionMethod === 'text') {
      if (!textToSend) {
        setErrorMessage('Введите ответ на тестовое задание в текстовое поле');
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
    if (!phoneIsMax) {
      formData.append('max_contact', maxContactPhone.trim());
    }
    formData.append('portfolio_url', portfolioUrl.trim());
    formData.append('submission_url', urlToSend);
    formData.append('submission_text', textToSend);
    formData.append('comment', comment.trim());
    formData.append('consent', 'true');
    formData.append('consent_version', '2026-09-25');

    for (const file of filesToSend) {
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
        filesCount: filesToSend.length,
        hasText: Boolean(textToSend),
        hasLink: Boolean(urlToSend)
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
    setPhoneIsMax(true);
    setMaxContactPhone('');
    setPortfolioUrl('');
    setSubmissionUrl('');
    setSubmissionText('');
    setComment('');
    setSelectedFiles([]);
    setSubmissionMethod(effectiveSlug === 'smm' ? 'text' : 'files');
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
          <Link to="/" className="public-brand" title="КАИТ20 · МедиаКод">
            <div className="public-brand-dual">
              <img src="/brand/kait20-white.png" alt="КАИТ20" className="public-brand-kait" />
              <div className="public-brand-divider" />
              <img src="/brand/mediacode.png" alt="МедиаКод" className="public-brand-mediacode" />
            </div>
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
                Выберите ваше творческое направление, ознакомьтесь с условиями тестового задания и отправьте выполненные материалы сотрудникам.
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
                Мы проверим материалы и свяжемся с вами в мессенджере Макс или по телефону.
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
                  <strong>1. Изучение материалов.</strong> Сотрудник направления внимательно отсмотрит ваше тестовое задание в течение нескольких дней.
                </li>
                <li>
                  <strong>2. Обратная связь.</strong> Наш сотрудник напишет вам в Макс или позвонит по номеру <code>{submittedData.phone}</code>.
                </li>
                <li>
                  <strong>3. Приглашение в команду.</strong> После успешного отбора вы получите доступ к системе «МедиаКод» и первые приветственные баллы медиаволонтёра!
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
                    {effectiveSlug === 'montage' && (
                      <div className="materials-btn-block" style={{ marginTop: '16px' }}>
                        <a
                          href="https://disk.360.yandex.ru/d/SGu5txgr6xDnZw"
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
                      <li>✦ Накопление баллов активности, электронная зачётка медиаволонтёра</li>
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
                          placeholder="Например: ИБС111"
                          value={groupName}
                          onChange={(e) => setGroupName(e.target.value)}
                        />
                        <small className="muted" style={{ display: 'block', marginTop: '4px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                          Укажите свою настоящую учебную группу.
                        </small>
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
                      <small className="muted" style={{ display: 'block', marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Номер телефона будет использоваться сотрудниками медиацентра для оперативной связи во время мероприятий
                      </small>
                      <div
                        className={`max-phone-check-card ${phoneIsMax ? 'active' : ''}`}
                        onClick={() => setPhoneIsMax(!phoneIsMax)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            setPhoneIsMax(!phoneIsMax);
                          }
                        }}
                      >
                        <input
                          type="checkbox"
                          id="phoneIsMax"
                          checked={phoneIsMax}
                          onChange={(e) => setPhoneIsMax(e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="max-phone-check-info">
                          <label htmlFor="phoneIsMax" className="max-phone-check-title" onClick={(e) => e.stopPropagation()}>
                            Этот номер телефона используется в Макс
                          </label>
                          <span className="max-phone-check-sub">
                            Если ваш Макс зарегистрирован на этот же номер, отметьте этот пункт.
                          </span>
                        </div>
                      </div>
                    </div>

                    {!phoneIsMax && (
                      <div className="form-group" style={{ marginTop: '12px' }}>
                        <label>Номер телефона, используемый в Макс <span className="required">*</span></label>
                        <input
                          type="tel"
                          value={maxContactPhone}
                          onChange={(e) => setMaxContactPhone(formatRussianPhoneInput(e.target.value))}
                          placeholder="+7 (900) 000-00-00"
                          className="input"
                          required
                        />
                        <small className="muted" style={{ display: 'block', marginTop: '4px' }}>Укажите другой номер телефона, на который зарегистрирован ваш аккаунт Макс.</small>
                      </div>
                    )}

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
                            ? 'Материалы задания: 10 фотографий JPEG *'
                            : effectiveSlug === 'smm'
                            ? 'Ответ на тестовое задание *'
                            : 'Материалы выполненного задания *'}
                        </label>
                        <span className="muted" style={{ fontSize: '12px' }}>
                          {submissionMethod === 'files'
                            ? (effectiveSlug === 'photo' ? 'Ровно 10 файлов JPEG' : 'Загрузка файла на сайт')
                            : submissionMethod === 'text'
                            ? 'Текст задания в форме'
                            : 'Ссылка на Яндекс Диск'}
                        </span>
                      </div>

                      {/* Method selector toggle */}
                      <div className="submission-method-toggle">
                        {(SUBMISSION_METHODS[effectiveSlug] || DEFAULT_SUBMISSION_METHODS).map((m) => {
                          const Icon = m.icon;
                          const isActive = submissionMethod === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              className={`submission-method-btn ${isActive ? 'active' : ''}`}
                              onClick={() => {
                                setSubmissionMethod(m.id);
                                setErrorMessage('');
                              }}
                            >
                              <Icon size={14} />
                              <span>{m.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* SMM: Primary Large Textarea (shown ONLY when method is 'text') */}
                      {effectiveSlug === 'smm' && submissionMethod === 'text' && (
                        <div className="form-group" style={{ marginTop: '12px' }}>
                          <label htmlFor="submissionText" style={{ fontSize: '13px', fontWeight: 600 }}>
                            Ответ на тестовое задание *
                          </label>
                          <textarea
                            id="submissionText"
                            rows="12"
                            className="submission-textarea"
                            style={{ fontFamily: 'inherit', lineHeight: 1.5, whiteSpace: 'pre-wrap', resize: 'vertical' }}
                            placeholder="1. Взаимодействие со студенческими организациями и клубами:&#10;План сбора инфоповодов...&#10;&#10;2. Визуальная концепция и стиль общения официального Телеграм-канала...&#10;&#10;3. Исправление неудачного поста...&#10;&#10;4. Освещение события: 10 лучших фото и 3 видеоролика...&#10;&#10;5. Интерактив и вовлечение для Телеграм-канала..."
                            value={submissionText}
                            onChange={(e) => setSubmissionText(e.target.value)}
                          />
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '11px', color: 'var(--muted)' }}>
                            <span>Сохраняются абзацы, списки, переносы строк и эмодзи ✨</span>
                            <span>{submissionText.length} знаков</span>
                          </div>
                        </div>
                      )}

                      {/* File Upload Dropzone (shown ONLY when method is 'files') */}
                      {submissionMethod === 'files' && (
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

                      {/* Yandex Link Input (shown ONLY when method is 'link') */}
                      {submissionMethod === 'link' && (
                        <div className="form-group" style={{ marginTop: '14px' }}>
                          <label htmlFor="submissionUrl" style={{ fontSize: '13px', fontWeight: 600 }}>
                            {effectiveSlug === 'photo'
                              ? 'Ссылка на папку с 10 фото на Яндекс Диске *'
                              : effectiveSlug === 'smm'
                              ? 'Ссылка на Яндекс Документ или папку на Яндекс Диске *'
                              : effectiveSlug === 'design'
                              ? 'Ссылка на папку с макетом на Яндекс Диске *'
                              : 'Ссылка на видео на Яндекс Диске *'}
                          </label>
                          <div className="url-input-wrap">
                            <LinkIcon size={16} className="url-icon" />
                            <input
                              id="submissionUrl"
                              type="url"
                              required
                              placeholder={effectiveSlug === 'photo' ? 'https://disk.yandex.ru/d/...' : 'https://disk.yandex.ru/...'}
                              value={submissionUrl}
                              onChange={(e) => setSubmissionUrl(e.target.value)}
                            />
                          </div>
                          <small className="muted" style={{ display: 'block', marginTop: '6px', fontSize: '11.5px', lineHeight: 1.4 }}>
                            {effectiveSlug === 'photo'
                              ? 'Загрузите ровно 10 отобранных кадров в папку на Яндекс Диске и укажите ссылку с открытым доступом.'
                              : effectiveSlug === 'smm'
                              ? 'Создайте документ в Яндекс Документах / Диске и укажите ссылку с открытым доступом на чтение.'
                              : effectiveSlug === 'design'
                              ? 'Загрузите макет (PNG, JPG или PDF) на Яндекс Диск и укажите ссылку с открытым доступом.'
                              : 'Загрузите готовый видеоролик на Яндекс Диск и укажите ссылку с открытым доступом.'}
                          </small>
                        </div>
                      )}

                      {/* Optional note (shown when method is NOT text) */}
                      {submissionMethod !== 'text' && (
                        <div className="form-group" style={{ marginTop: '14px' }}>
                          <label htmlFor="submissionNote" style={{ fontSize: '12px', fontWeight: 600 }}>
                            Пояснение к выполненному заданию (необязательно)
                          </label>
                          <textarea
                            id="submissionNote"
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
                            Я даю согласие на <a href="/privacy-policy" target="_blank" className="text-link inline-policy-btn" style={{ display: "inline" }} onClick={(e) => e.stopPropagation()}>обработку персональных данных</a> в целях участия в конкурсном отборе медиацентра «МедиаКод» *
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

          </div>
  );
}


