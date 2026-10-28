# MediaCode: пошаговая инструкция администратора

Обновление 29.10: для первой миграции утверждены Ubuntu 22.04 и Caddy. Актуальная настройка Tailscale OIDC, Environments, immutable subject и порядок PR описаны в [VAVILON_OIDC.md](VAVILON_OIDC.md). Раздел лаборатории ниже описывает прежний контейнер; настоящий systemd проверяется сценарием `deploy/vm/`.

Сейчас production не переносить и CD не включать. Начать с аудита и review. Отдельные разрешения нужны для правок systemd/proxy/SSH/firewall, переключения сайта и включения production CD.

## 1. GitHub: сначала выключатели

В репозитории Settings → Secrets and variables → Actions → Variables проверить существующие **repository variables**:

```text
CD_STAGING_ENABLED=false
CD_PRODUCTION_ENABLED=false
```

Отсутствующая переменная тоже выключает CD. Только точная строка `true` разрешает соответствующий job. Обычные PR/feature push никогда не деплоят. Lint, build, API/E2E tests, Gitleaks и audit выполняются независимо от этих выключателей.

Review-ветка `fix/safe-legacy-migration-20261027`, PR #5 уже создан в `ci/cd-ubuntu24`. Вручную review/merge #5 → проверить обновлённый #4 → подтвердить CD=false → вручную merge #4 в main → перенести workflow в dev → provisioning/manual check/staging CD → отдельный production cutover → отдельное включение production CD. Автоматического merge нет.

```bash
gh pr view 5 --repo ShaurmaClub/MediaCode
gh pr checks 5 --repo ShaurmaClub/MediaCode
```

## 2. Environments и SSH

Settings → Environments: `staging` и `production` уже созданы. Проверить required reviewers, запрет self-review при доступности настройки и branch rules: production только main, staging только dev. Если protection недоступна на текущем плане, оставить production CD выключенным до согласованного эквивалентного контроля.

Создать отдельные ключи на доверенной административной машине (не сохранять в Git):

```bash
umask 077
mkdir -p ~/.ssh/mediacode-deploy
ssh-keygen -t ed25519 -N '' -f ~/.ssh/mediacode-deploy/prod
ssh-keygen -t ed25519 -N '' -f ~/.ssh/mediacode-deploy/stage
```

После одобренного создания серверных пользователей установить только `.pub` в соответствующие `authorized_keys`. Папка `.ssh` 0700, файл 0600, владелец deploy-prod/deploy-stage. Приватные ключи никогда не копировать на сервер. Не применять SSH/UFW изменения без разрешения.

Через физическую консоль/уже доверенное админ-подключение получить:

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
sudo cat /etc/ssh/ssh_host_ed25519_key.pub
```

Из публичного ключа составить known_hosts: `HOST ssh-ed25519 PUBLIC_KEY`, а для нестандартного порта `[HOST]:PORT ssh-ed25519 PUBLIC_KEY`. Если использовали `ssh-keyscan`, сравнить fingerprint **с консолью**, а не доверять самому сканированию.

Помощник теперь требует существующие ключи и trusted fingerprint. Он проверяет настоящее SSH-подключение обеих учётных записей, затем (только с `--apply`) пишет secrets. При отклонённом ключе успех не сообщается; ключи не генерируются заново и не теряются при ошибке.

```bash
bash deploy/setup-github.sh --host HOST --port 22 \
  --prod-key ~/.ssh/mediacode-deploy/prod \
  --stage-key ~/.ssh/mediacode-deploy/stage \
  --known-hosts ~/.ssh/mediacode-deploy/known_hosts \
  --host-fingerprint SHA256:FINGERPRINT_FROM_CONSOLE --check
# После проверки Environments и отдельного решения записать секреты:
# та же команда с --apply вместо --check
```

Для `100.81.97.45` согласован GitHub-hosted runner с временным Tailscale OIDC-подключением. В каждом Environment добавить TS_OAUTH_CLIENT_ID/TS_AUDIENCE своей federated identity; legacy helper не настраивает trust и не заменяет ручной OIDC/SSH workflow. Следовать VAVILON_OIDC.md. Self-hosted runner и публичный SSH не использовать.

## 3. Secrets каждого Environment

| Secret | staging | production |
| --- | --- | --- |
| TS_OAUTH_CLIENT_ID | staging federated identity | production federated identity |
| TS_AUDIENCE | staging identity audience | production identity audience |
| SSH_HOST | доступный именно runner адрес | доступный именно runner адрес |
| SSH_PORT | подтверждённый SSH порт | подтверждённый SSH порт |
| SSH_USER | deploy-stage | deploy-prod |
| SSH_PRIVATE_KEY | содержимое stage private key | содержимое prod private key |
| SSH_KNOWN_HOSTS | проверенная запись host key | проверенная запись host key |
| DEPLOY_PATH | /opt/mediacode/staging | /opt/mediacode/production |
| SERVICE_NAME | mediacode-stage | mediacode-prod |
| HEALTHCHECK_URL | https://stage.kaiton.ru/api/health/ready | https://kaiton.ru/api/health/ready |

Уведомления при необходимости: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_THREAD_ID` или `ALERT_WEBHOOK_URL`. Использовать отдельного оповещающего бота, не SESSION_SECRET или runtime токены сайта. Отсутствующие notifications secrets означают, что внешний канал доставки не проверен. В этой задаче реальные уведомления не отправлялись.

