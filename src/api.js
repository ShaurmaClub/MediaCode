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

const FRONTEND_SKILL_ALIASES = [
  ['photography', 'фотография фото фотограф фотосъемка'],
  ['фотография', 'photography фото фотограф фотосъемка'],
  ['interviewing', 'интервью корреспондент репортаж'],
  ['интервью', 'interviewing корреспондент'],
  ['video', 'видеосъемка видео видеограф'],
  ['видеосъемка', 'video видео видеограф'],
  ['editing', 'монтаж видеомонтаж монтажер'],
  ['монтаж', 'editing видеомонтаж монтажер'],
  ['design', 'дизайн графический дизайнер'],
  ['дизайн', 'design графический дизайнер'],
  ['smm', 'смм соцсети копирайтинг'],
  ['смм', 'smm соцсети копирайтинг'],
  ['content', 'контент ведущий корреспондент копирайтинг'],
  ['контент', 'content ведущий корреспондент']
];

export function normalizeSearchText(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

export function matchesSearch(query, ...fields) {
  const normQuery = normalizeSearchText(query);
  if (!normQuery) return true;

  const rawParts = fields.filter(f => f !== null && f !== undefined && f !== '').map(String);
  if (rawParts.length === 0) return false;

  let haystack = normalizeSearchText(rawParts.join(' '));
  for (const [trigger, expansion] of FRONTEND_SKILL_ALIASES) {
    if (haystack.includes(trigger)) {
      haystack += ' ' + expansion;
    }
  }

  const compactHaystack = haystack.replace(/[\s\-().+_@«»"'/\\,:;]/g, '');
  const rawDigitsList = rawParts.map(p => p.replace(/\D/g, '')).filter(Boolean);
  const expandedDigits = [...rawDigitsList];
  for (const d of rawDigitsList) {
    if (d.length === 11 && d.startsWith('7')) expandedDigits.push('8' + d.slice(1));
    else if (d.length === 11 && d.startsWith('8')) expandedDigits.push('7' + d.slice(1));
  }
  const digitsHaystack = expandedDigits.join(' ');

  const rawQueryTrimmed = String(query).trim();
  if (/^[+\d()\-\s]{3,}$/.test(rawQueryTrimmed)) {
    const qDigits = rawQueryTrimmed.replace(/\D/g, '');
    if (qDigits.length >= 3) {
      const altDigits = qDigits.startsWith('8') && qDigits.length >= 4
        ? '7' + qDigits.slice(1)
        : (qDigits.startsWith('7') && qDigits.length >= 4 ? '8' + qDigits.slice(1) : null);
      if (digitsHaystack.includes(qDigits) || (altDigits && digitsHaystack.includes(altDigits))) {
        return true;
      }
    }
  }

  const tokens = normQuery.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (haystack.includes(token)) continue;
    const cleanToken = token.replace(/^[@#«»"']+|[@#«»"']+$/g, '');
    if (cleanToken && haystack.includes(cleanToken)) continue;
    const compactToken = cleanToken.replace(/[\s\-().+_@«»"'/\\,:;]/g, '');
    if (compactToken.length >= 2 && compactHaystack.includes(compactToken)) continue;
    if (/^[+\d()\-]+$/.test(cleanToken)) {
      const tDigits = cleanToken.replace(/\D/g, '');
      if (tDigits.length >= 3) {
        const tAlt = tDigits.startsWith('8') && tDigits.length >= 4
          ? '7' + tDigits.slice(1)
          : (tDigits.startsWith('7') && tDigits.length >= 4 ? '8' + tDigits.slice(1) : null);
        if (digitsHaystack.includes(tDigits) || (tAlt && digitsHaystack.includes(tAlt))) continue;
      }
    }
    return false;
  }

  return true;
}
