# Dev preview server: static files with Cache-Control: no-store (always fresh)
import http.server, functools

class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('0.0.0.0', 8000), NoStoreHandler).serve_forever()
