# Deploy privileges and immutable releases (PR #5)

## Scope

Это изменение исходников для review. Никакого применения на Vavilon, merge #4/#5,
изменения host production/staging, CD flags или сетевых настроек оно не разрешает.
Испытания используют только синтетические данные в одноразовой Ubuntu 22.04 VM.

## Подтверждённые проблемы

- Старые provisioning и clean installer давали deploy универсальные sudo env/node/test
  от имени runtime. Они удалены в обоих путях установки.
- Deploy-owned authorized_keys позволял самостоятельно менять список допущенных
  ключей. Scoped policy теперь читает ровно один admin-approved ключ каждого
  аккаунта из root-owned `/etc/ssh/mediacode-keys/%u`; домашний authorized_keys не используется.
- В текущем HEAD исходного PR (`b1ea8c3`) пути `rsync --delete` уже не было: повтор
  здорового активного SHA являлся no-op. Однако существующий неактивный релиз проверялся
  только по marker/index, без проверки остальных файлов. Это усилено inventory.
- В старой модели нельзя было объявлять deploy изолированным от runtime своего контура:
  он управлял кодом, исполняемым unit. Эта граница доверия сохраняется и документируется.

## Новая модель

### Unix-группы и прямой файловый доступ (final review)

Членство deploy в runtime-группе не нужно: deploy владеет кодом и публикует его
с группой `mediacode-code-prod` / `mediacode-code-stage`. В code-группу входят только
соответствующие deploy и runtime. Provisioning и clean installer удаляют только
устаревшее supplementary membership deploy в `mediacode-prod` / `mediacode-stage`.
Чужие неожиданные группы provisioning не исправляет молча, а блокирует apply.
Само старое membership не доказывало утечку: state root 0700 и private files 0600
уже закрывали прямое чтение в проверенной модели. Удаление группы — least-privilege hardening.

Одинаковая матрица для обоих контуров; «чужой» означает соседний Environment:

| Объект | root | свой deploy | свой runtime | чужие deploy/runtime |
| --- | --- | --- | --- | --- |
| Код/release 0750, файлы 0640/0750, deploy:code-group | RW | RW, publisher | R/X, без W | нет |
| `.env`, DB/WAL/SHM, uploads files, backups files 0600 runtime:runtime | RW | нет прямого доступа | RW | нет |
| State root 0700 runtime:runtime | RWX | нет traversal | RWX | нет traversal |
| Data/uploads/backups subdirs 0750 или строже | RWX | нет traversal через state root | RWX | нет |
| `current`/`previous` symlink | admin | переключение внутри своего code root | readlink/traversal, без замены | нет traversal |
| Prepare temporary dir 0700, файлы 0600 до publish | admin | RW | нет до публикации | нет |
| Broker/helpers/sshd/sudoers/unit | admin RW | только fixed broker API | только read/execute где разрешено | без W |

Права 0777 самого symlink не дают доступ к закрытому target: проверяются права
родителей и target. Extended/default ACL на state root, env, DB/WAL/SHM и data/uploads/
backups roots блокируют provisioning **до изменений** и требуют ручного review.
На existing code roots ACL проверяется до chmod/install; у новых roots также
проверяется результат наследования ACL. Неожиданный ACL блокирует apply, а не стирается.
Это не обещание автоматического аудита каждого вложенного произвольного upload:
граница прямого deploy-доступа — закрытый state root. Новые файлы runtime/broker
создаются с umask 0077; ACL и метаданные конкретных synthetic файлов проверяет VM.

При upgrade старые code parents и releases с runtime-группой сохраняются:
deploy остаётся их владельцем, runtime читает через свою primary group, уже живой
процесс не теряет доступ из-за cached supplementary groups. Новые releases получают
code-group; systemd при штатном старте получает актуальные группы из NSS. Provisioning
не перезапускает приложение. После изменения membership открыть новую deploy SSH-сессию
перед сборкой/публикацией; удаление группы из NSS не отзывает её у старой сессии.
State root 0700 сохраняет запрет прямого чтения даже у старой deploy-сессии.
Не делать рекурсивный chgrp/chmod существующего current ради этой миграции.

Эта матрица описывает **прямой filesystem access**, не изоляцию от собственного
приложения: publisher может выполнить свой код как собственный runtime (см. ниже).

### Ограниченный broker

Система хранит `/usr/local/sbin/mediacode-ops` (root:root 0755), helpers в
`/usr/local/lib/mediacode-ops/{production,staging}` и отдельный root-owned Node binary
`/usr/local/libexec/mediacode-node`. Родительские каталоги root-owned и не доступны
на запись группе/остальным. Helpers содержат reviewed server/shared/scripts,
package.json и замороженные готовые dependencies. Пакеты/lifecycle не запускаются root.

