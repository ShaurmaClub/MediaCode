# Vavilon Phase 2 — Minimal Viable Staging: план согласования

05.11.2026 MSK. **PREPARED, NOT APPLIED. STOP перед первой записью на Vavilon.**
Цель следующего исполнения: первый ручной deployment ветки dev. Это не production
cutover и не включение автоматического CD. Оба CD-флага остаются false.

## Короткая последовательность

| Шаг, отдельное согласование | Конкретное воздействие | Проверка / откат |
| --- | --- | --- |
| A. Review PR в dev | Только выбранные CI/staging-файлы и совместимый lockfile, без merge всех66 коммитов main | CI; merge выполняет владелец |
| B. Stage-only accounts/dirs/key | deploy-stage, mediacode-stage, code group; новые /opt и /var/lib staging, отдельный SSH key | Не читают legacy; нет sudo; при ошибке STOP, оставить частичные объекты для разбора |
| C. Ручной release | Проверенный CI-артефакт, npm ci как deploy-stage, новый env и synthetic SQLite как runtime | sha/integrity/ownership; при неудаче не публиковать current |
| D. Запуск stage unit | Только новый mediacode-stage.service, loopback4001 | ready=staging+SHA, production PID неизменен; откат первого запуска — stop только stage |
| E. DNS и Caddy | Только stage.kaiton.ru + basic_auth + proxy4001; один graceful reload Caddy | Проверить production до/после; при ошибке восстановить Caddyfile и reload, не restart |
| F. Приёмка | HTTPS/auth, synthetic login/upload, UID-denial, SSH; повтор +1/+10мин | Никаких записей production; STOP после первого успешного manual staging |

Предлагается согласовывать **B отдельно от C/D, затем E отдельно**. Никакие команды
ниже в подготовительном проходе не выполнялись. Не запускать старый двухконтурный
deploy/provision-vavilon.sh: он создаёт production и меняет sshd, это вне Phase2.

## Что проверено сейчас

- main=3053f975ca766ea8e879577ddadb365cf4266874; dev=fdaa99431bca971f771a3c1d6dec880d5296e7bb.
  main впереди на66 коммитов, dev не имеет уникальных коммитов относительно main.
  Feature-ветка основана именно на dev; полный merge/rebase/force-push не выполняется.
  UI/refactor/routes из main сюда не переносятся. При новом dev HEAD перед merge —
  повторный merge-base/diff и обычное разрешение конфликтов, не перезапись dev.
- GitHub staging существует, branch rule только dev. Имеются имена секретов
  TS_AUDIENCE и TS_OAUTH_CLIENT_ID. SSH_HOST/SSH_PRIVATE_KEY/SSH_KNOWN_HOSTS в этом
  Environment отсутствуют. Их значения и валидность OIDC не получались/не раскрывались.
- Repository CD_STAGING_ENABLED=false, CD_PRODUCTION_ENABLED=false; environment
  overrides этих флагов отсутствуют. main и dev сейчас без branch protection;
  review/merge — сознательный ручной gate владельца, не доказанная mandatory policy.
- На Vavilon Node22.23.2, npm10.9.8, Caddy2.11.4; /opt и /var/lib имеют около89.8GiB
  свободного места. TCP4001 не занят. Tailscale Running/Online.
- Stage-аккаунтов, /opt/mediacode, /var/lib/mediacode/staging и stage unit нет.
  getfacl отсутствует: не устанавливать пакеты ради диагностики, ACL доступны через
  существующий Python os.getxattr. sudo агента требует пароль владельца.
- Legacy700/.env600; mediacode PID184745/NRestarts1, Caddy36461/0, SSH131666/0;
  production health ok=true/db=ok. Эти значения — snapshot, перед apply сверить снова.
- В Caddy нет stage-маршрута. stage.kaiton.ru не разрешился через resolver сервера.
  Это не доказательство авторитетного NXDOMAIN; проверить A/AAAA у DNS-провайдера.
- Tailscale control-plane ACL/trust не доступны из обычного tailscale status.
  Реальный OIDC обмен, CI-tag ACL и SSH deploy-stage пока **NOT VERIFIED**.
  Не выдавать существующий административный SSH за проверку CI-доступа.

## Минимальные gates GitHub/Tailscale (без блокирования локального staging)

1. После review/merge PR в dev запускать CI на dev и брать артефакт только из
   успешного run на **точном одобренном dev SHA**, не PR merge ref/feature build.
   CI в этом PR только lint/tests/audit/build/E2E/package — не подключается к Vavilon.
2. Для claims-only использовать существующий на default main filename
   ssh-connectivity.yml, dispatch с ref=dev и inputs.claims_only=true.
   В dev это staging-only workflow; deployment и automatic CD в нём отсутствуют.
   Workflow запускать только после отдельного разрешения на Actions dispatch.
