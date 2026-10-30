#!/usr/bin/env bash
# Disposable VM controller, not a host provisioner. Ports stay inside Docker.
set -euo pipefail
[[ -f /.dockerenv && "${MEDIACODE_VM_ACK:-}" = disposable ]] || exit 90
[[ ! -e /vm/guest.qcow2 ]] || { echo 'VM disk already exists; use a new lab directory.' >&2; exit 10; }
cd /vm
umask 077
curl -fsSLO https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img
curl -fsSLO https://cloud-images.ubuntu.com/jammy/current/SHA256SUMS
grep -E ' [*]?jammy-server-cloudimg-amd64.img$' SHA256SUMS | sha256sum -c -
ssh-keygen -q -t ed25519 -N '' -f admin
ssh-keygen -q -t ed25519 -N '' -f host_ed25519
printf '[127.0.0.1]:2222 %s\n' "$(cut -d' ' -f1,2 host_ed25519.pub)" > known_hosts
qemu-img create -f qcow2 -F qcow2 -b /vm/jammy-server-cloudimg-amd64.img /vm/guest.qcow2 14G
{
  printf '#cloud-config\nhostname: mediacode-vm-lab\nssh_pwauth: false\ndisable_root: true\nusers:\n  - name: ubuntu\n    groups: [sudo]\n    shell: /bin/bash\n    sudo: ALL=(ALL) NOPASSWD:ALL\n    ssh_authorized_keys:\n      - %s\nssh_keys:\n  ed25519_private: |\n' "$(cat admin.pub)"
  sed 's/^/    /' host_ed25519
  printf '  ed25519_public: %s\n' "$(cat host_ed25519.pub)"
} > user-data
printf 'instance-id: mediacode-lab-%s\nlocal-hostname: mediacode-vm-lab\n' "$(date +%s)" > meta-data
cloud-localds seed.img user-data meta-data
qemu-system-x86_64 -enable-kvm -cpu host -smp 2 -m 3072 \
 -drive file=/vm/guest.qcow2,if=virtio,format=qcow2 \
 -drive file=/vm/seed.img,format=raw,if=virtio \
 -netdev user,id=net0,hostfwd=tcp:127.0.0.1:2222-:22 -device virtio-net-pci,netdev=net0 \
 -display none -serial file:/vm/serial.log -daemonize -pidfile /vm/qemu.pid
for _ in $(seq 1 150); do
  if ssh -i admin -p 2222 -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/vm/known_hosts -o ConnectTimeout=2 ubuntu@127.0.0.1 true 2>/dev/null; then
    echo 'Ubuntu 22.04 VM ready; host identity pinned before boot.'
    exit 0
  fi
  sleep 2
done
echo 'VM SSH timeout; inspect private serial.log' >&2
exit 10
