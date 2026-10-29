#!/usr/bin/python3 -I
"""Administrator only. Install a reviewed, root-owned helper closure and sudo policy.

No package downloads, npm lifecycle scripts, service changes or data access.
Source must already be a frozen root-owned reviewed snapshot with built dependencies.
"""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
sys.dont_write_bytecode = True


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise ValueError('administrator and one trusted source directory required')
    source = Path(sys.argv[1])
    print('Validating frozen helper source', flush=True)
    spec = importlib.util.spec_from_file_location('broker', Path(__file__).with_name('mediacode-ops.py'))
    broker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(broker)
    broker.trusted_tree(source / 'server')
    broker.trusted_tree(source / 'node_modules')
    print('Frozen helper source validated', flush=True)
    broker.trusted(source / 'package.json')
    broker.trusted(Path(__file__))
    broker.trusted(Path(__file__).with_name('mediacode-ops.py'))
    if not (source / 'node_modules/better-sqlite3/build/Release/better_sqlite3.node').is_file():
        raise ValueError('build trusted native dependency before installation')
    for directory in (broker.LIB, broker.BROKER.parent, broker.NODE.parent):
        created = not directory.exists()
        directory.mkdir(parents=True, exist_ok=True, mode=0o755)
        broker.trusted(directory)
        if created:
            # Provisioning has umask 077; helpers contain no secrets and runtime
            # must be able to traverse this admin-owned parent after dropping UID.
            directory.chmod(0o755)
    if not broker.NODE.exists():
        # Ubuntu/Node installations may have a root-owned /usr/bin/node symlink.
        node_source = Path('/usr/bin/node').resolve()
        broker.trusted(node_source)
        shutil.copyfile(node_source, broker.NODE)
        broker.NODE.chmod(0o755)
    broker.trusted(broker.NODE)
    with tempfile.TemporaryDirectory(prefix='.install-', dir=broker.LIB) as scratch_name:
        scratch = Path(scratch_name)
        for contour in ('production', 'staging'):
            print('Installing trusted helper: ' + contour, flush=True)
            target = broker.LIB / contour
            if target.exists() or target.is_symlink():
                # Updating approved migration code is an explicit admin action, not CD.
                broker.trusted_tree(target)
                for name in (*broker.POLICY_FILES, 'package.json', 'server/backup.js'):
                    if (target / name).read_bytes() != (source / name).read_bytes():
                        raise ValueError('approved helper differs; review/retire it separately before replacement')
                continue
            staged = scratch / contour
            staged.mkdir(mode=0o755)
            for name in ('server', 'node_modules', 'shared', 'scripts'):
                if (source / name).exists():
                    broker.trusted_tree(source / name)
                    shutil.copytree(source / name, staged / name, symlinks=True)
            shutil.copyfile(source / 'package.json', staged / 'package.json')
            for directory, dirs, files in os.walk(staged):
                Path(directory).chmod(0o755)
                for name in files:
                    item = Path(directory, name)
                    if not item.is_symlink():
                        item.chmod(0o755 if item.stat().st_mode & 0o111 else 0o644)
            os.rename(staged, target)
        candidate = scratch / 'sudoers'
        rows = []
        for contour, suffix in (('production', 'prod'), ('staging', 'stage')):
            # Wildcard admits arguments to the broker, NOT a shell/interpreter.
            # Broker checks exact argc/operation/SHA and SUDO_UID on every call.
            rows.append(f'deploy-{suffix} ALL=(root) NOPASSWD: {broker.BROKER} {contour} *\n')
        candidate.write_text(''.join(rows))
        subprocess.run(['/usr/sbin/visudo', '-cf', str(candidate)], check=True, stdout=subprocess.DEVNULL)
        if broker.BROKER.is_symlink() or Path('/etc/sudoers.d/mediacode-deploy').is_symlink():
            raise ValueError('refusing symlink destination')
        # Root-owned destinations; no deploy/runtime account can replace these files.
        shutil.copyfile(Path(__file__).with_name('mediacode-ops.py'), broker.BROKER)
        broker.BROKER.chmod(0o755)
        policy = Path('/etc/sudoers.d/mediacode-deploy')
        if policy.exists():
            broker.trusted(policy)
            backup = Path('/etc/sudoers.d/.mediacode-deploy.before-hardening')
            if not backup.exists():
                shutil.copyfile(policy, backup)
                backup.chmod(0o400)
        temp_policy = Path('/etc/sudoers.d/.mediacode-deploy.next')
        if temp_policy.is_symlink():
            raise ValueError('refusing sudo policy symlink')
        shutil.copyfile(candidate, temp_policy)
        temp_policy.chmod(0o440)
        os.replace(temp_policy, policy)
    print('Admin-owned broker/helpers and candidate-validated scoped sudoers installed.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError):
        print('Helper installation blocked: verify trusted source, dependencies and existing policy.', file=sys.stderr)
        sys.exit(10)