3. В Tailscale проверить federated identity: issuer token.actions.githubusercontent.com,
   scope auth_keys, tag:mediacode-ci-stage, точные repository_id1379985703,
   repository_owner_id242012393, ref refs/heads/dev, environment staging и фактический
   sub из claims summary. Не угадывать sub и не использовать wildcard/fallback auth key.
4. Узкое правило CI-stage ->100.81.97.45 tcp22; deny-tests для4000/4001/2019,
   остальных узлов/подсетей. Учесть существующие широкие grants: узкое правило само
   по себе их не отменяет. Не переназначать серверу tag и не менять SSH/Tailscale mode.
5. После B добавить в staging Environment отдельный private key, SSH_HOST100.81.97.45
   и pinned SSH_KNOWN_HOSTS из уже доверенного административного канала. Private key
   не отправлять в чат/PR. SSH user фиксирован deploy-stage, порт22.
6. claims_only=false проверяет OIDC/private peer и только id -un через pinned SSH.
   Не выполняет SCP/install/systemctl. Успешный run будет реальным CI connectivity PASS.

**Первый ручной серверный deployment можно провести через существующий доверенный
административный SSH, не дожидаясь федерации.** Это не считается завершённым
OIDC CI/CD. Подготовка/включение автоматического CD для dev — отдельный следующий
этап с review scoped broker, а не выдача deploy-stage общего sudo/interpreter доступа.

## B. Команды stage-only подготовки — СЕЙЧАС НЕ ВЫПОЛНЯТЬ

Перед первым изменением: fresh SSH + production health, PID/restart baseline,
legacy700/.env600, порт4001 свободен; новые целевые пути/аккаунты не появились,
нет symlink/ACL на родителях. При дрейфе STOP. Держать вторую admin SSH-сессию.

Ниже команды для существующего sudo-доступа владельца, не новый sudoers:

```bash
sudo groupadd --system mediacode-code-stage
sudo useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin mediacode-stage
sudo useradd --create-home --user-group --shell /bin/bash deploy-stage
sudo usermod -aG mediacode-code-stage deploy-stage
sudo usermod -aG mediacode-code-stage mediacode-stage
sudo install -d -o root -g root -m 0755 /opt/mediacode /var/lib/mediacode
sudo install -d -o deploy-stage -g mediacode-code-stage -m 2750 /opt/mediacode/staging /opt/mediacode/staging/releases
sudo install -d -o mediacode-stage -g mediacode-stage -m 0700 /var/lib/mediacode/staging
sudo install -d -o mediacode-stage -g mediacode-stage -m 0700 /var/lib/mediacode/staging/data /var/lib/mediacode/staging/uploads /var/lib/mediacode/staging/uploads/recruitment
sudo chown root:root /home/deploy-stage
sudo chmod 0755 /home/deploy-stage
sudo install -d -o root -g root -m 0700 /home/deploy-stage/.ssh
sudo install -d -o deploy-stage -g deploy-stage -m 0700 /home/deploy-stage/incoming /home/deploy-stage/.npm
```

SSH public key ставится root в новый authorized_keys (0600 root:root), единственная
строка `restrict ssh-ed25519 <approved-stage-public-key>`. Домашний каталог root-owned:
deploy не может заменить .ssh. Существующий sshd_config не меняется и reload SSH
не нужен. Перед публикацией администратор проверяет effective sshd policy для
deploy-stage: AuthorizedKeysFile применим, не заперт ли аккаунт политикой locked
password/AllowUsers/Match. Если существующая политика не принимает ключ — STOP,
отдельно согласовать минимальную коррекцию; пароль/общий ключ как fallback запрещён.
На рабочей станции создать отдельный Ed25519 key, не повторно использовать admin key.

После B: id/groups обоих пользователей; настоящие runuser/sudo -u отрицательные
tests на legacy .env/DB/uploads и на env будущего staging со стороны deploy;
sudo -n у deploy должен отказать. ACL осмотреть Python xattr. Проверить старый admin SSH.
В B никаких prod-аккаунтов, units, Caddy или системных package updates.

## C/D. Первый release и synthetic state — только после отдельного разрешения

Параметр RELEASE_SHA — согласованный40-символьный dev SHA. Архив/sha256file
скачиваются владельцем из успешного CI run; checksum без проверки run/ref не является
доказательством происхождения. Перед SCP проверить pinned host key существующей SSH.
Загрузка в новый /home/deploy-stage/incoming/<SHA> — тоже изменение сервера, не сейчас.

План команд после согласования и подстановки SHA (из доверенного reviewed checkout):

