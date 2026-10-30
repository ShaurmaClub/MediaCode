# Лаборатория и статус подготовки

Security hardening повторно проверен в новом CI job `systemd-security`
на настоящей одноразовой Ubuntu 22.04 VM GitHub-hosted, без Vavilon connection,
Environment secrets или OIDC. Старые результаты ниже относятся к прежней модели
sudo; текущие результаты/ограничения перечисляются отдельно в SECURITY_MODEL.md
и [SECURITY_REVIEW_RESULTS.md](SECURITY_REVIEW_RESULTS.md). Для применения нужны
зелёные checks именно финального HEAD, не исторического commit.

Дополнение 29.10.2026: настоящая Ubuntu 22.04 + systemd/KVM и fault-injection
проверены отдельно: [VAVILON_INFRA_RESULTS.md](VAVILON_INFRA_RESULTS.md).
Ниже — прежний контейнерный прогон; его shim не доказывает systemd sandbox.

Дата: 28.10.2026. Работа выполнена в review-ветке от `ci/cd-ubuntu24`, без merge и без переключения production. Основная лаборатория размещена **на Vavilon**, а не на ноутбуке.

## Окружение и границы

Контейнер `mediacode-migration-lab-20261028`: Ubuntu 24.04.5, Node.js v22.23.4, npm 10.9.9; лимиты 2 CPU, 3 ГБ RAM, 384 PID. Порты на host не публиковались; production данные в этот контейнер не монтировались. Node, SQLite, Nginx и sshd запускались как реальные процессы. Внутри лаборатории `systemctl` заменялся контроллером процессов с guard `/.dockerenv`; это **не тест настоящего systemd/init, его sandbox или перезагрузки**.

Отдельный краткоживущий контейнер проверки реальных данных запускался с `--network none`, `--read-only`, UID 1000, production mount read-only и отдельным private output. Его копии не использовались как staging и не публиковались.

## Результаты

