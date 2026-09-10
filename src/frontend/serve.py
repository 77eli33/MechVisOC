import http.server
import webbrowser
from pathlib import Path

PORT = 8000
DIRECTORY = Path(__file__).parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)


if __name__ == "__main__":
    url = f"http://localhost:{PORT}"
    print(f"Serving frontend at {url}")
    webbrowser.open(url)
    http.server.HTTPServer(("localhost", PORT), Handler).serve_forever()
