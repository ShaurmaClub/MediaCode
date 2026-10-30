#!/usr/bin/python3 -I
"""Loopback-only HTTP failures for the explicitly disposable VM, no data reads."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import time
import sys

assert Path('/etc/mediacode-lab-vm').exists() and os.uname().nodename == 'mediacode-vm-lab'
body = json.dumps(dict(ok=True, db='ok', schemaCompatible=True, frontendReady=True, commit='a' * 40)).encode()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == '/timeout':
            time.sleep(6)
            return
        output = body
        if self.path == '/empty':
            output = b''
        elif self.path == '/bad':
            output = b'{not-json'
        elif self.path == '/wrong':
            output = body.replace(b'a' * 40, b'f' * 40)
        self.send_response(500 if self.path == '/500' else 200)
        self.send_header('Content-Length', str(len(output) + (100 if self.path == '/partial' else 0)))
        self.end_headers()
        self.wfile.write(output)
        self.close_connection = True


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
with open(os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as ready:
    ready.write(str(server.server_port))
server.serve_forever()