| Проверка | Результат |
| --- | --- |
| Чистый npm ci / production build | успешно; после разового пропуска optional native binding выполнена чистая переустановка из lockfile и подтверждена воспроизводимая сборка |
| ESLint | 0 ошибок, 26 предупреждений в существующем коде |
| Bash/shellcheck | shellcheck `-S error` для deploy/*.sh и deploy/lab/*.sh прошёл |
| API/auth/RBAC/reliability/CI/migration tests | 63/63, 9 suites, без skipped |
| Матрица CD gates | оба job: отсутствующий/false/невалидный flag, PR/manual/feature/main/dev; только push правильной ветки с точным `true` разрешён |
| Playwright Chromium | 8/8: guest, student, staff, admin, навигация, history/reload, две вкладки |
| Секреты/lockfile/слабый SESSION_SECRET | test:security успешно |
| Frontend secrets/source maps | test:dist успешно, 20 ассетов |
| npm audit production | 0 уязвимостей; обновлены совместимые версии в lockfile, без --force |
| Gitleaks v8.30.1 | reviewed source snapshot: no leaks; 88 коммитов полученной истории, включая refs: no leaks |
| Старая схема | фикстура из реального старого коммита 94313bc с синтетическими данными: WAL snapshot, sessions, env, uploads и миграция прошли |
| Новая установка | install.sh отработал внутри Ubuntu 24.04 контейнера с заменённым service controller |
| Повтор установки | успешно, checksum существующего `.env` сохранился |
| Разделение контуров | runtime-stage не читает prod env; deploy-stage не читает prod DB; runtime-stage не пишет prod code |
| Private uploads | Nginx возвращает 404; backend также блокирует `/uploads` без зависимости от нового proxy |
| Повторный SHA | hash файлов активного релиза до/после одинаковый; без rebuild/restart/правок metadata |
| Новый релиз | реальный npm ci, миграция, atomic current, readiness: успешно от deploy-prod |
| Сбой зависимостей | code 21, current остаётся на рабочем релизе |
| Сбой SQLite migration | code 21, совместимая предыдущая версия поднимается |
| Сбой readiness | code 30, автоматический rollback на previous |
| Сбой rollback | code 31; сохранены БД/uploads, проверено ручное восстановление процесса |
| Сбой pre-deploy backup | code 20, деплой заблокирован |
| Сбой pre-restore backup | code 20 до остановки сервиса; после ошибки сайт доступен |
| Backup/restore uploads | проверены реальные синтетические PDF через API, checksum DB, тест восстановления и полное восстановление файлов/БД |
| Полный restore через shell | успешно, readiness после остановки/старта процесса |
| SSH secrets validation | корректные параметры приняты, invalid port и missing secrets отклонены без вывода значений |
| SSH установка ключей | настоящий sshd :2222 внутри контейнера: обе deploy-учётки; неверный fingerprint и отсутствующий authorized key отклонены |
| SSH deploy | remote-deploy.sh передан через настоящий SSH от deploy-prod, повторный SHA успешно проверен |

## Пробная миграция настоящих данных

Приватный bundle на сервере:

```text
/home/no1se/mediacode-migration-review-20261028/private/production-trial-20261028
```

Production read-only snapshot: schema user_version 0 → trial schema 3. Сохранились 87 пользователей, 18 задач, 34 заявки и 28 записей баллов. Проверены `PRAGMA integrity_check`, online WAL backup, отдельное восстановление, хеши uploads, копия исходного `.env` и неизменность SESSION_SECRET. Поведенческий probe подтвердил readiness, совместимость SQLite-сессии с сохранённым секретом, `/auth/me` и 404 для uploads. Синтетическая probe-сессия создавалась только в trial; пароль реального пользователя не использовался. Логин по паролю и пользовательская приёмка остаются ручными проверками.

Это online-подготовка, а не финальный согласованный снимок DB+uploads. Перед разрешённым переключением нужен новый backup после остановки старого writer. OffsiteProtected не заявлен: внешнее хранилище не задано и restore с другого хоста не выполнялся.

## Созданные файлы

- `LEGACY_AUDIT.md` — фактическая диагностика Vavilon.
- `deploy/inspect-legacy.sh` — read-only сбор метаданных без значений env.
- `deploy/migrate-existing.sh`, `deploy/migrate-existing.mjs` — dry-run / подготовка private bundle и пробной схемы.
- `deploy/probe-prepared.mjs` — локальная поведенческая проверка trial-копии.
- `deploy/validate-secrets.sh` — проверка параметров и SSH-материала без вывода секретов.
- `deploy/MIGRATE_EXISTING.md` — перенос, rollback и отдельный production checklist.
- `deploy/DEVOPS_QUICKSTART.md` — GitHub, keys, environments, порядок включения CD.
- `deploy/LAB_RESULTS.md` — этот отчёт.
- `deploy/lab/Dockerfile`, `run.sh`, `systemctl.sh`, `scenarios.mjs` — воспроизводимая Ubuntu 24.04 лаборатория и fault injection.
- `tests/deployment-safety.test.js`, `tests/migration-preparation.test.js` — CD gates, read-only guards, explicit paths и WAL/session preservation.

## Изменённые файлы

- `.github/workflows/ci.yml` — CD выключен без точных repository flags, CI продолжает работать; secrets validation.
- `deploy/remote-deploy.sh` — неизменяемый active SHA, runtime group, согласованные sudo unit names, lock в контуре, stop writer перед миграцией, final backup, atomic links, readiness без обязательных demo data, read-only rollback guard и external readiness.
- `deploy/setup-github.sh` — существующие независимые keys, trusted fingerprint, настоящий SSH обеих учёток до GitHub writes; обе CD variables false.
- `deploy/restore.sh` — fail-closed safety backup и обязательный service controller; явное отдельное рискованное override.
- `deploy/install.sh` — guard для legacy/Caddy/других proxy/контейнеров, Node 22, stop в изолированном sudoers.
- `server/migrate.js` — rollback inspection не применяет миграции.
- `server/backup.js` — backup CLI не применяет миграции к источнику.
- `server/app.js` — запрет прямого `/uploads` в приложении.
- `tests/cicd_deploy.test.js` — проверка запрета реального загруженного файла без авторизации через static path.
- `eslint.config.js` — Node globals для deploy/*.mjs.
- `package-lock.json` — совместимые security updates.
- `README.md`, `deploy/INSTALL.md` — вход в документацию существующего production.

## Что осталось до разрешения production

1. Review и CI именно на итоговом PR; не мержить автоматически. Администратор должен проверить Environments и оставить CD flags false.
2. Согласовать 22.04/Caddy против целевых 24.04/Nginx. Никакого upgrade ОС/смены proxy в этой задаче не выполнялось.
3. На VM проверить настоящий systemd hardening, provisioning и reboot. Container controller не доказывает это.
4. Настроить зашифрованное offsite storage и проверить восстановление с другого хоста.
5. Проверить сеть **из настоящего GitHub Actions runner**; лабораторный localhost SSH этого не доказывает. Не открывать UFW/SSH автоматически.
6. До размещения staging на host устранить широкие legacy permissions по отдельному разрешению.
7. Проверить реальный login/пользовательские сценарии на приватной копии, провести приёмку и согласовать окно остановки записи.
8. Получить явное разрешение на provisioning/cutover; после этого выполнить раздел 5 `MIGRATE_EXISTING.md`.
9. Отдельно разрешить сначала staging CD, затем production CD. Реальный внешний канал notifications ещё не проверен.

Production остаётся в `/srv/services/MediaCode`, `mediacode.service`, исходный Caddy, SHA 94313bc. Не выполнялись merge, deployment enable, изменения host units/UFW/SSH/TLS, остановка боевого процесса или запись в боевую БД.
