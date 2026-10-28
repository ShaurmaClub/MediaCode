# Vavilon: действия администратора в Tailscale и GitHub

Архитектура первой миграции согласована: **Ubuntu 22.04 + Node 22 + systemd + SQLite + действующий Caddy**. OpenSSH остаётся обычным SSH с отдельными Ed25519-ключами. Публичный SSH, Tailscale SSH, upgrade ОС и замена proxy не нужны.

Реализация основана на официальных документах:

- https://tailscale.com/docs/integrations/github/github-action
- https://tailscale.com/docs/features/workload-identity-federation
- https://docs.github.com/en/actions/reference/security/oidc
- https://raw.githubusercontent.com/tailscale/github-action/v4/action.yml

## 1. GitHub: оставить CD выключенным

Repository variables `CD_STAGING_ENABLED=false`, `CD_PRODUCTION_ENABLED=false`. Они уже созданы администратором; код не меняет их значения. Environments `staging` и `production` уже существуют.

Environment deployment branch rules: staging **только dev**, production **только main**. Production — required reviewers и запрет self-review при поддержке плана. Ветка с workflow должна пройти review и обязательные security/build/integration checks. Не разрешать секреты/ручной network-check на PR/feature-ветках.

## 2. Tailscale: две независимые federated identities

В Trust credentials → Credential → OpenID Connect создать отдельную identity на staging и production:

| Параметр | staging | production |
| --- | --- | --- |
| Issuer | `https://token.actions.githubusercontent.com` | тот же |
| Scope | `auth_keys` | `auth_keys` |
| Единственный node tag | `tag:mediacode-ci-stage` | `tag:mediacode-ci-prod` |
| Custom claim ref | `refs/heads/dev` | `refs/heads/main` |
| Custom claim environment | `staging` | `production` |
| Custom claim repository_id | `1379985703` | `1379985703` |
| Custom claim repository_owner_id | `242012393` | `242012393` |

IDs получены из GitHub metadata. Перед настройкой сверить их и фактический `sub`. Client ID/Audience каждой identity записать в **соответствующий Environment**, не в общие repository secrets. Не использовать OAuth client secret/auth key как fallback. Action v4 самостоятельно обменивает GitHub OIDC JWT и создаёт временную node.

Теги создать в tailnet policy с tagOwners у администраторов. Добавить только разрешение CI-tags → **100.81.97.45 tcp:22**. Не назначать серверу новый tag автоматически: это может изменить его доступ к другим приложениям. Проверить все существующие grants/ACL, потому что разрешения объединяются; широкое старое правило может сделать новый узкий grant недостаточным. Проверить policy tests: CI не должен получать доступ к портам 4000/4001, Caddy admin 2019, Ollama 11434, другим узлам или подсетям. Сетевой grant к общему SSH-порту не разделяет Unix-аккаунты — их разделяют разные Ed25519-ключи и sudoers.

## 3. Проверить настоящий subject без публикации токена

Для новых репозиториев GitHub может использовать immutable IDs. **Кандидаты, не готовые trust rules**:

```text
repo:ShaurmaClub@242012393/MediaCode@1379985703:environment:staging
repo:ShaurmaClub@242012393/MediaCode@1379985703:environment:production
```

Не копировать эти строки вслепую и не заменять subject на `*`, если обмен не проходит. После merge workflow в согласованные ветки:

1. В Environment задать `TS_AUDIENCE` из новой identity; временно неверный subject в Tailscale не мешает запросу JWT у GitHub.
2. Actions → **Manual tailnet and OpenSSH connectivity (no deployment)** → Run workflow.
3. Для staging выбрать ветку dev и environment staging; для production — main/production.
4. Выбрать `claims_only=true`.
5. В job summary посмотреть только `iss`, `sub`, immutable IDs, Environment/ref и workflow reference. Токен и audience туда не попадают. Не отправлять JWT на внешние decoder-сайты.
6. Настроить в Tailscale точное совпадение фактического subject и custom claims выше. Environment subject сам по себе не ограничивает ветку, поэтому `ref` обязателен.

При необходимости ограничить `workflow_ref` шаблоном только reviewed workflows соответствующей ветки: `ShaurmaClub/MediaCode/.github/workflows/*@refs/heads/main` или `...@refs/heads/dev`. Если нужно разрешить только два конкретных файла без wildcard, использовать поддерживаемую провайдером модель отдельных identity/дополнительных условий; не угадывать OR-синтаксис. Оба наши workflow требуют подходящего Environment/ref до выдачи OIDC permission.

