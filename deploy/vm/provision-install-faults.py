#!/usr/bin/python3 -I
"""Root administrator test: fail two atomic publishes and retry on real VM."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch
sys.dont_write_bytecode = True
assert Path('/etc/mediacode-lab-vm').exists() and os.uname().nodename == 'mediacode-vm-lab'
source = '/srv/review'
spec = importlib.util.spec_from_file_location('installer', source + '/deploy/install-runtime-ops.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
sys.argv = [source + '/deploy/install-runtime-ops.py', source]
for target in ('/usr/local/sbin/mediacode-ops', '/etc/sudoers.d/mediacode-deploy'):
    original = os.replace
    hits = []

    def injected(src, dst):
        if str(dst) == target:
            hits.append(target)
            raise OSError('VM injected publication fault')
        return original(src, dst)

    with patch('os.replace', injected):
        try:
            installer.main()
        except OSError:
            pass
        else:
            raise AssertionError('publication fault not observed')
    assert hits == [target]
    subprocess.run(['/usr/sbin/visudo', '-c'], check=True, stdout=subprocess.DEVNULL)
    installer.main()
print('PASS 2 real helper/broker/sudoers publication faults and safe retries')
