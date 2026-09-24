export async function api(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchOptions = {
    credentials: 'include',
    ...options,
    headers
  };

  const res = await fetch('/api' + url, fetchOptions);

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка при выполнении запроса');
  }
  return data;
}

export function formatDate(val) {
  if (!val) return '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return val;
  }
}

export function formatDateTime(val) {
  if (!val) return '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return val;
  }
}

export function relativeTime(val) {
  if (!val) return '';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'только что';
    if (minutes < 60) return `${minutes} мин. назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч. назад`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} дн. назад`;
    return formatDate(val);
  } catch {
    return '';
  }
}

export const THEMES = [
  { id: 'system', name: 'Системная', desc: 'Автоматически по настройкам ОС' },
  { id: 'dark', name: 'Тёмная', desc: 'Основной глубокий ночной стиль' },
  { id: 'light', name: 'Светлая', desc: 'Классический чистый стиль' },
  { id: 'violet', name: 'Фиолетовая', desc: 'Фирменный медиа-акцент' },
  { id: 'red', name: 'Красная', desc: 'Энергичный рубиновый стиль' }
];
