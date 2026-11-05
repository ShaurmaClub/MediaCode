"""First staging env only. Run as root after approval; never read legacy env."""
import os
import pwd
import secrets
import stat

assert os.getuid() == os.geteuid() == 0, 'root required'
state = '/var/lib/mediacode/staging'
account = pwd.getpwnam('mediacode-stage')
entry = os.lstat(state)
assert stat.S_ISDIR(entry.st_mode) and not stat.S_ISLNK(entry.st_mode)
assert os.path.realpath(state) == state
assert entry.st_uid == account.pw_uid and stat.S_IMODE(entry.st_mode) == 0o700
values = {
    'APP_ENV': 'staging', 'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': '4001',
    'DB_PATH': state + '/data/media.db', 'UPLOAD_DIR': state + '/uploads/recruitment',
    'DOTENV_CONFIG_PATH': '/dev/null', 'SESSION_SECRET': secrets.token_hex(32),
    'MAX_BOT_TOKEN': '', 'TELEGRAM_BOT_TOKEN': '', 'ALERT_WEBHOOK_URL': '',
}
fd = os.open(state + '/.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, 'w') as stream:
    os.fchown(stream.fileno(), account.pw_uid, account.pw_gid)
    stream.write(''.join(name + '=' + value + '\n' for name, value in values.items()))
print('Created private staging env; secret values suppressed.')
