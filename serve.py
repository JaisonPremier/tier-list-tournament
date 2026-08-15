#!/usr/bin/env python3
import functools
import http.server
import os

DIR = os.path.dirname(__file__)
PORT = 8743

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIR)
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
print(f"Serving {DIR} on http://127.0.0.1:{PORT}")
httpd.serve_forever()
