#!/usr/bin/env node
/**
 * Универсальный скрипт отправки алертов CI/CD (Telegram + Discord/Slack/Custom Webhook).
 * Использует встроенный fetch (Node.js 20+), не требует сторонних зависимостей.
 *
 * Переменные окружения:
 * - CI_STATUS: "success" | "failure" | "cancelled"
 * - CI_STAGE: "tests" | "deploy-staging" | "deploy-production"
 * - CI_FAILED_STEPS: строка со статусами джобов
 * - TELEGRAM_BOT_TOKEN: токен Telegram-бота (опционально)
 * - TELEGRAM_CHAT_ID: ID чата/группы в Telegram (опционально)
 * - TELEGRAM_THREAD_ID: ID ветки/топика супергруппы в Telegram (опционально)
 * - ALERT_WEBHOOK_URL: URL вебхука Discord / Slack / любого кастомного сервиса (опционально)
 */

const status = (process.env.CI_STATUS || 'failure').toLowerCase();
const stage = process.env.CI_STAGE || 'CI/CD Pipeline';
const details = process.env.CI_FAILED_STEPS || '';
const repo = process.env.GITHUB_REPOSITORY || 'ShaurmaClub/MediaCode';
const branch = process.env.GITHUB_REF_NAME || 'unknown';
const sha = (process.env.GITHUB_SHA || '').slice(0, 7) || 'local';
const actor = process.env.GITHUB_ACTOR || 'unknown';
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const runId = process.env.GITHUB_RUN_ID || '';
const runUrl = runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : `${serverUrl}/${repo}`;

const isSuccess = status === 'success';
const icon = isSuccess ? '✅' : '🚨';
const title = isSuccess
  ? `${icon} МедиаКод: успешный деплой (${stage})`
  : `${icon} МедиаКод: СБОЙ CI/CD (${stage}) — деплой остановлен`;

const messageLines = [
  title,
  '',
  `• Репозиторий: ${repo}`,
  `• Ветка: ${branch} (${sha})`,
  `• Автор пуша: ${actor}`,
  `• Этап: ${stage}`,
  details ? `• Детали этапов: ${details}` : null,
  `• Логи запуска: ${runUrl}`
].filter(Boolean);

const plainText = messageLines.join('\n');

async function sendTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const threadId = process.env.TELEGRAM_THREAD_ID;

  if (!token || !chatId) {
    console.log('ℹ️ [NOTIFY] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы — пропуск отправки в Telegram.');
    return;
  }

  const payload = {
    chat_id: chatId,
    text: plainText,
    disable_web_page_preview: true
  };
  if (threadId && String(threadId).trim()) {
    payload.message_thread_id = Number(threadId);
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`⚠️ [NOTIFY] Ошибка отправки алерта в Telegram (${res.status}): ${errText}`);
  } else {
    console.log('✅ [NOTIFY] Алерт успешно отправлен в Telegram.');
  }
}

async function sendWebhook() {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('ℹ️ [NOTIFY] ALERT_WEBHOOK_URL не задан — пропуск отправки Webhook.');
    return;
  }

  let body;
  if (webhookUrl.includes('discord.com/api/webhooks')) {
    body = {
      content: plainText,
      embeds: [
        {
          title,
          color: isSuccess ? 0x2ecc71 : 0xe74c3c,
          fields: [
            { name: 'Ветка / Коммит', value: `\`${branch}\` (\`${sha}\`)`, inline: true },
            { name: 'Автор', value: actor, inline: true },
            { name: 'Этап', value: stage, inline: true },
            ...(details ? [{ name: 'Статусы проверок', value: details, inline: false }] : [])
          ],
          url: runUrl,
          timestamp: new Date().toISOString()
        }
      ]
    };
  } else if (webhookUrl.includes('hooks.slack.com')) {
    body = { text: plainText };
  } else {
    body = {
      project: 'MediaCode',
      status,
      stage,
      repository: repo,
      branch,
      commit: sha,
      actor,
      details,
      runUrl,
      message: plainText,
      timestamp: new Date().toISOString()
    };
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`⚠️ [NOTIFY] Ошибка отправки Webhook (${res.status}): ${errText}`);
  } else {
    console.log('✅ [NOTIFY] Алерт успешно отправлен через Webhook.');
  }
}

try {
  console.log('\n=== СВОДКА ОПОВЕЩЕНИЯ CI/CD ===');
  console.log(plainText);
  console.log('===============================\n');
  await Promise.allSettled([sendTelegram(), sendWebhook()]);
} catch (err) {
  console.error('⚠️ [NOTIFY] Непредвиденная ошибка при отправке уведомления:', err.message);
}
