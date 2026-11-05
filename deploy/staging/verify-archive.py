"""Read-only safety check before unprivileged extraction of a CI staging artifact."""
import re
import sys
import tarfile
from pathlib import PurePosixPath

archive, expected_sha = sys.argv[1:]
assert re.fullmatch('[0-9a-f]{40}', expected_sha), 'approved commit SHA required'
allowed = {'package.json', 'package-lock.json', '.release-sha', 'server', 'dist', 'deploy'}
seen = set()
size = 0
with tarfile.open(archive, 'r:gz') as stream:
    for member in stream:
        path = PurePosixPath(member.name)
        assert not path.is_absolute() and '..' not in path.parts and path.parts
        assert path.parts[0] in allowed, 'unexpected archive root'
        assert member.isdir() or member.isfile(), 'links and special files forbidden'
        assert not any(p.startswith('.env') or p.endswith(('.db', '.db-wal', '.db-shm'))
                       or p in ('node_modules', 'uploads') for p in path.parts), 'private/runtime file'
        if path.parts[0] == 'deploy':
            assert len(path.parts) == 1 or path.parts[1] == 'staging'
        assert str(path) not in seen, 'duplicate archive path'
        seen.add(str(path))
        size += member.size
        assert len(seen) < 20000 and size <= 256 * 1024 * 1024, 'archive size limit'
    assert {'package.json', 'package-lock.json', '.release-sha', 'server/index.js',
            'dist/index.html', 'deploy/staging/start.mjs'} <= seen, 'incomplete artifact'
    assert stream.extractfile('.release-sha').read(100).decode('ascii').strip() == expected_sha
print('Staging archive paths, types, size and approved SHA verified; no extraction performed.')
