import io
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

SHA = 'a' * 40
ROOT = Path(__file__).resolve().parents[1]


class StagingArchiveTests(unittest.TestCase):
    def check_archive(self, extra=None, sha=SHA):
        with tempfile.TemporaryDirectory(prefix='mediacode-archive-test-') as directory:
            archive = Path(directory) / 'fixture.tar.gz'
            with tarfile.open(archive, 'w:gz') as stream:
                for name in ['package.json', 'package-lock.json', '.release-sha',
                             'server/index.js', 'dist/index.html', 'deploy/staging/start.mjs']:
                    content = (sha if name == '.release-sha' else '{}').encode()
                    entry = tarfile.TarInfo(name)
                    entry.size = len(content)
                    stream.addfile(entry, io.BytesIO(content))
                if extra:
                    stream.addfile(extra)
            return subprocess.run([sys.executable, str(ROOT / 'deploy/staging/verify-archive.py'),
                                   str(archive), SHA], capture_output=True, timeout=10).returncode

    def test_valid_archive(self):
        self.assertEqual(self.check_archive(), 0)

    def test_wrong_commit(self):
        self.assertNotEqual(self.check_archive(sha='b' * 40), 0)

    def test_traversal_and_private_files(self):
        for name in ['../outside', '/absolute', 'server/.env', 'server/media.db', 'uploads/private']:
            with self.subTest(name=name):
                self.assertNotEqual(self.check_archive(tarfile.TarInfo(name)), 0)

    def test_symlink(self):
        entry = tarfile.TarInfo('server/link')
        entry.type = tarfile.SYMTYPE
        entry.linkname = '/srv/services/MediaCode'
        self.assertNotEqual(self.check_archive(entry), 0)


if __name__ == '__main__':
    unittest.main()
