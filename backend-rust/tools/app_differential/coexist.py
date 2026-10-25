#!/usr/bin/env python3
"""Coexistence check: Play and Rust serving the SAME database (cutover stages 1-4).

Starts an extra Rust instance on Play's database (`wk_diff_play`, port 19597; requires `stack.py start`),
with background jobs off except the free-credit ticker, and checks cross-backend behavior:

  * sessions and API tokens issued by one backend authenticate on the other;
  * annotations created/edited through one backend read identically through the other;
  * an annotation mutex held via Play blocks another session via Rust and vice versa;
  * Rust's free-credit ticker does not re-grant credits Play already granted this month
    (database session time zone parity).

  python3 tools/app_differential/coexist.py
"""

from __future__ import annotations

import http.client
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import replay  # noqa: E402
import stack  # noqa: E402

PLAY = stack.PLAY_URI
SHARED_PORT = 19597
SHARED = f"http://127.0.0.1:{SHARED_PORT}"
DS = "68b80290d4000090f8f4aa62"
ADMIN = {"X-Auth-Token": stack.SAMPLE_TOKEN}
results: list[tuple[str, bool, str]] = []


def call(origin: str, method: str, path: str, headers: dict | None = None, body: object = None,
         form: dict | None = None) -> tuple[int, dict, object]:
    parsed = urllib.parse.urlsplit(origin)
    connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
    headers = {"Accept": "application/json", **(headers or {})}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    connection.request(method, path, body=data, headers=headers)
    response = connection.getresponse()
    raw = response.read()
    response_headers: dict[str, list[str]] = {}
    for name, value in response.getheaders():
        response_headers.setdefault(name.lower(), []).append(value)
    try:
        parsed_body: object = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        parsed_body = raw.decode(errors="replace")
    return response.status, response_headers, parsed_body


def check(name: str, condition: bool, detail: str = "") -> None:
    results.append((name, condition, detail))
    print(f"{'PASS' if condition else 'FAIL'} {name}" + (f"  ({detail})" if detail and not condition else ""))


def session_cookie(headers: dict) -> str | None:
    return next((c.split(";", 1)[0] for c in headers.get("set-cookie", []) if c.startswith("id=")), None)


def login(origin: str) -> str | None:
    status, headers, _ = call(origin, "POST", "/api/auth/login",
                              body={"email": "sample2@scm.io", "password": "secret"})
    return session_cookie(headers) if status == 200 else None


def same_json(a: object, b: object) -> list:
    norm = replay.Normalizer(run_start_ms=int(time.time() * 1000) - 600_000, tolerance_ms=120_000)
    diffs: list = []
    replay.compare(a, b, "$", norm, {"skip": ["$.lastActivity", "$.owner.lastActivity", "$.user.lastActivity"],
                                     "unordered": [], "unordered_keys": {"annotationLayers", "tags"}}, diffs)
    return diffs


def start_shared_rust() -> subprocess.Popen:
    env = stack.rust_env("wk_diff_play", *stack.play_runtime())
    env.update({
        "WK_BIND": f"127.0.0.1:{SHARED_PORT}",
        "WK_METRICS_BIND": "",
        "WK_HOUSEKEEPING_ENABLED": "false",
        "WK_USED_STORAGE_ENABLED": "false",
        "WK_WORKER_LIVENESS_ENABLED": "false",
        # Kept on deliberately: it must not duplicate Play's monthly grant on the shared database.
        "WK_CREDIT_TICKER_ENABLED": "true",
        "WK_CREDIT_TICKER_INITIAL_DELAY_SECONDS": "1",
    })
    log = open(stack.LOGS / "rust-shared.log", "ab")
    process = subprocess.Popen([str(stack.RUST_BINARY)], env=env, stdout=log, stderr=subprocess.STDOUT,
                               cwd=stack.BACKEND_RUST, start_new_session=True)
    stack.wait_http(f"{SHARED}/health/ready", 60, "rust-shared")
    return process


