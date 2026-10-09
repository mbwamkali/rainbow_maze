"""Run the web app's browser tests (web/tests/index.html) in headless Firefox.

    python3 web/tests/run.py              # all tests at 1x pixel density
    python3 web/tests/run.py --dpr 2      # as on a high-DPI screen
    python3 web/tests/run.py --browser /path/to/firefox

Serves web/ on a local port, opens the test page in a throwaway Firefox profile,
waits for the page to post its results, prints them, and exits 1 if any failed.
To watch the tests run instead, serve web/ (e.g. `python3 -m http.server -d web`)
and open http://localhost:8000/tests/ in any browser.
"""

import argparse
import functools
import http.server
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    results = None
    done = threading.Event()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/progress":
            # One test finished (or the run started); show it as it happens.
            if "started" in body:
                print(f"running {body['started']} tests…", flush=True)
            else:
                print(f"{'ok  ' if body['ok'] else 'FAIL'} {body['name']} ({body['ms']}ms)", flush=True)
        elif self.path == "/results":
            Handler.results = body
            Handler.done.set()
        else:
            self.send_error(404)
            return
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


def profile_dir():
    # Snap-packaged Firefox can only read profiles under its own snap directory
    # (and /usr/bin/firefox may just be a wrapper that starts the snap).
    snap = Path.home() / "snap" / "firefox" / "common"
    if snap.is_dir():
        return tempfile.mkdtemp(prefix="rainbow-maze-tests-", dir=snap)
    return tempfile.mkdtemp(prefix="rainbow-maze-tests-")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--browser", default=shutil.which("firefox"), help="path to Firefox")
    parser.add_argument("--dpr", default="1", help="device pixel ratio to test at (default 1)")
    parser.add_argument("--timeout", type=float, default=300, help="seconds to wait for the tests")
    args = parser.parse_args()
    if not args.browser:
        sys.exit("Firefox not found; pass --browser /path/to/firefox")

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(WEB)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/tests/index.html?report"

    profile = profile_dir()
    Path(profile, "user.js").write_text(
        f'user_pref("layout.css.devPixelsPerPx", "{args.dpr}");\n'
        'user_pref("browser.shell.checkDefaultBrowser", false);\n'
    )
    browser = subprocess.Popen(
        [args.browser, "--headless", "--no-remote", "--profile", profile, "--window-size=1100,1000", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
    )
    try:
        finished = Handler.done.wait(args.timeout)
    finally:
        try:
            os.killpg(browser.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        browser.wait(timeout=30)
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    if not finished:
        sys.exit(f"Timed out after {args.timeout:.0f}s waiting for the tests to finish")
    failed = [r for r in Handler.results if not r["ok"]]
    for r in failed:
        print(f"\nFAIL {r['name']}\n     {r['error']}")
    print(f"\n{len(Handler.results) - len(failed)} passed, {len(failed)} failed (dpr {args.dpr})")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
