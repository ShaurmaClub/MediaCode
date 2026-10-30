#!/usr/bin/python3 -I
"""Admin-installed broker. Never import/execute code from /opt/mediacode.

Deploy is trusted to run application code as its OWN runtime through systemd.
This broker narrows sudo, not that inherent application-code trust boundary.
"""
import hashlib
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys

BROKER = Path('/usr/local/sbin/mediacode-ops')
LIB = Path('/usr/local/lib/mediacode-ops')
NODE = Path('/usr/local/libexec/mediacode-node')
POLICY_FILES = ('server/db.js', 'server/migrate.js', 'server/config/schema.js')
PLAIN = {'exists-env', 'exists-db', 'stop', 'start', 'restart', 'is-active'}
WITH_SHA = {'policy', 'backup-predeploy', 'backup-final', 'migrate', 'verify-rollback'}


def deny(message):
    raise ValueError(message)


def trusted(path):
    """Every component must be root-owned, non-writable, and not a symlink."""
    path = Path(path)
    for component in reversed((path, *path.parents)):
        info = component.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            deny('untrusted admin path')


def trusted_tree(path):
    trusted(path)
    for directory, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            item = Path(directory, name)
            if item.is_symlink():
                # npm .bin contains relative links; only root-owned in-bundle targets.
                if item.lstat().st_uid != 0 or not item.resolve().is_relative_to(path):
                    deny('unsafe helper link')
                trusted(item.resolve())
            else:
                info = item.lstat()
                # Ancestor directory was checked on entry; do not restat /usr/... for
                # every dependency file (tens of thousands of redundant syscalls).
                if info.st_uid != 0 or info.st_mode & 0o022:
                    deny('writable helper member')
                if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                    deny('special helper member')


def no_links(path):
    for component in reversed((path, *path.parents)):
        if component.is_symlink():
            deny('symlink in operation path')


def owned(path, uid, private=False, directory=False):
    no_links(path)
    info = path.lstat()
    if info.st_uid != uid or (private and info.st_mode & 0o077):
        deny('unsafe runtime permissions')
    if directory != stat.S_ISDIR(info.st_mode):
        deny('unexpected runtime path type')
    if not directory and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
        deny('unsafe runtime file')


def release_policy(contour, sha, helper):
    base = Path('/opt/mediacode', contour, 'releases')
    release = base / sha
    no_links(release)
    if not release.is_dir() or release.resolve() != release:
        deny('release path rejected')
    for name in ('.release-sha', *POLICY_FILES):
        item = release / name
        no_links(item)
        if not item.is_file() or item.stat().st_nlink != 1:
            deny('invalid release policy file')
    if (release / '.release-sha').read_text().strip() != sha:
        deny('release identity mismatch')
    for name in POLICY_FILES:
        if hashlib.sha256((release / name).read_bytes()).digest() != hashlib.sha256((helper / name).read_bytes()).digest():
            deny('migration code not admin-approved; install reviewed helper before deploying')


def main():
    args = sys.argv[1:]
    if len(args) not in (2, 3) or args[0] not in ('production', 'staging'):
        deny('invalid contour/argument count')
    contour, operation = args[:2]
    sha = args[2] if len(args) == 3 else None
    if not ((operation in PLAIN and sha is None) or
            (operation in WITH_SHA and sha is not None and re.fullmatch('[0-9a-f]{40}', sha))):
        deny('operation or arguments rejected')
    if os.geteuid() != 0:
        deny('broker requires narrowly scoped sudo')
    suffix = 'prod' if contour == 'production' else 'stage'
    caller = pwd.getpwuid(int(os.environ.get('SUDO_UID', '0'))).pw_name
    if caller not in ('root', 'deploy-' + suffix):
        deny('cross-contour caller rejected')
    if Path(__file__) != BROKER:
        deny('broker must run from its installed path')
    trusted(BROKER)
    runtime = pwd.getpwnam('mediacode-' + suffix)
    helper = LIB / contour
    trusted_tree(helper)
    trusted(NODE)
    state = Path('/var/lib/mediacode', contour)
    for parent in (Path('/var'), Path('/var/lib'), state.parent):
        trusted(parent)
    owned(state, runtime.pw_uid, private=True, directory=True)
    env_file = state / '.env'
    db_file = state / 'data/media.db'
    if operation.startswith('exists-'):
        item = env_file if operation == 'exists-env' else db_file
        if not item.exists():
            return 1
        owned(item, runtime.pw_uid, private=True)
        return 0
    # Root only controls the exact unit; no user-controlled unit/options/environment.
    clean_env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent'}
    if operation in {'stop', 'start', 'restart', 'is-active'}:
        trusted(Path('/etc/systemd/system/mediacode-' + suffix + '.service'))
        return subprocess.run(['/bin/systemctl', '--no-pager', operation, 'mediacode-' + suffix + '.service'],
                              cwd='/', env=clean_env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60).returncode
    release_policy(contour, sha, helper)
    if operation == 'policy':
        return 0
    owned(env_file, runtime.pw_uid, private=True)
    for name in ('data', 'uploads', 'uploads/recruitment', 'backups'):
        owned(state / name, runtime.pw_uid, directory=True)
    # Never create a new empty DB when recovery/backup should inspect an existing one.
    if operation != 'migrate' or db_file.exists():
        owned(db_file, runtime.pw_uid, private=True)
    if operation in {'backup-predeploy', 'backup-final'}:
        reason = 'pre-deploy' if operation == 'backup-predeploy' else 'cutover'
        script_args = ['server/backup.js', '--with-uploads', '--reason=' + reason]
    else:
        script_args = ['server/migrate.js', '--verify-rollback' if operation == 'verify-rollback' else '--verify']
    clean_env.update({'NODE_ENV': 'production', 'ENV_FILE': str(env_file),
                      'DEPLOY_ENV': contour, 'APP_ENV': contour, 'APP_COMMIT_SHA': sha,
                      'DB_PATH': str(db_file), 'BACKUP_DIR': str(state / 'backups'),
                      'UPLOAD_DIR': str(state / 'uploads/recruitment'),
                      'UPLOADS_DIR': str(state / 'uploads/recruitment')})
    # No shell, inherited NODE_OPTIONS/PYTHONPATH/LD_*, user cwd or runtime-owned script.
    result = subprocess.run([str(NODE), *script_args], cwd=helper, env=clean_env,
                            user=runtime.pw_uid, group=runtime.pw_gid, extra_groups=[], umask=0o077,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=180)
    print('Runtime operation completed' if result.returncode == 0 else 'Runtime operation failed; administrator diagnostics required', file=sys.stderr)
    return result.returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError):
        # Never expose paths, env values, process output or credential-bearing errors.
        print('Operation rejected/failed: check arguments, approved helper and permissions.', file=sys.stderr)
        sys.exit(10)
