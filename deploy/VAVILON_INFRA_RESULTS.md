# Vavilon CI/CD: проверка инфраструктуры 29.10.2026

## Статус и границы

Подготовка кода для PR #5 → `ci/cd-ubuntu24`. Merge #5/#4, provisioning рабочего
хоста, изменение production permissions, first cutover и включение CD **не выполнены**.
Первая миграция сохраняет Ubuntu 22.04, Caddy и обычный OpenSSH через Tailscale.

GitHub API подтвердил `CD_STAGING_ENABLED=false`, `CD_PRODUCTION_ENABLED=false`.
Оба PR открыты, #5 остаётся draft. Полный OIDC exchange к реальному tailnet пока
**не проверен**: нужны администраторские trust identities, secrets и разрешённый
provisioning. Unit/static tests не выдаются за проверку federation.

## Реальная VM, а не systemctl shim

На Vavilon создан только новый изолированный контроллер
`mediacode-systemd-vm-20261029`, без опубликованных портов и production mounts.
Внутри QEMU/KVM: **Ubuntu 22.04.5 LTS, systemd 249.11-0ubuntu3.23, Node v22.23.4**,
PID 1 = systemd; 2 vCPU, 3 GiB guest RAM, qcow2 14 GiB. Контроллер ограничен 4 GiB.
Jammy cloud image и Node tarball сверены с официальными checksum-файлами по HTTPS.
Host key guest задаётся до первого pinned SSH. Все БД, env и ключи синтетические.

Воспроизведение: [vm/README.md](vm/README.md). Результаты сценариев:

| Проверка | Результат |
| --- | --- |
| provisioning `--check`, отказ `--apply` при открытом legacy | PASS, без автоматического chmod |
| Явное закрытие синтетического legacy, apply и повторный apply | PASS |
| Четыре пользователя, группы, narrow sudoers, scoped sshd policy | PASS |
| stage не читает legacy/prod и не останавливает prod | PASS |
| Настоящий SSH `id -un` как deploy-prod | PASS |
| Чужой аккаунт / случайный private key / подменённый host key | Отказ, PASS |
| systemd ProtectSystem=strict, ProtectHome, NoNewPrivileges | PASS |
| Запись в data внутри sandbox / запрет в код и соседний env | PASS |
| SIGKILL → автоматический Restart, journalctl, stop/start | PASS |
| Повтор здорового SHA и нормальный deploy от непривилегированного deploy-prod | 0, SHA совпадает |
| previous ln / previous mv / current ln / current mv | 21, previous восстановлен и здоров |
| systemctl stop (однократный отказ) | 21, прежний сервис остаётся здоров |
| systemctl restart (однократный отказ) | 30, previous восстановлен |
| Новый релиз не проходит readiness | 30, previous здоров |
| Запись после final backup, затем rollback кода | Запись сохранена; DB restore отсутствует |
| БД недоступна после остановки writer | EMERGENCY 31, данные не перезаписаны |
| Schema user_version=99 | EMERGENCY 31, данные не перезаписаны |
| Отказ всех restart / отказ всех healthcheck | EMERGENCY 31 |
| Посторонний synthetic legacy unit | MainPID сохранён |

Fault-wrapper меняет только выбранный вызов в guest PATH; остальные systemctl/ln/mv
реальные. Fault-инъекции выполняются root в VM; обычное переключение и повтор SHA
отдельно выполнены настоящим deploy-prod через реальные sudoers.

## Приложение и workflow

- `npm ci` из lockfile с приватным перенесённым npm cache, **offline**; никакого
  изменения версий/lockfile и `npm audit fix --force`. Сетевой npm install в госте
  сначала зависал, поэтому остановлен до повторного install; параллельные установки
  не использовались для окончательного результата.
- better-sqlite3 пересобран из исходников под guest Node 22 с его headers.
- `npm run lint`: 0 errors, 26 существующих warnings; новых warning в deploy-коде нет.
- `npm run build`, `test:security`, `test:dist`: PASS.
- `npm test`: **66 PASS, 0 FAIL** (включая новые private-route/permission/gate тесты).
- Все `deploy/*.sh`, `deploy/vm/*.sh`: `bash -n` PASS.
- actionlint **1.7.7** для обоих workflow, с отключённым внешним shellcheck: PASS;
  скачанный официальный архив сверён с release checksums.
- Gitleaks, production npm audit и E2E также выполняются GitHub CI на каждом push;
  результаты конкретного коммита смотреть в PR checks. Секреты для CD не нужны.

Второй повтор VM-теста обнаружил коллизию старого fixture в публичном `/tmp`;
baseline перенесён в приватный `/root/mediacode-lab-baseline.db`. После очистки
только синтетических fixtures окончательный `vm-tests-v3.log` завершился кодом 0.

Приватные журналы на сервере:
`/home/no1se/mediacode-infra-review-20261029/` (0700), без публикации private keys/env.
Окончательный VM log `vm-tests-v3.log`:
SHA-256 `b766b69930d67fb9adaa99dc272264fbc446bc2006fa57dd990738d6ff8e1b6b`.
Application test log `vm-tests-final.log` содержит 66 PASS и остановку на старом
fixture; это не итоговый успешный VM log. Первый полный fault-прогон также был успешен
(`vm-tests-v2.log`), но обычный deploy там выполнялся root; итоговый v3 закрывает это.

## Повторная read-only проверка production

Рабочий checkout `/srv/services/MediaCode` чистый, SHA
`94313bc15027cf0c5358399b61f82d119e587faf`.

| Сервис | MainPID | Активен с (MSK) |
| --- | --- | --- |
| mediacode.service | 184745 | 19.10.2026 11:46:05 |
| caddy.service | 36461 | 22.09.2026 21:38:50 |
| argus.service | 173390 | 16.10.2026 00:47:14 |
| kait20-telegram.service | 173393 | 16.10.2026 00:47:14 |

Все активны, PID соответствуют исходному аудиту. HTTP legacy на 127.0.0.1:4000 → 200.
Три рабочих bot-контейнера продолжают работать. Четыре новых аккаунта на хосте
отсутствуют; `/etc/ssh/mediacode-deploy.conf` не установлен. Host provisioning не было.

**Оставшийся блокер:** legacy `.env` 0664, БД 0644, корень/uploads 0775, owner no1se.
Новые stage-пользователи получили бы доступ к production через world permissions.
План исправления есть в [VAVILON_OIDC.md](VAVILON_OIDC.md), автоматически не применён.

## Что дальше

**Готово:** OIDC v4 workflow/private route guards, безопасный manual SSH check,
check/apply provisioning, recovery после stop, VM fault tests, Ubuntu 22/Caddy
cutover checklist, администраторская инструкция и этот отчёт.

**Ждёт администратора:** review/merge PR в указанной последовательности, две
Tailscale federated identities и узкие grants, GitHub Environment protection/secrets,
проверка фактического OIDC subject через claims-only, затем реальный manual network
check, внешнее зашифрованное хранилище и restore на другом хосте, пользовательская
приёмка login/session/RBAC/files. В VM не использовались настоящие логины/токены.

**Нужно отдельное разрешение production:** закрытие legacy permissions, применение
provisioning (создание пользователей/sshd reload/sudoers), новые unit/configuration,
финальный backup и cutover. Включение каждого CD-флага — отдельное решение после
соответствующей приёмки. Ни одно из этих действий не было выполнено.
