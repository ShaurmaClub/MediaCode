#!/usr/bin/env node
/**
 * Универсальный скрипт отправки уведомлений CI/CD и мониторинга (Telegram + Webhook).
 *
 * Поддерживаемые типы событий (CI_EVENT_TYPE или вычисляется из CI_STATUS / CI_STAGE):
 *   - staging-success      : Успешное обновление staging
 *   - production-success   : Успешное обновление production
 *   - ci-failure           : Ошибка CI (тесты / безопасность / сборка)
 *   - cd-failure           : Ошибка CD (деплой прерван)
 *   - rollback-success     : Выполнен автоматический rollback
 *   - rollback-failure     : КРИТИЧЕСКИЙ ИНЦИДЕНТ: Неудачный rollback
 *   - backup-failure       : Ошибка резервного копирования
 *   - outage               : Критическая недоступность приложения
 */
import path from 'path';
import { fileURLToPath } from 'url';

const EVENT_TITLES = {
  'staging-success': '✅ МедиаКод: Успешное обновление Staging (stage.kaiton.ru)',
  'production-success': '✅ МедиаКод: Успешное обновление Production (kaiton.ru)',
  'ci-failure': '🚨 МедиаКод: Ошибка CI — деплой заблокирован',
  'cd-failure': '🚨 МедиаКод: Ошибка CD — обновление не выполнено',
  'rollback-success': '⏪ МедиаКод: Сбой новой версии — выполнен автоматический Rollback',
  'rollback-failure': '🔥 КРИТИЧЕСКИЙ ИНЦИДЕНТ МедиаКод: Ошибка автоматического Rollback!',
  'backup-failure': '⚠️ МедиаКод: Ошибка резервного копирования (деплой заблокирован)',
  outage: '🔥 МедиаКод: Критическая недоступность сервиса на сервере',
};

// Санитизация текста уведомления, чтобы в него никогда не попали секреты, токены или ПДн
export function sanitizeText(input) {
  if (!input) return '';
  let text = String(input)
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED_KEY]')
    .replace(/-----BEGIN [^-]+-----/g, '[REDACTED_KEY]')
    .replace(/\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g, '[REDACTED_BOT_TOKEN]')
    .replace(/\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/g, '[REDACTED_GH_TOKEN]')
    .replace(/(SESSION_SECRET|PASSWORD|TOKEN|KEY|SECRET)\s*=\s*[^\s,;]+/gi, '$1=[REDACTED]');

  for (const envKey of ['SESSION_SECRET', 'TELEGRAM_BOT_TOKEN', 'SSH_PRIVATE_KEY', 'RESTIC_PASSWORD']) {
    const val = process.env[envKey];
    if (val && val.length >= 8) {
      text = text.split(val).join('[REDACTED]');
    }
  }
  return text.slice(0, 800);
}

export function buildAlertPayload(overrides = {}) {
  const status = (overrides.status || process.env.CI_STATUS || 'failure').toLowerCase();
  const eventType = (overrides.eventType || process.env.CI_EVENT_TYPE || '').toLowerCase();
  const environment =
    overrides.environment ||
    process.env.DEPLOY_ENV ||
    process.env.CI_ENVIRONMENT ||
    (process.env.GITHUB_REF_NAME === 'main'
      ? 'production'
      : process.env.GITHUB_REF_NAME === 'dev'
        ? 'staging'
        : 'ci');
  const stage = overrides.stage || process.env.CI_STAGE || 'CI/CD Pipeline';
  const rawDetails = overrides.failedSteps || process.env.CI_FAILED_STEPS || process.env.CI_REASON || '';
  const repo = overrides.repo || process.env.GITHUB_REPOSITORY || 'ShaurmaClub/MediaCode';
  const branch = overrides.branch || process.env.GITHUB_REF_NAME || 'local';
  const fullSha = overrides.sha || process.env.TARGET_SHA || process.env.GITHUB_SHA || 'local';
  const shortSha = fullSha.slice(0, 7);
  const actor = overrides.actor || process.env.GITHUB_ACTOR || 'system';
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const runId = process.env.GITHUB_RUN_ID || '';
  const runUrl = runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : `${serverUrl}/${repo}`;

  const details = sanitizeText(rawDetails);
  const isSuccess = status === 'success' || eventType.endsWith('-success');

  const title =
    EVENT_TITLES[eventType] ||
    (isSuccess ? `✅ МедиаКод: Успешно (${stage})` : `🚨 МедиаКод: СБОЙ (${stage})`);

  const messageLines = [
    title,
    '',
    `• Окружение: ${environment}`,
    `• Версия (SHA): ${shortSha} (ветка ${branch})`,
    `• Результат: ${isSuccess ? 'SUCCESS' : status.toUpperCase()}`,
    `• Этап: ${stage}`,
    `• Инициатор: ${actor}`,
    details ? `• Причина / детали: ${details}` : null,
    runId ? `• GitHub Actions Run: ${runUrl}` : null,
  ].filter(Boolean);

  const plainText = messageLines.join('\n');

  return {
    title,
    status,
    eventType,
    environment,
    stage,
    repo,
    branch,
    shortSha,
    actor,
    details,
    runUrl,
    isSuccess,
    plainText,
  };
}