```bash
export RELEASE_SHA='<approved-dev-40hex-sha>'
export RELEASE="/opt/mediacode/staging/releases/$RELEASE_SHA"
export INCOMING="/home/deploy-stage/incoming/$RELEASE_SHA"
# Архив+checksum уже загружены в INCOMING по доверенному SSH.
cd "$INCOMING"
sha256sum -c mediacode-staging.tar.gz.sha256
python3 /path/to/reviewed-checkout/deploy/staging/verify-archive.py mediacode-staging.tar.gz "$RELEASE_SHA"
sudo -u deploy-stage -- mkdir "$RELEASE"
sudo -u deploy-stage -- tar --no-same-owner --no-same-permissions -xzf "$INCOMING/mediacode-staging.tar.gz" -C "$RELEASE"
sudo -u deploy-stage -H -- nice -n 10 /usr/bin/npm ci --omit=dev --no-audit --no-fund --prefix "$RELEASE"
sudo -u deploy-stage -- find "$RELEASE" -type d -exec chmod 2750 '{}' +
sudo -u deploy-stage -- find "$RELEASE" -type f -exec chmod 0640 '{}' +
sudo /usr/bin/python3 -I -B /path/to/reviewed-checkout/deploy/staging/write-env.py
sudo systemd-run --unit=mediacode-stage-init --wait --pipe --collect \
  -p User=mediacode-stage -p Group=mediacode-stage -p SupplementaryGroups=mediacode-code-stage \
  -p "WorkingDirectory=$RELEASE" -p EnvironmentFile=/var/lib/mediacode/staging/.env -p UMask=0077 \
  /usr/bin/node "$RELEASE/deploy/staging/initialize.mjs"
sudo -u deploy-stage -- ln -s "$RELEASE" /opt/mediacode/staging/current
sudo systemd-analyze verify /path/to/reviewed-checkout/deploy/staging/mediacode-stage.service
sudo install -o root -g root -m 0644 /path/to/reviewed-checkout/deploy/staging/mediacode-stage.service /etc/systemd/system/mediacode-stage.service
sudo systemctl daemon-reload
sudo systemctl start mediacode-stage.service
curl --fail --silent --show-error http://127.0.0.1:4001/api/health/ready
```

Перед командами строго проверить формат SHA, отсутствие RELEASE/current/.env/БД и
realpath новых родителей. Скрипты write-env/verify брать из зафиксированного,
проверенного **не изменяемого deploy-пользователем** checkout, не выполнять root Python
из incoming/release. Native npm scripts работают только как deploy-stage, не root.
Node runtime22 и ABI на сервере проверены; npm ci может потребовать сеть/prebuilt
native binary или toolchain. При ошибке STOP, не устанавливать toolchain/пакеты без
отдельного разрешения. Ресурсное воздействие: npm install/native build, только новый
release; nice снижает приоритет, но не является строгим ограничением RAM/CPU.

initialize не использует seed()/seed-dev/production backup. Создаёт новую schema,
три synthetic account и одну synthetic task; случайные пароли — только private
synthetic-accounts.json0600, не stdout. На существующей БД отказывает. env — новый
random secret,600, без внешних bot credentials. Любая ошибка init — STOP; частичную
synthetic БД автоматически не стирать/не переинициализировать.

ready должен вернуть ok=true,db=ok,environment=staging,commit=RELEASE_SHA. Проверить
ss: **только127.0.0.1:4001**, а не0.0.0.0/[::]. Production API/PID прежние.
Не выполнять enable до приёмки; перезагрузка хоста до enable не сохраняет staging.

## E. stage.kaiton.ru: отдельное согласование DNS и graceful Caddy reload

1. Владелец DNS добавляет A на действующий публичный вход Caddy. AAAA — только если
   этот IPv6 действительно обслуживается. Не указывать Tailscale-IP в публичном DNS
   и не менять kaiton.ru/www. Сейчас DNS/ACME ещё не подтверждены.
2. Сохранить текущий Caddyfile с metadata в новом private admin-каталоге. Создать
   candidate как **точную копию + только Caddyfile.fragment**. Не заменять весь конфиг
   шаблоном, не менять действующий production block и его127.0.0.1:4000.
3. `caddy hash-password` интерактивно для нового случайного staging-only пароля;
   заменить REPLACE_WITH_CADDY_HASH в candidate только bcrypt-хешем. Не передавать
   plaintext через argv, GitHub, чат или журнал. Дополнительный HTTP basic_auth
   защищает публичный тестовый стенд, robots=noindex сам по себе не защита.
4. Администратор проверяет diff/adapted route structure: единственное добавление
   stage block. Проверить service ExecStart использует именно /etc/caddy/Caddyfile,
   effective candidate против текущей config, не публиковать конфиг/хеши в отчёте.

