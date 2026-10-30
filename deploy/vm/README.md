# Настоящая Ubuntu 22.04 + systemd VM

Для текущего security review основной воспроизводимый прогон — job `systemd-security`
в `.github/workflows/ci.yml` на **GitHub-hosted ubuntu-22.04 VM**, PID1=systemd.
Это не container/shim и не подключение к Vavilon. `prepare-ci.sh` отказывается от
self-hosted runner/неверной ОС/PID1. Source+dependencies замораживаются root-owned,
тестируются реальные broker/sudoers/SSH/systemd и synthetic staging deployment.
Никаких Environment secrets, OIDC или Tailscale этому job не выдано.

Прежний QEMU/KVM сценарий ниже тоже доступен для отдельного разрешённого тестового
хоста. На Vavilon в рамках нынешнего review ничего запускать/применять не нужно.

Этот сценарий разрешён **только для новой одноразовой VM**. Он создаёт пользователей,
sshd/sudoers, синтетические БД, units и намеренно ломает тестовый сервис. На рабочем
Vavilon запускать `prepare-guest.sh`/`scenarios.mjs` нельзя. Production-файлы и токены
в лабораторию не копируются. Скрипты проверяют hostname/маркер VM; prepare также KVM.

Контроллер — контейнер Ubuntu 22.04 с QEMU/KVM; внутри полноценная guest Ubuntu 22.04,
PID 1 = systemd. Это **не** контейнерная заглушка systemctl. Требуются `/dev/kvm`,
примерно 4 GiB RAM и 14 GiB места под guest, интернет для официальных образов/пакетов.
Не подключать host PID/cgroups/rootfs, production volumes и не публиковать порты.

## Воспроизведение на отдельно разрешённом тестовом хосте

Из проверенного checkout, с новым именем контейнера и приватным каталогом:

```bash
umask 077
LAB=$(mktemp -d /var/tmp/mediacode-vm.XXXXXXXX)
tar --exclude=.git --exclude=node_modules --exclude=.npm-cache --exclude=.env \
  --exclude=data --exclude=uploads -czf "$LAB/review.tar.gz" .
docker build -t mediacode-vm-controller:jammy -f deploy/vm/Dockerfile .
docker run -d --name mediacode-vm-UNIQUE --device /dev/kvm \
  --cpus 2 --memory 4g --pids-limit 384 \
  -e MEDIACODE_VM_ACK=disposable \
  --mount "type=bind,src=$PWD,dst=/source,readonly" \
  mediacode-vm-controller:jammy sleep infinity
docker exec mediacode-vm-UNIQUE bash /source/deploy/vm/boot.sh
docker cp "$LAB/review.tar.gz" mediacode-vm-UNIQUE:/vm/review.tar.gz
docker exec mediacode-vm-UNIQUE scp -i /vm/admin -P 2222 \
  -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/vm/known_hosts \
  /vm/review.tar.gz ubuntu@127.0.0.1:/tmp/review.tar.gz
docker exec -i mediacode-vm-UNIQUE ssh -i /vm/admin -p 2222 \
  -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/vm/known_hosts \
  ubuntu@127.0.0.1 sudo bash -s < deploy/vm/prepare-guest.sh > "$LAB/tests.log" 2>&1
```

`boot.sh` сверяет официальный Jammy cloud image с SHA256SUMS по HTTPS, задаёт host key
до первого SSH, создаёт новый qcow2 и user-mode NAT. SSH forward 127.0.0.1:2222 находится
**внутри** контроллера, не на Vavilon. SSH известен заранее, keyscan не используется.
Node 22 загружается с nodejs.org и сверяется с SHASUMS256.txt.

Не запускать два `npm ci` одновременно. При недоступности npm допустимо перенести
приватный npm cache без env/данных, выполнить `npm ci --offline --ignore-scripts
--include=dev --include=optional --cache /private/cache`, затем `npm rebuild
better-sqlite3 --build-from-source --nodedir=/usr/local`. Это не заменяет lockfile.

## Что проверяет scenarios.mjs

- Read-only provisioning, отказ apply при world-readable legacy, затем явно закрытые
  права **синтетического** legacy и два последовательных apply.
- Users/groups, scoped sshd, настоящие SSH positive/negative проверки, stage не может
  читать legacy/prod или управлять prod через sudo. Legacy unit сохраняет MainPID.
- Unit sandbox: ProtectSystem=strict, ProtectHome, NoNewPrivileges, ReadWritePaths;
  запись в data разрешена, в код и соседний контур запрещена из самого sandbox.
- Реальные start/stop/restart, Restart=always после SIGKILL и journalctl.
- Повтор активного SHA, нормальное переключение, ошибки previous/current ln и mv,
  stop/restart, readiness; возвращается прежний здоровый SHA.
- Отказ БД, несовместимая schema, полный отказ restart и healthcheck → EMERGENCY 31.
- Запись после финального backup остаётся после rollback кода: БД не восстанавливается.

Сбойные команды перехватываются локальным PATH-wrapper только внутри VM; все остальные
вызовы идут в настоящие `/usr/bin/systemctl`, ln, mv, curl. Fault-сценарии запускаются
root для инъекций, права deploy отдельно проверяются через runuser/SSH/sudo. Данные
синтетические; acceptance настоящих пользователей и OIDC-провайдер сюда не входят.

Сценарий рассчитан на свежую VM. После ошибки сначала сохранить журнал и разобраться,
а не выполнять повторное provisioning на рабочем сервере.

Завершение: отправить guest `sudo poweroff` через тот же pinned SSH, дождаться выхода
QEMU, затем остановить **только** именованный тестовый контейнер. Диск и приватные логи
можно сохранить для review; автоматическое удаление контейнеров/образов не требуется.