async function sendTelegram(alert) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const threadId = process.env.TELEGRAM_THREAD_ID;

  if (!token || !chatId) {
    console.log('ℹ️ [NOTIFY] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы — пропуск отправки в Telegram.');
    return;
  }

  const payload = {
    chat_id: chatId,
    text: alert.plainText,
    disable_web_page_preview: true,
  };
  if (threadId && String(threadId).trim()) {
    payload.message_thread_id = Number(threadId);
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`⚠️ [NOTIFY] Ошибка отправки алерта в Telegram (HTTP ${res.status})`);
  } else {
    console.log('✅ [NOTIFY] Уведомление успешно отправлено в Telegram.');
  }
}

async function sendWebhook(alert) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('ℹ️ [NOTIFY] ALERT_WEBHOOK_URL не задан — пропуск отправки Webhook.');
    return;
  }

  let body;
  if (webhookUrl.includes('discord.com/api/webhooks')) {
    body = {
      content: alert.plainText,
      embeds: [
        {
          title: alert.title,
          color: alert.isSuccess ? 0x2ecc71 : 0xe74c3c,
          fields: [
            { name: 'Окружение', value: alert.environment, inline: true },
            { name: 'Версия (SHA)', value: `\`${alert.shortSha}\` (\`${alert.branch}\`)`, inline: true },
            { name: 'Результат', value: alert.isSuccess ? 'SUCCESS' : alert.status.toUpperCase(), inline: true },
            ...(alert.details ? [{ name: 'Причина / детали', value: alert.details, inline: false }] : []),
          ],
          url: alert.runUrl,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  } else if (webhookUrl.includes('hooks.slack.com')) {
    body = { text: alert.plainText };
  } else {
    body = {
      project: 'MediaCode',
      eventType: alert.eventType || (alert.isSuccess ? 'success' : 'failure'),
      environment: alert.environment,
      status: alert.isSuccess ? 'success' : alert.status,
      stage: alert.stage,
      repository: alert.repo,
      branch: alert.branch,
      commit: alert.shortSha,
      actor: alert.actor,
      reason: alert.details || null,
      runUrl: alert.runUrl,
      message: alert.plainText,
      timestamp: new Date().toISOString(),
    };
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`⚠️ [NOTIFY] Ошибка отправки Webhook (HTTP ${res.status})`);
  } else {
    console.log('✅ [NOTIFY] Уведомление успешно отправлено через Webhook.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const alert = buildAlertPayload();
    console.log('\n=== СВОДКА ОПОВЕЩЕНИЯ CI/CD ===');
    console.log(alert.plainText);
    console.log('===============================\n');
    await Promise.allSettled([sendTelegram(alert), sendWebhook(alert)]);
  } catch (err) {
    console.error('⚠️ [NOTIFY] Непредвиденная ошибка при отправке уведомления:', err.message);
  }
  process.exit(0);
}