```bash
sudo caddy validate --config /root/<private-approved-dir>/Caddyfile.candidate --adapter caddyfile
# Только после validation и проверки неизменности production routes:
sudo cp --preserve=mode,ownership /root/<private-approved-dir>/Caddyfile.candidate /etc/caddy/Caddyfile
sudo systemctl reload caddy.service
```

Reload — конфигурационное изменение, **не выполнено и требует отдельного разрешения**.
TLS выдаёт Caddy своим штатным ACME; firewall/SSH/Tailscale не менять. При недоступном
DNS/ACME оставить рабочий local staging, не отключать проверку TLS и не открывать4001.

## Приёмка, немедленный STOP и откат

- До/после каждого изменяющего шага: health legacy loopback + HTTPS kaiton.ru/www,
  MainPID/NRestarts legacy, Caddy и admin SSH. Любое ухудшение production — STOP;
  не рестартовать legacy и не трогать его права/БД ради исправления staging.
- systemd stage active, ready отвечает staging+точный SHA. Без basic-auth HTTPS stage
  должен401; с отдельными HTTP credentials — ready200 и frontend200. Проверить TLS.
- Synthetic app login (не production account), отдельная secure HttpOnly host-only
  cookie mediacode.stage.sid, пробная запись/чтение/удаление **только synthetic staging**
  через штатный API и upload/download. Разрешение этих тестов входит в согласуемый C/F,
  не текущий read-only проход. Не печатать учётные данные/содержимое файлов.
- Реальные UID tests: stage runtime и deploy не читают legacy .env/DB/uploads;
  deploy не читает stage state/env; runtime читает/пишет свой state, но не code;
  nobody не читает stage state; deploy не имеет sudo. Root/no1se не считаются
  недоверенными UID. Не давать stage root-equivalent группы/docker/sudo.
- Повторить health/PID/UID/HTTPS/SSH через1 и10 минут, журнал только summary ошибок.
- Первый release не имеет previous. Его безопасный rollback:
  `sudo systemctl stop mediacode-stage.service`; оставить code/synthetic state/env
  для разбора, ничего не удалять. Если опубликован stage route — восстановить
  **точный сохранённый Caddyfile** с прежней metadata, validate и reload Caddy,
  проверить production/SSH. Перед восстановлением убедиться, что других изменений
  Caddy после baseline не было; иначе STOP и ручное объединение, не затирать их.
- Для последующих release сохранять previous. Переключение назад только после
  проверки совместимости schema; DB restore автоматически не делать. Первое
  испытание «rollback» — остановка первого staging/восстановление proxy candidate,
  не обещание rollback любой будущей schema. Production backup не изменять.
- Users/dirs/keys/unit при остановке остаются для разбора; автоматического userdel,
  recursive rm или удаления backup нет. Отдельно согласовать cleanup, если нужен.

## Границы безопасности / статус следующего шага

Это намеренно manual MVP, а не перенос всей root-broker инфраструктуры PR5. Deploy
может менять свой stage code; запуск reviewed code как runtime выполняет только
администратор. Это не защита staging state от злонамеренного кода deploy-пользователя
после одобрения запуска. Legacy защищён другим UID,700 и sandbox; production policy
и маршруты не изменяются. Перед automatic CD потребуется отдельная модель scoped
operations и доверенного helper, без sudo bash/python/node для deploy.

**GO для review PR и согласования B. NO-GO для исполнения серверных изменений сейчас.**
Неподтверждённые, конкретные условия: DNS/ACME, SSH Environment credentials,
Tailscale identity/ACL и реальный OIDC/SSH run; real systemd/native install/synthetic
initialize на Vavilon проверяются только после разрешения. Это не повод повторять
неограниченный аудит других проектов. После первого manual deployment — STOP.

## Проверки подготовки

Node24.20.0 на рабочей станции: npm ci,25 Node tests и4 Python archive tests PASS;
build PASS. Lint:0 errors,133 существующих warnings ветки dev (включая no-undef);
это не утверждение об отсутствии проблем старого приложения. Production npm audit
после совместимого обновления lockfile:0 vulnerabilities; полного major-upgrade
или audit fix --force не было. В полном audit остаются4 moderate dev-tool findings,
не затрагивающих production-only install; не менять ESLint major ради этой фазы.
Локальный E2E не выполнен: нет Chromium, официальный download завершается timeout.
В Ubuntu CI предусмотрен отдельный install chromium и E2E; его результат должен
быть успешным до допуска артефакта. Синтаксис YAML/Python и git diff --check PASS.
Новые staging initializer/unit/proxy ещё не исполнялись на Vavilon; это явно
отложенные приёмочные проверки, а не лабораторный PASS.

Официальные основания: [Tailscale Action/OIDC](https://tailscale.com/docs/integrations/github/github-action),
[federation](https://tailscale.com/docs/features/workload-identity-federation),
[GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