Deploy может вызывать **только свой** broker как root, не env/node/test/systemctl
напрямую. Wildcard в sudoers передаёт аргументы Python-программе, не shell. Broker
заново проверяет точное число аргументов, Environment, операцию, SHA и SUDO_UID.

| Операция | Аргументы | Что выполняется |
| --- | --- | --- |
| exists-env / exists-db | только contour | проверка типа/owner/mode, без чтения env |
| policy | contour + 40 lowercase hex SHA | проверка пути и совпадения migration-кода с admin helper |
| backup-predeploy / backup-final | contour + SHA | trusted backup.js как runtime своего контура |
| migrate / verify-rollback | contour + SHA | trusted migrate.js как runtime своего контура |
| stop / start / restart / is-active | только contour | фиксированный systemctl и точный собственный unit |

Broker никогда не запускает JS/конфигурацию из release. Его cwd, Python/Node,
module closure, environment/path и CLI фиксированы. Нельзя передать shell, URL,
произвольный filesystem path, NODE_OPTIONS/LD_PRELOAD, ../, дополнительный аргумент
или соседний Environment. UID/GID/groups сбрасываются перед Node; umask 0077.
env/DB/uploads/backups имеют канонические пути; ссылки/неправильные owner/mode
отвергаются. Runtime-код не исполняется root. Секреты/вывод дочерних процессов
не выводятся broker'ом; ошибки дают безопасную общую диагностику.

Integrity CLI тоже устанавливается администратором в фиксированный read-only путь
`/usr/local/libexec/mediacode-release-integrity.mjs`. Remote deploy не зависит от
имени исходного файла или cwd: поддерживается используемый Actions SSH `bash -s`.

### Честная граница доверия

**Deploy всё ещё контролирует runtime СВОЕГО контура через код приложения и restart.**
Он может поставить в server/index.js код, который прочитает собственные runtime secrets
или изменит собственную БД. Broker не является sandbox для недоверенного application
publisher. Его задача — убрать произвольный sudo и root/cross-contour пути и не
исполнять изменяемые deploy'ем миграции привилегированной операцией.

Поэтому production deploy key/approved branch/reviewer защищаются как полномочия
production runtime. Ни одному Environment не выдаются ключи/секреты другого.
Root/admin и сам runtime остаются доверенными в своём контуре. Защита от злонамеренного
root, kernel exploit, supply-chain reviewed dependencies или одновременной админской
подмены helper не заявляется.

## Migration approval и совместимость

Release `server/db.js`, `server/migrate.js`, `server/config/schema.js` должны точно
совпадать с admin helper. Иначе policy блокирует deploy **до stop**. Обычные изменения
frontend/API с прежним migration-кодом не требуют изменения helper и деплоятся без
интерактивного sudo. Новый migration-код требует отдельного admin review/update helper.
Не разрешать CD самостоятельно обновлять helper ради обхода этого gate.

При изменении схемы сначала спланировать backup/rollback и совместимый набор approved
helpers; текущий broker намеренно не поддерживает автоматический переход между разными
migration revisions. Если previous не соответствует approved helper или схема ему
несовместима, recovery завершается 31. Это fail-closed ограничение, не обещание отката
любых будущих schema migrations. First cutover тоже остаётся отдельной admin-операцией.

`migrate-existing.sh` остаётся подготовкой приватной копии, без sudo deploy;
`restore.sh` теперь явно admin-only. Destructive restore не выдан deploy через broker.
SSH/secret validators/OIDC/manual workflow не получили дополнительных полномочий.

## Подготовка и provisioning (ТОЛЬКО после отдельного разрешения)

1. Сначала root read-only check legacy permissions. Не создавать stage, пока legacy
   env/DB/uploads доступны посторонним. Автоматического chmod legacy нет.
2. На изолированной машине собрать reviewed source + dependencies без секретов.
   Нельзя исполнять npm lifecycle от root. Проверить SHA/dependency lock/checksums,
   ABI Node 22/better-sqlite3. Перенести в новый **root-owned frozen snapshot**;
   каждый файл/родитель не writable deploy/runtime. Не использовать mutable deploy checkout.
3. `--runtime-source /secure/frozen-snapshot` обязателен для apply; installer проверяет
   всю helper closure и родительские каталоги. Программа не выполняет npm или download.
4. Перед применением сохранить приватные copies/owner/mode/ACL текущих sudoers, sshd
   config/include, unit files и список users/groups. Сначала VM-прогон точно этой версии.
5. Provisioning вызывает `install-runtime-ops.py`: candidate sudoers проходит `visudo -cf`
   **до установки**, установленный файл заменяется атомарно. Все новые accounts,
   группы и helper paths проверяются отдельно. Изменяющийся existing helper не
   перезаписывается автоматически: update требует явного решения администратора.