## 4. Старый сервер: read-only → пробная миграция

Полные команды в `MIGRATE_EXISTING.md`. Сначала `inspect-legacy.sh`, затем `migrate-existing.sh --dry-run`. Разработку и npm ci запускать в отдельном review-каталоге, не в `/srv/services/MediaCode`.

`--apply` создаёт только приватные копии. Сохранить SESSION_SECRET. Проверить WAL-backup, uploads, manifests и пробную схему. Выгрузить bundle в зашифрованное внешнее хранилище и реально восстановить оттуда. Для публичного staging использовать только синтетические/обезличенные данные.

На Vavilon лаборатория находится в отдельном контейнере без опубликованных портов и без production mount. Пример воспроизведения на сервере из review-checkout:

```bash
docker build -t mediacode-migration-lab:ubuntu24 -f deploy/lab/Dockerfile deploy/lab
task_lab_source=$(mktemp -d /tmp/mediacode-lab-source.XXXXXX)
git archive HEAD | tar -x -C "$task_lab_source"
docker run --rm --cpus=2 --memory=3g --pids-limit=384 \
  --mount type=bind,src="$task_lab_source",dst=/source,readonly \
  mediacode-migration-lab:ubuntu24 bash -lc \
  'cp -a /source/. /lab/; cd /lab; git init -q; git config user.email lab@example.invalid; git config user.name Lab; git add .; git commit -qm lab; git -c core.autocrlf=false checkout-index -af; MEDIACODE_LAB_ACK=disposable bash deploy/lab/run.sh'
```

Сначала закоммитить reviewed изменения: `git archive HEAD` включает только commit, а не незакоммиченный diff. Он не должен содержать production `.env`, data/uploads или node_modules. Контейнер тестирует реальные Node/SQLite/Nginx/SSH процессы, но systemctl заменён локальным контроллером: это не проверка настоящего systemd sandbox.

## 5. Переключение

Использовать отдельный чек-лист из `MIGRATE_EXISTING.md`, раздел 5. Ubuntu 22.04 и Caddy сохраняются. Не вызывать clean installer на Vavilon. После явного разрешения остановить старого writer, создать финальный согласованный snapshot и offsite backup, перенести данные в пустой production root с правильными правами, сохранить исходные файлы, мигрировать целевую БД и запустить новый unit на 127.0.0.1:4000. Caddy остаётся на том же upstream-порту.

Проверки:

```bash
sudo systemctl status mediacode-prod.service
sudo journalctl -u mediacode-prod.service --since '-5 minutes' --no-pager
curl -fsS http://127.0.0.1:4000/api/health/ready
curl -fsS https://kaiton.ru/api/health/ready
curl -I https://kaiton.ru/
curl -I https://www.kaiton.ru/
```

Проверить `commit` равен согласованному SHA, `db=ok`, `schemaCompatible=true`, `frontendReady=true`. Затем login, роли, списки/файлы, сохранность записей и запрет прямого `/uploads/`. Не выводить ответы с персональными данными в общие логи.

## 6. Включение CD

Staging — после своего provisioning и manual OIDC/SSH probe из реального runner.
Production — только после отдельного успешного cutover и приёмки:

1. Отдельно разрешить staging CD и установить `CD_STAGING_ENABLED=true`.
2. Выполнить согласованный push в dev, проверить backup → deploy → readiness → уведомление и сценарий отката.
3. После отдельного разрешения администратора установить `CD_PRODUCTION_ENABLED=true` и проверить deployment из main с required review.

Отключить production CD одной настройкой: `CD_PRODUCTION_ENABLED=false`. Для staging — свой флаг. CI продолжает работать. Уже запущенный job флаг автоматически не останавливает: отменить его отдельно; сначала определить, не находится ли он в процессе переключения/rollback.

```text
PR/feature push ──> security + lint/build + API/E2E ──> review
dev push  + staging flag=true   ──> staging Environment ──> SSH
main push + production flag=true ──> production approval ──> SSH
SSH ──> prepare immutable SHA ──> stop writer ──> final backup
    ──> migrate ──> atomic current switch ──> readiness/HTTPS ──> notification
failure ──> read-only compatibility check ──> previous code ──> readiness
        └─> incompatible/rollback failed: code 31, operator recovery, data retained
```

## 7. Rollback и restore

Для штатного отката к проверенному предыдущему SHA использовать `remote-deploy.sh` с теми же путями/правами, что в Actions; он не пересобирает уже готовый релиз. Самый безопасный управляемый путь — отдельный ручной job/административная команда с выбранным reviewed SHA и проверкой совместимости. Production CD предварительно выключить. Не выполнять reset/clean в активном релизе.

```bash
sudo bash /opt/mediacode/production/current/deploy/restore.sh --env=production --list
sudo bash /opt/mediacode/production/current/deploy/restore.sh --env=production --backup=BACKUP_ID --test-restore
# Восстановление БД означает потерю записей после снимка: отдельное разрешение.
sudo bash /opt/mediacode/production/current/deploy/restore.sh --env=production --backup=BACKUP_ID --confirm
```

Если safety backup не удался — остановиться. Не использовать `--allow-no-safety-backup` без отдельного решения. Подробный откат первого переноса и предупреждения о новых записях — в `MIGRATE_EXISTING.md`.