def main() -> int:
    if not stack.listening(stack.PORTS["play"]):
        raise SystemExit("start the stack first (stack.py start)")
    if stack.listening(SHARED_PORT):
        raise SystemExit(f"port {SHARED_PORT} busy")
    credits_sql = ("SELECT count(*) FROM webknossos.credit_transactions WHERE comment LIKE 'Complimentary credits%' "
                   "AND NOT is_deleted")
    credits_before = stack.psql("wk_diff_play", credits_sql)
    process = start_shared_rust()
    try:
        # Sessions and tokens across backends.
        for issuer, consumer in ((PLAY, SHARED), (SHARED, PLAY)):
            label = "play->rust" if issuer == PLAY else "rust->play"
            cookie = login(issuer)
            status, _, user = call(consumer, "GET", "/api/user", {"Cookie": cookie or ""})
            check(f"session cookie {label}", status == 200 and isinstance(user, dict)
                  and user.get("email") == "sample2@scm.io", f"status {status}")
            status, _, token = call(issuer, "GET", "/api/auth/token", {"Cookie": cookie or ""})
            token_value = token.get("token") if isinstance(token, dict) else None
            status, _, user = call(consumer, "GET", "/api/user", {"X-Auth-Token": token_value or ""})
            check(f"api token {label}", status == 200, f"status {status}")

        # Store RPCs: the tracingstore validates the caller's service token by calling back the
        # application at its webKnossos.uri (here Play). Play's RpcTokenHolder token is random per
        # process and not configurable, so a Rust-issued store call is rejected. KNOWN BLOCKER until
        # Play reads the token from configuration and both share it (see CUTOVER.md §2).
        status, _, _ = call(SHARED, "POST", f"/api/datasets/{DS}/createExplorational", ADMIN,
                            [{"typ": "Skeleton", "name": "Skeleton"}])
        known_blocker = status == 403
        print(f"{'KNOWN' if known_blocker else 'PASS ' if status == 200 else 'FAIL '} store RPC from rust validated "
              f"by play (status {status}; needs a shared, configurable RPC token)")

        # Annotation written through Play, edited through Rust, read through both.
        status, _, created = call(PLAY, "POST", f"/api/datasets/{DS}/createExplorational", ADMIN,
                                  [{"typ": "Skeleton", "name": "Skeleton"}])
        annotation = created.get("id") if isinstance(created, dict) else None
        check("create explorational via play", status == 200 and bool(annotation), f"status {status}")
        status, _, _ = call(SHARED, "PATCH", f"/api/annotations/Explorational/{annotation}/edit", ADMIN,
                            {"name": "edited via rust", "visibility": "Internal"})
        check("edit via rust", status == 200, f"status {status}")
        play_status, _, play_info = call(PLAY, "GET", f"/api/annotations/{annotation}/info", ADMIN)
        rust_status, _, rust_info = call(SHARED, "GET", f"/api/annotations/{annotation}/info", ADMIN)
        diffs = same_json(play_info, rust_info)
        check("info identical on both backends", play_status == rust_status == 200 and not diffs,
              f"{play_status}/{rust_status} {diffs[:3]}")
        check("play sees rust's edit", isinstance(play_info, dict) and play_info.get("name") == "edited via rust")

        # Annotation mutex across backends (Exclusive collaboration mode).
        status, _, _ = call(PLAY, "PATCH", f"/api/annotations/Explorational/{annotation}/collaborationMode"
                                           "?collaborationMode=Exclusive", ADMIN)
        check("collaboration mode Exclusive via play", status == 200, f"status {status}")
        status, _, _ = call(PLAY, "POST", f"/api/annotations/{annotation}/acquireMutex?sessionId=play-session", ADMIN)
        check("mutex acquired via play", status == 200, f"status {status}")
        status, _, body = call(SHARED, "POST", f"/api/annotations/{annotation}/acquireMutex?sessionId=rust-session",
                               ADMIN)
        check("rust respects play's mutex", isinstance(body, dict) and body.get("canEdit") is False,
              f"status {status} {body}")
        call(PLAY, "POST", f"/api/annotations/{annotation}/releaseMutex?sessionId=play-session", ADMIN)
        status, _, body = call(SHARED, "POST", f"/api/annotations/{annotation}/acquireMutex?sessionId=rust-session",
                               ADMIN)
        check("mutex acquired via rust after release", isinstance(body, dict) and body.get("canEdit") is True,
              f"status {status} {body}")
        status, _, body = call(PLAY, "POST", f"/api/annotations/{annotation}/acquireMutex?sessionId=play-session",
                               ADMIN)
        check("play respects rust's mutex", isinstance(body, dict) and body.get("canEdit") is False,
              f"status {status} {body}")

        # Free credits: the ticker ran 1 s after start on the shared database.
        time.sleep(4)
        credits_after = stack.psql("wk_diff_play", credits_sql)
        check("no duplicate monthly credits from rust ticker", credits_after == credits_before,
              f"{credits_before} -> {credits_after}")
    finally:
        os.killpg(process.pid, 15)
        process.wait(timeout=30)
    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} coexistence checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