6. После одобренного apply: `sudo visudo -c`, `sudo sshd -t`, `sudo -l -U deploy-prod`
   и `sudo -l -U deploy-stage`, оба направления отрицательных sudo/SSH/secret probes.
   Не закрывать действующую admin SSH-сессию до проверки независимого входа.

### Откат provisioning

Только администратор в согласованное окно: выключить CD, проверить отсутствие deploy
и остановить доступ deploy-ключами (не рабочее приложение). Отозвать новые sudo grants;
вернуть **проверенные безопасные** прежние правила из private backup, validate `visudo -c`.
Не восстанавливать прежние broad env/node grants: безопасный откат — CD остаётся
выключенным, deploy sudo отсутствует, приложение продолжает работать.

SSH include/config возвращать из сохранённых copies только после diff/review,
`sshd -t` до reload и независимой проверки admin login. Если меняли только sudo/helper,
SSH reload не нужен. Не удалять runtime users, данные, releases, unit или каталоги,
пока ими пользуется приложение. Helper/Node snapshots можно оставить root-owned для
аудита; удаление — отдельное разрешение с точными путями. Restore старых world-readable
legacy permissions не является безопасным откатом.

Provisioning не транзакционный: частичная ошибка может оставить подготовленные
accounts/directories/helpers, но не выдаёт broad sudo и не переключает приложение.
После ошибки сохранить лог, проверить состояние и выполнить review до повторного apply.

Каждый отказ сообщает `phase=...` и exit code. Candidate sshd проходит `sshd -t`,
а effective policy для root/no1se/runner/ubuntu сравнивается до/после до установки.
Scoped Match касается только deploy; для нового include явно устанавливается `Match all`.
Перед заменой SSH files сохраняются приватные copies; при обычной shell-ошибке на
установке/validation/reload исходные файлы возвращаются, проходят `sshd -t` и reload.
Если rollback/reload сам не удался, держать admin session/console открытой и исправить
конфиг вручную; успешный автоматический возврат не заменяет проверку второго входа.
SIGKILL/потеря питания не покрываются EXIT trap. Не удалять частично созданные users
или state: проверить метаданные, `visudo -c`, `sshd -t`, независимый admin login,
устранить причину и повторить тот же approved apply. Broker/sudoers публикуются
атомарно после candidate validation, root-only `.next` не даёт временных grants.

## Повтор SHA и повреждение

Релиз получает `.release-inventory.json` только в новом staging-каталоге. Inventory
покрывает код, dist, dependencies, metadata; data/uploads не читает. При reuse сравнивается
полное содержимое и типы; code symlinks не могут выходить из release root. Это детектор
повреждения, **не подпись** от злонамеренного владельца release: deploy может менять
и код, и inventory. Авторство/review обеспечивает GitHub, не JSON manifest.

Корневые `data` и `uploads` не пропускаются без проверки: обязательны именно symlink
с точной абсолютной целью `/var/lib/mediacode/{production|staging}/{data|uploads}`
своего Environment. В inventory записаны тип и текст цели; содержимое target не
читается и не stat'ится. Missing/file/directory/foreign/outside/relative replacements
блокируются, в том числе после создания inventory. Релизы со старым форматом inventory
не переписываются: они fail closed при reuse; нужен новый approved release/recovery.

Active-SHA health-check уже использовал `pipefail`: refused/timeout/HTTP error/empty/
invalid JSON/wrong commit и curl error после валидного JSON дают exit 21, не успех.
Успешная семантика no-op не менялась; отдельная loopback HTTP VM-fixture проверяет
все семь отказов с сохранением PID, inventory, links, backups и synthetic business data.

- Active healthy SHA + inventory/policy/readiness → 0, без backup, restart, link/content changes.
- Active damaged/unhealthy SHA → 21 с диагностикой; даже если старый process ещё жив,
  его файлы не чинятся и не удаляются. Оставить сервис в найденном состоянии.
- Existing inactive SHA reuse только после inventory/policy; повреждённый каталог
  остаётся нетронутым. Никакого rsync/install/npm в существующем release.
- Ошибка prepare не останавливает старый сервис. После stop все обрабатываемые
  отказы/TERM/INT идут через recovery; совместимый previous + readiness → 20/21/30,
  иначе EMERGENCY 31. БД при code rollback никогда не восстанавливается.
- Prune разрешён только для обычных SHA-каталогов, не current/previous/сохранённого
  до cutover active. Temporary-каталог удаляется только если создан этим запуском.

При повреждении администратор сначала сохраняет failed release/DB/uploads/env и
диагностику; выбирает проверенный отдельный SHA или новый recovery artifact вне
active/previous; проверяет schema и новый каталог, затем согласует переключение.
Не переписывать тот же SHA, не удалять единственную копию, не выполнять git reset/rsync
в current. SIGKILL, авария kernel/power-loss не могут быть пойманы shell trap:
после них проверить unit/current/schema вручную; автоматический DB restore запрещён.
