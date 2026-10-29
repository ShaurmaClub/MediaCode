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

## Повтор SHA и повреждение

Релиз получает `.release-inventory.json` только в новом staging-каталоге. Inventory
покрывает код, dist, dependencies, metadata; data/uploads не читает. При reuse сравнивается
полное содержимое и типы; code symlinks не могут выходить из release root. Это детектор
повреждения, **не подпись** от злонамеренного владельца release: deploy может менять
и код, и inventory. Авторство/review обеспечивает GitHub, не JSON manifest.

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
