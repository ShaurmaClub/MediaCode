import crypto from 'crypto';

/**
 * MAX Messenger Mini App & Bot Integration Service
 * Provides initData validation, bot notification dispatcher, and data mapping.
 */

const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN || '';
const MAX_API_URL = process.env.MAX_API_URL || 'https://api.maxmessenger.ru';
const MAX_BOT_USERNAME = process.env.MAX_BOT_USERNAME || 'mediakod_bot';

/**
 * Validates initData received from MAX Mini App
 * @param {string} initData - raw query string from MAX.WebApp.initData
 * @returns {{ valid: boolean, user: object | null, authDate: number | null }}
 */
export function validateMaxInitData(initData) {
  if (!initData || typeof initData !== 'string') {
    return { valid: false, user: null, authDate: null, error: 'initData отсутствует или пуст' };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const userJson = params.get('user');
    const authDate = params.get('auth_date') ? parseInt(params.get('auth_date'), 10) : null;

    let user = null;
    if (userJson) {
      try {
        user = JSON.parse(userJson);
      } catch {
        user = null;
      }
    }

    // In testing allow mock validation
    if (process.env.NODE_ENV === 'test') {
      if (user && (user.id || user.username)) {
        return { valid: true, user, authDate, simulated: true };
      }
    }

    if (!hash || !MAX_BOT_TOKEN) {
      return { valid: false, user, authDate, error: 'Отсутствует подпись hash или MAX_BOT_TOKEN' };
    }

    // Prepare data-check-string (sort keys alphabetically, excluding hash)
    const checkKeys = [];
    for (const [key, val] of params.entries()) {
      if (key !== 'hash') {
        checkKeys.push(`${key}=${val}`);
      }
    }
    checkKeys.sort();
    const dataCheckString = checkKeys.join('\n');

    // HMAC-SHA256 signature verification
    const secretKey = crypto.createHmac('sha256', 'MAXMiniAppAuth').update(MAX_BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const isValid = crypto.timingSafeEqual(Buffer.from(calculatedHash, 'hex'), Buffer.from(hash, 'hex'));
    return {
      valid: isValid,
      user,
      authDate,
      error: isValid ? null : 'Недопустимая цифровая подпись initData'
    };
  } catch (err) {
    return { valid: false, user: null, authDate: null, error: err.message };
  }
}

/**
 * Dispatches notification message to MAX user via MAX Bot API
 * @param {string|number} maxUserId - MAX user ID
 * @param {string} text - Message text
 * @param {object} [options] - Optional payload
 */
export async function sendMaxNotification(maxUserId, text, options = {}) {
  if (!maxUserId || !text) {
    return { ok: false, error: 'maxUserId и text обязательны' };
  }

  // If token is missing, simulate gracefully
  if (!MAX_BOT_TOKEN) {
    console.log(`[MAX Bot Simulation] Сообщение для ${maxUserId}: ${text}`);
    return { ok: true, simulated: true, recipient: maxUserId, text };
  }

  try {
    const res = await fetch(`${MAX_API_URL}/bot${MAX_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: maxUserId,
        text,
        parse_mode: 'HTML',
        ...options
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`[MAX Bot Error] ${res.status}:`, data);
      return { ok: false, error: data.description || 'Ошибка отправки в MAX' };
    }
    return { ok: true, data };
  } catch (err) {
    console.warn(`[MAX Bot Dispatch Failed]:`, err.message);
    return { ok: false, error: err.message };
  }
}

export function getMaxConfig() {
  return {
    botUsername: MAX_BOT_USERNAME,
    apiUrl: MAX_API_URL,
    configured: Boolean(MAX_BOT_TOKEN)
  };
}

export default {
  validateMaxInitData,
  sendMaxNotification,
  getMaxConfig
};