## 4. Secrets каждого GitHub Environment

`TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE`, `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`.

- SSH_HOST: `100.81.97.45` либо полное стабильное имя `vavilon.<tailnet>.ts.net`. Публичный IP/домен и короткое неоднозначное имя отвергаются.
- SSH_USER: `deploy-stage` / `deploy-prod`, никогда no1se/root.
- SSH_PORT: действующий OpenSSH порт 22, не открывать другой.
- SSH_PRIVATE_KEY: соответствующий отдельный Ed25519 private key. Public key устанавливается provisioning-скриптом только после разрешения.
- SSH_KNOWN_HOSTS: host key, полученный через уже доверенное административное подключение/консоль. Не принимать один лишь ssh-keyscan как источник доверия. Для нестандартного порта формат `[HOST]:PORT`.
- Для CD также сохраняются DEPLOY_PATH, SERVICE_NAME, HEALTHCHECK_URL из quickstart. Секреты не помещать в чат, коммиты или логи.

## 5. Provisioning: пока только check

На Vavilon запускать только:

```bash
bash deploy/provision-vavilon.sh --check --legacy-dir /srv/services/MediaCode
```

Root check даёт более полную проверку ACL/групп/sudoers; `--check` не меняет пользователей, SSH, файлы или сервисы. Аудит 29.10 показал, что legacy env/БД/uploads доступны через мировые permissions. Это отдельный блокер перед созданием staging-пользователей.

План исправления прав, **не выполнять автоматически**:

1. Сохранить владельцев, режимы и ACL (`getfacl -p`) вне публичного репозитория.
2. Проверить фактического owner текущего MediaCode (no1se) и подтвердить, что Caddy читает только HTTP upstream, а не эти файлы.
3. После отдельного разрешения закрыть traversal legacy root для посторонних, например owner-only 0700, и env 0600; проверить no1se/admin-доступ. Это меняет production permissions и сейчас запрещено.
4. Повторить root check и эффективные `runuser ... test -r` после создания аккаунтов в согласованное окно. Отдельно разобрать ACL и общие группы, если они есть.

Только после разрешения provisioning и закрытия legacy gate:

```bash
sudo bash deploy/provision-vavilon.sh --apply \
  --legacy-dir /srv/services/MediaCode \
  --prod-key /secure/path/prod.pub --stage-key /secure/path/stage.pub
```

Apply создаёт отдельные accounts/directories, проверяет candidate sudoers/sshd config до установки, добавляет только scoped Match для deploy-аккаунтов, запрещает им пароль/PTY/forwarding и reload-ит ssh. Административный OpenSSH, порт и старый mediacode.service не меняются. Ключи никогда не ставятся root/no1se. Runtime units не запускаются: установка новых application units и cutover отдельно.

## 6. Безвредная проверка соединения

После согласованного provisioning запустить тот же ручной workflow с `claims_only=false`. CD flags остаются false. Он проверит OIDC, live identity/tag, peer map и reachability, host key, `id -un`, отказ чужой deploy-учётки и случайного неверного ключа.

На сервере выполняется только буквальная команда `id -un`; нет SCP, git checkout, миграций или systemctl. Action ожидает propagation peer, дополнительная проверка ограничена retry budget. SSH/SCP используют IP, полученный из authenticated peer map, и HostKeyAlias для trusted known_hosts. Нет возврата к публичному адресу при ошибке. В `always()` выполняется logout; action v4 также имеет собственный post-cleanup. Принудительно прерванная VM/runner исчезнет как ephemeral node; проверить cleanup в tailnet console.

Реальный end-to-end OIDC нельзя объявлять проверенным до настройки identities/secrets и ручного запуска администратором на согласованной ветке. В лаборатории проверяются SSH и ошибки/контракты отдельно, без подделки успешной федерации.

## 7. Последовательность PR и включения

1. Review PR #5 и merge его в ci/cd-ubuntu24 (вручную).
2. Проверить обновившийся PR #4, обязательные security/build/integration checks и оба CD flag=false.
3. Merge PR #4 в main (вручную).
4. Перенести проверенный workflow в dev; проверить, что CD всё ещё false.
5. Проверить claims, identities, согласованное provisioning staging, manual connectivity и только затем по разрешению включить staging CD.
6. Выполнить отдельный согласованный first production cutover по checklist.
7. После приёмки production отдельно разрешить CD_PRODUCTION_ENABLED=true.

Merge, provisioning Vavilon, закрытие legacy permissions, first cutover и включение CD в рамках этой разработки не выполняются.
