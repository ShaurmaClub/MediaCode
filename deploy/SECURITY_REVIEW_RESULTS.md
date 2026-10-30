# PR #5: Security Hardening & Safe Deployment — результаты

## Final security review — 30.10.2026

Исходная проверенная точка: `1bdbf05`,
[baseline CI 40887330430](https://github.com/ShaurmaClub/MediaCode/actions/runs/40887330430).
Ниже старые результаты относятся к baseline, не заменяют проверку новых изменений.

| Замечание | Решение | Новые доказательства |
| --- | --- | --- |
| P1 Unix groups | Избыточное membership подтверждено и удалено в provisioning/installer; отдельные code groups, upgrade существующих users без restart | Real own/cross env/DB/WAL/SHM/uploads/backups denials, metadata/ACL matrix, legacy membership retry при живом PID, fresh staging |
| P1 data/uploads inventory | Пропуск ссылок подтверждён и исправлен; точный type/absolute target своего Environment, без чтения target | 12 замен в unit и 12 в настоящем active release, exit 21 без ремонта, прежний PID/data/inventory |
| P2 partial provisioning | Усилено: phase diagnostics, config prevalidation/effective admin policy, SSH rollback на обычную ошибку, safe retry/manual recovery | 10 faults: users/groups/dirs/keys/broker/sudoers/SSH candidate/publish/validation/reload; настоящий admin SSH после отказов/повторов |
| P2 active-SHA health | Ошибка fail-open не подтвердилась: existing `pipefail` корректен; менять успешный путь не нужно | 7 реальных HTTP/curl отказов, включая валидный JSON + truncated transfer; каждый exit 21, без restart/backup/link/data updates |

Перечень новых/изменённых implementation/test файлов: `unix-access.sh`, `install.sh`,
`provision-vavilon.sh`, `release-integrity.mjs`, `remote-deploy.sh`,
`vm/{prepare-ci.sh,prepare-guest.sh,scenarios.mjs,unix-access-scenarios.mjs,
health-scenarios.mjs,health-fixture.py,provision-scenarios.mjs,provision-fault.sh,
provision-install-faults.py}`, `tests/release-hardening.test.js`, `.github/workflows/ci.yml`.
Обновлены SECURITY_MODEL, этот отчёт, DEVOPS_QUICKSTART и MIGRATE_EXISTING.
Broker и service units менять не потребовалось: их UID/GID drop/umask/sandbox сохранены.

Итоговая Unix-матрица и точные migration/recovery ограничения приведены в
[SECURITY_MODEL.md](SECURITY_MODEL.md#unix-группы-и-прямой-файловый-доступ-final-review).
Источник полного CI именно финального HEAD — [PR #5 checks](https://github.com/ShaurmaClub/MediaCode/pull/5/checks).
Обязательные проверки: 72 unit/integration, 8 E2E, 49 privilege negatives, 42 Unix
access denials, 12 external-link mutations, 7 health faults, 10 provisioning faults,
live group upgrade, data/code ACL rejection, прежний recovery matrix и fresh staging.
Локально Bash/Python/Node syntax PASS;
Windows symlink fixture получает EPERM, Linux tests не пропускаются и не ослабляются.

VM fixture явно нормализует inherited runner ACL только внутри synthetic roots/frozen
input и исправляет mode собственного runner sudoers на 0440 без изменения правил.
После этого full `visudo -c` и no-ACL assertions обязательны. Отдельно инъецируются
неожиданные ACL state/code roots: production scripts обязаны отказать, сохранить ACL
для ручного review и не перезапустить приложение. Они не удаляют ACL автоматически.
Старое runtime membership само по себе не обходило state root 0700: это проверяется
прямыми отказами чтения env/DB до удаления membership. Исправлена избыточная привилегия,
а не заявлена доказанная утечка старых секретов.

Ограничения: deploy по-прежнему контролирует собственный runtime через код; cached
groups требуют новой SSH-сессии; старый inventory fail closed без inplace upgrade;
SIGKILL/power loss и отказ SSH rollback требуют console/manual recovery. Никаких
подключений к Vavilon, production изменений, merge, изменений Environments/Secrets/
Variables/ACL/OIDC или включения CD в этой задаче не выполнялось.

## Архив предыдущего раунда — 29.10.2026

Следующие CI counts и SSH timeouts — исторические, не действия final review 30.10.
Только ветка `fix/safe-legacy-migration-20261027`, без merge #4/#5,
применения на Vavilon и включения CD. Все новые данные/ключи в испытаниях синтетические.

## Подтверждено и исправлено

1. Broad sudo `/usr/bin/env`, `/usr/bin/node`, `/bin/test` действительно присутствовал
   в provisioning и clean installer. Заменён root-owned broker с ограниченным API.
2. В исходном для этой задачи `b1ea8c3` уже отсутствовал rsync в remote-deploy;
   active SHA имел no-op guard. Повторно подтверждать уже устранённый баг не стали.
   Оставшаяся слабая проверка inactive release и отсутствие content inventory исправлены.
3. Deploy-owned authorized_keys мог изменять сам deploy. Scoped sshd теперь использует
   root-owned `/etc/ssh/mediacode-keys/%u`, разные approved Ed25519 keys и запрещает
   user rc. Домашний authorized_keys не даёт возможности добавить общий ключ.
4. Cleanup теперь удаляет только созданный этим процессом temporary каталог и обычные
   SHA-директории вне current/previous/сохранённого active. Caller artifact не удаляется
   по произвольному пути. Clean installer тоже не перезаписывает найденный release.

## Основные файлы

- `deploy/remote-deploy.sh`, `release-integrity.mjs`: read-only reuse, inventory,
  canonical roots, pre-stop policy gate, atomic publish/recovery и bounded cleanup.
  Integrity CLI установлен в fixed admin-owned path; Actions stdin transport
  (`bash -s` без исходного filename/repo cwd) проверяется отдельным VM assertion.
- `deploy/mediacode-ops.py`: fixed operations, SUDO_UID/contour/argc/SHA/path validation,
  root-owned closure, clean environment, сброс UID/GID/groups и umask перед Node.
- `deploy/install-runtime-ops.py`: проверка trusted source **до Python import**,
  complete helper closure comparison при повторе, атомарная установка broker/sudoers,
  candidate visudo до замены, проверка Node 22. Без root npm/download.
- `deploy/provision-vavilon.sh`, `install.sh`, `restore.sh`, оба runtime unit:
  удалены broad grants, root-owned deploy public keys, restore admin-only, umask 0077.
- `deploy/vm/{prepare-ci.sh,scenarios.mjs,security-scenarios.mjs,fault-command.sh}`,
  `tests/release-hardening.test.js`, `.github/workflows/ci.yml`: настоящий systemd job
  и тесты; CD зависит также от его успеха, новый job не получает OIDC/secrets/Environment.
- Quickstart, migration/OIDC instructions, architecture и LAB_RESULTS ссылаются на
  [SECURITY_MODEL.md](SECURITY_MODEL.md), где описаны provisioning/rollback/границы доверия.

## Модель привилегий и важное ограничение

Deploy sudo разрешает только `/usr/local/sbin/mediacode-ops` своего Environment.
Произвольные env/node/sh/test/systemctl, runtime sudo и destructive restore не выданы.
Broker выполняет миграции/backup из admin-owned helper, не из deploy-writable release;
не принимает команды, shell fragments или filesystem paths. Его closure/Node/parents
не writable deploy/runtime. Код application unit работает непривилегированным runtime.

**Deploy всё ещё контролирует собственный application runtime**, потому что публикует
его код и может перезапустить unit. Он способен прочитать secrets своего приложения
через этот код. Полной изоляции deploy от своего runtime не заявляется. Cross-contour
доступ и произвольное root sudo не предоставлены. Inventory — детектор повреждения,
не подпись против владельца release.

Изменения approved migration-кода требуют отдельного admin helper review/update;
обычные frontend/API commits с прежней migration revision идут без interactive sudo.
Неизвестная revision блокируется до stop. Автоматическое пересечение разных revisions
не реализовано: перед такой миграцией нужен отдельный maintenance/rollback план.

## Повтор SHA

Здоровый active SHA: inventory + approved policy + systemd/readiness → exit 0,
без backup/restart/link/content updates. Повреждённый active или inactive SHA: exit 21,
файлы сохраняются, inplace repair отсутствует. Даже ещё живой здоровый process не
скрывает повреждение dist/dependencies. Recovery выполняется отдельным проверенным
релизом с admin review; единственная копия не удаляется. После cutover ошибки и TERM
возвращают verified previous или EMERGENCY 31; БД при откате кода не восстанавливается.

## Доказательства

Полный успешный прогон реализации:
[Actions 40884873663](https://github.com/ShaurmaClub/MediaCode/actions/runs/40884873663),
коммит `db1825f`. Финальный HEAD после дополнительных проверок установщика и расширения
synthetic data assertions также обязан иметь зелёные PR checks; источник актуального
результата — [PR #5 checks](https://github.com/ShaurmaClub/MediaCode/pull/5/checks).

| Проверка | Результат |
| --- | --- |
| Shell syntax + Python AST, ESLint, production build | PASS |
| Security/lockfile guardrails, Gitleaks/history, production npm audit | PASS |
| Unit/integration suite | **71 PASS, 0 FAIL** |
| Playwright E2E | **8 PASS** |
| Real negative sudo/filesystem assertions | **49 PASS**, оба направления |
| Real Ubuntu VM | Ubuntu **22.04**, systemd **249.11-0ubuntu3.23**, Node **22.23.4**, PID1=systemd |
| Provisioning check, legacy gate, distinct-key gate, apply и повтор apply | PASS |
| Actual SSH correct/wrong account/key/host key | PASS |
| systemd sandbox, разрешённая запись data/запрет кода/другого env, journal, SIGKILL Restart | PASS |
| Active healthy SHA no-op, active damaged SHA, inactive reuse/damage/symlink replacement | PASS |
| Prepare failure | 21, прежний сервис/данные сохранены |
| previous ln/mv, current ln/mv, stop, restart, TERM | **7 сценариев + 7 успешных повторов** |
| Readiness failure после новой записи | rollback 30, новая запись сохранена |
| DB unavailable, future schema, restart-all, health failures | **4 × EMERGENCY 31**, без DB restore |
| Cleanup keep=1 | current и previous сохранены |
| Full staging existing synthetic artifact | deploy-stage → broker → migrations → systemd/readiness PASS |
| Fresh staging preparation | local Git → offline lockfile/native install → CI dist → inventory → backup → atomic switch → readiness PASS |

VM job работает на отдельной GitHub-hosted VM, **не** в Docker/systemctl shim и не на
Vavilon; тип стандартного ubuntu-22.04 runner описан в
[официальной документации GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Перед privileged test код/dependencies замораживаются root-owned, credentials checkout
не сохраняются. Job отвергает self-hosted runner, неверную ОС и PID1. Нет Tailscale,
server keys, host volumes или реальных пользовательских данных. SSH проверяется
внутри VM; это не проверка GitHub → Tailscale → Vavilon.

Fault-инъекция меняет отдельный client-side вызов; installed broker не подменяется и
test bypass не имеет. Проверяются не только exit codes: release inventory, symlinks,
unit PID/active state, SQLite integrity/данные, env/uploads hashes и permissions.
Для окончательного HEAD fixtures включают synthetic user/task/application/points.
Корректность actual OIDC federation и настоящего password login здесь не заявляется.

Промежуточные красные прогоны выявили проблемы **лабораторной совместимости**:
избыточные filesystem проверки/timeout, Node binary path на hosted runner, umask
родительского helper каталога после privilege drop, PATH для runuser. Они исправлены;
настоящий systemd job теперь обязателен для CD. Ни один тест не выполнялся на production.

## Vavilon и действия администратора

На Vavilon в этой задаче изменений не выполнялось. Два SSH connect timeout не дали
получить новый read-only service audit; прежние PID нельзя выдавать за свежую проверку.
Никаких обходных способов доступа/применения не использовалось. GitHub API подтвердил
оба CD variables `false`; оба deploy job пропущены. PR #4/#5 не объединялись.

Сейчас администратору нужно только review PR: дополнительно применять ничего не надо.
Для будущего разрешённого внедрения: повторный root audit legacy permissions и общих
sudo rules, закрытие legacy data после отдельного разрешения, approved frozen helper,
validate sudoers/sshd и оба направления отрицательных probes, Tailscale identities/
Environment protection/secrets и manual connectivity. Затем отдельно offsite encrypted
backup + restore на другом хосте, acceptance и cutover. CD-флаги включаются только
после отдельного решения. Откат provisioning описан в SECURITY_MODEL.md; broad grants
или world-readable secrets при rollback не восстанавливать.

**Готовность:** код готов к review/merge при зелёных checks финального HEAD и одобрении
этой модели migration approval. PR оставлен draft, merge не выполнен. Применение на
Vavilon не готово автоматически: перечисленные административные gates остаются.
