#!/usr/bin/env python3
"""Differential replay of main application requests against Play and Rust.

Both servers must run against identical database clones (see stack.py). Every corpus step is sent
to both sides in order; per-side captured values (IDs, tokens, cookies) feed later steps. Responses
are compared on status, selected headers and body. JSON comparison is strict except for three
explicit, reported normalizations:

  * id bijection: two differing 24-hex ObjectIds (or captured values) at the same position must map
    1:1 for the whole run (a Play id may never pair with two Rust ids or vice versa);
  * timestamps: differing epoch-millisecond numbers / ISO strings created during the run are equal
    when within --time-tolerance seconds;
  * side rewrites: literal substrings (store URLs that legitimately differ per side) from the corpus.

Everything else, including field order inside arrays, missing/extra keys and number types, is a
mismatch unless the step declares it as an `expected_divergence` with a reason. After the corpus the
tool can diff both databases table by table (`--db-diff`) under the same normalizations.

Corpus format (JSON, version 1):
{
  "version": 1,
  "side_rewrites": {"rust": {"http://127.0.0.1:19595": "http://127.0.0.1:19590"}},
  "identities": {"admin": {"token": "secretSampleUserToken"}, "user2": {"token": "{user2Token}"}},
  "steps": [
    {"name": "teams-list", "as": "admin", "method": "GET", "path": "/api/teams",
     "query": {"isEditable": "true"}, "json": {...}, "form": {...}, "headers": {...},
     "multipart": {"fields": {...}, "files": {"file": {"filename": "a.zip", "content_path": "test/..."}}},
     "service": "datastore",  # Play's embedded datastore vs the standalone one serving Rust
     "expect_status": 200, "capture": {"teamId": "$.id"}, "capture_cookie": {"session": "id"},
     "unordered": ["$"], "ignore": [{"path": "$.foo", "reason": "..."}],
     "expected_divergence": {"reason": "...", "paths": ["$.bar"], "status_differs": false} }
  ]
}
"""

from __future__ import annotations

import argparse
import base64
import copy
import datetime as dt
import http.client
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

OBJECT_ID = re.compile(r"^[0-9a-f]{24}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
ISO_TIME = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:?\d\d)?$")
EMBEDDED_MS = re.compile(r"(?<!\d)1\d{12}(?!\d)")
VARIABLE = re.compile(r"\{([A-Za-z][A-Za-z0-9_]*)\}")
SENSITIVE = re.compile(r"token|password|secret|key|cookie", re.IGNORECASE)
COMPARED_HEADERS = ("content-type", "cache-control", "location", "content-disposition",
                    "access-control-allow-origin", "x-frame-options")
SIDES = ("play", "rust")


@dataclass
class Normalizer:
    run_start_ms: int
    tolerance_ms: int
    seed_ids: set[str] = field(default_factory=set)
    play_to_rust: dict[str, str] = field(default_factory=dict)
    rust_to_play: dict[str, str] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=lambda: {"id_pairs": 0, "timestamps": 0})

    def pair(self, play: str, rust: str) -> bool:
        if play in self.seed_ids or rust in self.seed_ids:
            return False  # ids that exist in the shared seed must be identical on both sides
        known_rust = self.play_to_rust.get(play)
        known_play = self.rust_to_play.get(rust)
        if known_rust is None and known_play is None:
            self.play_to_rust[play] = rust
            self.rust_to_play[rust] = play
            self.counts["id_pairs"] += 1
            return True
        return known_rust == rust and known_play == play

    def map_rust_text(self, text: str) -> str:
        for rust, play in self.rust_to_play.items():
            if len(rust) >= 8 and rust in text:
                text = text.replace(rust, play)
        return text

    def pair_embedded_ids(self, play: str, rust: str) -> bool:
        """Equal texts except for generated ids at the same positions (e.g. ids inside messages)."""
        pattern = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?<![0-9a-f])[0-9a-f]{24}(?![0-9a-f])")
        play_ids, rust_ids = pattern.findall(play), pattern.findall(rust)
        if not play_ids or len(play_ids) != len(rust_ids):
            return False
        if pattern.sub("<id>", play) != pattern.sub("<id>", rust):
            return False
        return all(a == b or self.pair(a, b) for a, b in zip(play_ids, rust_ids))

    def map_id_suffixes(self, text: str) -> str:
        """Download filenames embed the last 6 characters of an id (e.g. `__explorational__suser__697789.zip`)."""
        for rust, play in self.rust_to_play.items():
            if OBJECT_ID.match(rust):
                text = text.replace(f"__{rust[-6:]}.", f"__{play[-6:]}.")
        return text

    def mask_embedded_times(self, text: str) -> str:
        """Replaces run-time epoch milliseconds inside strings (e.g. `name.deleted.at.<ms>`)."""
        return EMBEDDED_MS.sub(lambda m: "<run-time>" if self.is_run_time_ms(int(m.group(0))) else m.group(0), text)

    def is_run_time_ms(self, value: Any) -> bool:
        return (isinstance(value, int) and not isinstance(value, bool)
                and self.run_start_ms - 60_000 <= value <= int(time.time() * 1000) + 60_000)

    def same_time(self, a: Any, b: Any) -> bool:
        if self.is_run_time_ms(a) and self.is_run_time_ms(b):
            ok = abs(a - b) <= self.tolerance_ms
        elif isinstance(a, str) and isinstance(b, str) and ISO_TIME.match(a) and ISO_TIME.match(b):
            ta, tb = parse_iso(a), parse_iso(b)
            ok = (ta is not None and tb is not None and ta >= self.run_start_ms - 60_000
                  and abs(ta - tb) <= self.tolerance_ms)
        else:
            return False
        if ok:
            self.counts["timestamps"] += 1
        return ok


def parse_iso(value: str) -> int | None:
    try:
        return int(dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


SERVER_TIME = re.compile(r"\[Server Time [^\]]*\]")


def path_matches(pattern: str, path: str) -> bool:
    regex = re.escape(pattern).replace(r"\[\*\]", r"\[\d+\]").replace(r"\*", r"[^.\[]+")
    return re.fullmatch(regex + r"(\..*|\[.*)?", path) is not None


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def compare(play: Any, rust: Any, path: str, norm: Normalizer, opts: dict, diffs: list) -> None:
    if any(path_matches(p, path) for p in opts["skip"]):
        return
    if type(play) is not type(rust):
        if not norm.same_time(play, rust):
            diffs.append((path, "type", preview(play), preview(rust)))
        return
    if isinstance(play, dict):
        for key in sorted(set(play) | set(rust)):
            sub = f"{path}.{key}"
            if key not in rust:
                if not any(path_matches(p, sub) for p in opts["skip"]):
                    diffs.append((sub, "missing-in-rust", preview(play[key]), None))
            elif key not in play:
                if not any(path_matches(p, sub) for p in opts["skip"]):
                    diffs.append((sub, "extra-in-rust", None, preview(rust[key])))
            else:
                compare(play[key], rust[key], sub, norm, opts, diffs)
        return
    if isinstance(play, list):
        if len(play) != len(rust):
            diffs.append((path, f"length {len(play)}!={len(rust)}", None, None))
            return
        last_key = re.sub(r"\[\d+\]", "", path).rsplit(".", 1)[-1]
        if last_key in opts["unordered_keys"] or any(
                path_matches(p, path) and p.count(".") == path.count(".") for p in opts["unordered"]):
            play, rust = sort_for_unordered(play, rust, norm)
        for index, (a, b) in enumerate(zip(play, rust)):
            compare(a, b, f"{path}[{index}]", norm, opts, diffs)
        return
    if play == rust:
        return
    if isinstance(play, str) and isinstance(rust, str):
        generated = (OBJECT_ID.match(play) and OBJECT_ID.match(rust)) or (UUID.match(play) and UUID.match(rust))
        if generated or play in norm.play_to_rust or rust in norm.rust_to_play:
            if norm.pair(play, rust):
                return
            diffs.append((path, "id-bijection", preview(play), preview(rust)))
            return
        if norm.map_rust_text(rust) == play:
            return
        if norm.mask_embedded_times(norm.map_rust_text(rust)) == norm.mask_embedded_times(play) != play:
            norm.counts["timestamps"] += 1
            return
        if norm.pair_embedded_ids(play, rust):
            return
    if norm.same_time(play, rust):
        return
    diffs.append((path, "value", preview(play), preview(rust)))


def sort_for_unordered(play: list, rust: list, norm: Normalizer) -> tuple[list, list]:
    """Sorts both sides by a stable identity (id/_id/name, then the whole item) for order-free lists."""
    def identity(item: Any, side: str) -> str:
        if isinstance(item, dict):
            for key in ("id", "_id", "email", "name"):
                if isinstance(item.get(key), str):
                    value = item[key]
                    return norm.rust_to_play.get(value, value) if side == "rust" else value
        text = canonical(item)
        return norm.map_rust_text(text) if side == "rust" else text

    def key_play(item: Any) -> str:
        return identity(item, "play")

    def key_rust(item: Any) -> str:
        return identity(item, "rust")

    return sorted(play, key=key_play), sorted(rust, key=key_rust)


def preview(value: Any, path_hint: str = "") -> str | None:
    if value is None:
        return "null"
    text = canonical(value)
    return text if len(text) <= 160 else text[:157] + "..."


def redact_diff(diff: tuple) -> dict:
    path, kind, play, rust = diff
    if SENSITIVE.search(path):
        play = "<redacted>" if play is not None else None
        rust = "<redacted>" if rust is not None else None
    return {"path": path, "kind": kind, "play": play, "rust": rust}


def json_path_get(document: Any, path: str) -> Any:
    if path == "$":
        return document
    current = document
    for token in re.findall(r"\.([^.\[]+)|\[(\d+)\]", path[1:]):
        key, index = token
        if key:
            current = current[key]
        else:
            current = current[int(index)]
    return current


def substitute(value: Any, variables: dict[str, str]) -> Any:
    if isinstance(value, str):
        def replace(match: re.Match) -> str:
            name = match.group(1)
            if name not in variables:
                raise KeyError(name)
            return str(variables[name])
        whole = VARIABLE.fullmatch(value)
        if whole and whole.group(1) in variables and not isinstance(variables[whole.group(1)], str):
            return variables[whole.group(1)]
        return VARIABLE.sub(replace, value)
    if isinstance(value, list):
        return [substitute(item, variables) for item in value]
    if isinstance(value, dict):
        return {key: substitute(item, variables) for key, item in value.items()}
    return value


@dataclass
class Response:
    status: int
    headers: dict[str, list[str]]
    body: bytes
    millis: float


def send(origin: str, method: str, path: str, query: dict, headers: dict, body: bytes | None,
         timeout: float) -> Response:
    parsed = urllib.parse.urlsplit(origin)
    target = path + (("?" + urllib.parse.urlencode(query, doseq=True)) if query else "")
    connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=timeout)
    started = time.perf_counter()
    try:
        connection.request(method, target, body=body, headers=headers)
        response = connection.getresponse()
        data = response.read()
        collected: dict[str, list[str]] = {}
        for name, value in response.getheaders():
            collected.setdefault(name.lower(), []).append(value)
        return Response(response.status, collected, data, (time.perf_counter() - started) * 1000)
    finally:
        connection.close()


def parse_body(response: Response, rewrites: dict[str, str]) -> Any:
    if response.body[:4] == b"PK\x03\x04":
        # Compare archives by entry (name -> decoded text), not by compression/timestamp bytes.
        try:
            with zipfile.ZipFile(io.BytesIO(response.body)) as archive:
                return {"<zip>": {info.filename: rewrite_text(
                    archive.read(info).decode("utf-8", errors="replace"), rewrites)
                    for info in archive.infolist()}}
        except zipfile.BadZipFile:
            return {"<invalid-zip>": len(response.body)}
    text = response.body.decode("utf-8", errors="replace")
    for old, new in rewrites.items():
        text = text.replace(old, new)
    content_type = ",".join(response.headers.get("content-type", []))
    if "json" in content_type:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"<invalid-json>": text[:200]}
    return {"<text>": text} if text else None


def build_request(step: dict, identity: dict | None, variables: dict) -> tuple[dict, dict, bytes | None]:
    headers = {"Accept": "application/json"}
    if identity:
        identity = substitute(identity, variables)
        if "token" in identity:
            headers["X-Auth-Token"] = identity["token"]
        if "cookie" in identity:
            headers["Cookie"] = identity["cookie"]
    headers.update(substitute(step.get("headers", {}), variables))
    query = substitute(step.get("query", {}), variables)
    body = None
    if "json" in step:
        body = json.dumps(substitute(step["json"], variables)).encode()
        headers["Content-Type"] = "application/json"
    elif "form" in step:
        body = urllib.parse.urlencode(substitute(step["form"], variables)).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif "raw" in step:
        body = substitute(step["raw"], variables).encode()
        headers.setdefault("Content-Type", "text/plain")
    elif "hook" in step:
        # Bodies computed from this side's captures, e.g. WebAuthn ceremonies over its own challenge.
        import webauthn_client  # noqa: PLC0415 (next to this script, which is on sys.path[0])
        body = json.dumps(webauthn_client.hook(step["hook"], variables,
                                               substitute(step.get("hook_args", {}), variables))).encode()
        headers["Content-Type"] = "application/json"
    elif "multipart" in step:
        body, content_type = multipart(substitute(step["multipart"], variables))
        headers["Content-Type"] = content_type
    return headers, query, body


def multipart(spec: dict) -> tuple[bytes, str]:
    """{"fields": {name: text}, "files": {name: {"filename": ..., "content" | "content_b64" | "content_path": ...}}}"""
    boundary = "wkdiffboundary7c1f0e"
    parts: list[bytes] = []
    for name, value in spec.get("fields", {}).items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for name, file in spec.get("files", {}).items():
        if "content_path" in file:  # relative to the repository root, e.g. test/dataset/test-dataset.zip
            content = (Path(__file__).resolve().parents[3] / file["content_path"]).read_bytes()
        elif "content_b64" in file:
            content = base64.b64decode(file["content_b64"])
        else:
            content = file["content"].encode()
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{file["filename"]}"'
                     f'\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def run_corpus(corpus: dict, origins: dict, norm: Normalizer, timeout: float, only: str | None,
               seed_vars: dict | None = None) -> list[dict]:
    variables = {side: {**(seed_vars or {}), **corpus.get("variables", {})} for side in SIDES}
    rewrites = {side: corpus.get("side_rewrites", {}).get(side, {}) for side in SIDES}
    # corpus-wide declared header divergences: {"cache-control": "reason"}
    header_divergences = corpus.get("header_divergences", {})
    results = []
    for step in corpus["steps"]:
        if only and not re.search(only, step["name"]):
            continue
        identity_name = step.get("as")
        responses: dict[str, Response] = {}
        error = None
        for side in SIDES:
            identity = corpus["identities"].get(identity_name) if identity_name else None
            try:
                headers, query, body = build_request(step, identity, variables[side])
                path = substitute(step["path"], variables[side])
            except KeyError as missing:
                error = f"undefined variable {missing} on {side}"
                break
            try:
                # "service": "datastore" targets Play's embedded datastore vs Rust's standalone one.
                origin = origins[f"{side}:{step['service']}"] if "service" in step else origins[side]
                responses[side] = send(origin, step.get("method", "GET"), path, query, headers, body, timeout)
            except Exception as exc:  # transport failure is always a mismatch
                error = f"{side} transport: {type(exc).__name__}"
                break
        result = {"name": step["name"], "method": step.get("method", "GET"), "path": step["path"]}
        if error:
            result.update(ok=False, error=error)
            results.append(result)
            continue
        play, rust = responses["play"], responses["rust"]
        result["status"] = [play.status, rust.status]
        result["millis"] = [round(play.millis, 1), round(rust.millis, 1)]
        diffs: list = []
        if play.status != rust.status:
            diffs.append(("<status>", "value", str(play.status), str(rust.status)))
        expected = step.get("expect_status")
        if expected is not None and play.status != expected:
            diffs.append(("<status>", "play-unexpected", str(play.status), str(expected)))
        for name in COMPARED_HEADERS:
            if name in header_divergences:
                continue
            if "service" in step and name == "x-frame-options":
                continue  # Play's embedded store answers through Play's filters, the standalone one does not
            a = play.headers.get(name)
            b = rust.headers.get(name)
            if b is not None:
                b = [norm.map_id_suffixes(norm.map_rust_text(rewrite_text(v, rewrites["rust"]))) for v in b]
            if a is not None:
                a = [rewrite_text(v, rewrites["play"]) for v in a]
            if name == "content-type" and a and b:
                a, b = [v.replace(" ", "").lower() for v in a], [v.replace(" ", "").lower() for v in b]
            if a != b:
                diffs.append((f"<header:{name}>", "value", preview(a), preview(b)))
        if "set-cookie" not in header_divergences:
            a, b = cookie_shape(play.headers.get("set-cookie", [])), cookie_shape(rust.headers.get("set-cookie", []))
            if a != b:
                diffs.append(("<header:set-cookie>", "attributes", preview(a), preview(b)))
        body_play = parse_body(play, rewrites["play"])
        body_rust = parse_body(rust, rewrites["rust"])
        if isinstance(body_rust, dict) and isinstance(body_rust.get("<zip>"), dict):
            body_rust["<zip>"] = {norm.map_id_suffixes(name): text for name, text in body_rust["<zip>"].items()}
        # Play's {"chain": "[Server Time …] …"} debug entries: compared without the time when Rust sends
        # them too, dropped otherwise. Store steps hit Scala on both sides, so they are dropped on both.
        def chains(body: Any) -> list:
            if isinstance(body, dict) and isinstance(body.get("messages"), list):
                return [m for m in body["messages"] if isinstance(m, dict) and set(m) == {"chain"}]
            return []
        if chains(body_rust) and "service" not in step:
            for body in (body_play, body_rust):
                for m in chains(body):
                    m["chain"] = SERVER_TIME.sub("[Server Time <time>]", m["chain"])
        else:
            chain_sides = [body_play, body_rust] if "service" in step else [body_play]
            for body in chain_sides if corpus.get("drop_play_chain_messages") else []:
                if chains(body):
                    kept = [m for m in body["messages"] if m not in chains(body)]
                    norm.counts["chain_messages"] = (norm.counts.get("chain_messages", 0)
                                                     + len(body["messages"]) - len(kept))
                    body["messages"] = kept
        opts = {
            "skip": [entry["path"] for entry in step.get("ignore", [])]
            + step.get("expected_divergence", {}).get("paths", []),
            "unordered": step.get("unordered", []),
            "unordered_keys": set(corpus.get("unordered_keys", {})),
        }
        compare(body_play, body_rust, "$", norm, opts, diffs)
        for side, response, body in (("play", play, body_play), ("rust", rust, body_rust)):
            for var, json_path in step.get("capture", {}).items():
                try:
                    variables[side][var] = json_path_get(body, json_path)
                except (KeyError, IndexError, TypeError):
                    diffs.append((f"<capture:{var}>", f"missing-on-{side}", None, None))
            for var, cookie_name in step.get("capture_cookie", {}).items():
                cookie = next((c.split(";", 1)[0] for c in response.headers.get("set-cookie", [])
                               if c.startswith(cookie_name + "=")), None)
                if cookie is None:
                    diffs.append((f"<cookie:{var}>", f"missing-on-{side}", None, None))
                else:
                    variables[side][var] = cookie
        for var in list(step.get("capture", {})) + list(step.get("capture_cookie", {})):
            a, b = variables["play"].get(var), variables["rust"].get(var)
            if isinstance(a, str) and isinstance(b, str) and a != b:
                if not norm.pair(a, b):
                    diffs.append((f"<capture:{var}>", "id-bijection", None, None))
        declaration = step.get("expected_divergence")
        if declaration:
            # A declaration covers its body paths, and differing statuses/headers only when it lists them
            # ("status_differs": true, "headers": [...]); every other difference still fails the step.
            declared = {f"<header:{name}>" for name in declaration.get("headers", [])}
            if declaration.get("status_differs"):
                declared.add("<status>")
            leftover = [d for d in diffs if not (d[0] in declared and d[1] in ("value", "attributes"))]
            # Probe the declared paths on a copy of the normalizer (no id pairs from declared paths leak into
            # the run): a declaration with nothing left to declare is stale and reported as such.
            probe: list = []
            compare(body_play, body_rust, "$", copy.deepcopy(norm), {**opts, "skip": [e["path"] for e in step.get("ignore", [])]}, probe)
            result["expected_divergence"] = declaration["reason"]
            if not probe and len(leftover) == len(diffs):
                result["stale_declaration"] = True
            diffs = leftover
        result["ok"] = not diffs
        if diffs:
            result["diffs"] = [redact_diff(d) for d in diffs[:25]]
            result["diff_count"] = len(diffs)
        results.append(result)
    return results


def cookie_shape(cookies: list[str]) -> list[str]:
    """Cookie names, whether a value is set, and attributes; values and absolute expiry dates are masked."""
    shapes = []
    for cookie in cookies:
        name_value, *attributes = [part.strip() for part in cookie.split(";")]
        name, _, value = name_value.partition("=")
        kept = sorted(
            ("Expires=<date>" if attribute.lower().startswith("expires=") else attribute).lower()
            for attribute in attributes if attribute)
        shapes.append(f"{name}={'<value>' if value else ''};" + ";".join(kept))
    return sorted(shapes)


def rewrite_text(text: str, rewrites: dict[str, str]) -> str:
    for old, new in rewrites.items():
        text = text.replace(old, new)
    return text


# ---------------------------------------------------------------- database diff


def dump_tables(database: str, pg: dict) -> dict[str, list[Any]]:
    tables = run_psql(database, pg, "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables "
                                     "WHERE table_schema = 'webknossos' AND table_type = 'BASE TABLE'").split(",")
    dumped = {}
    for table in tables:
        text = run_psql(database, pg, f'SELECT coalesce(json_agg(t), \'[]\') FROM webknossos."{table}" t')
        dumped[table] = json.loads(text)
    return dumped


def run_psql(database: str, pg: dict, sql: str) -> str:
    result = subprocess.run(["psql", "-h", pg["host"], "-p", pg["port"], "-U", pg["user"], "-d", database,
                             "-Atq", "-v", "ON_ERROR_STOP=1", "-c", sql],
                            env={**os.environ, "PGPASSWORD": pg["password"]},
                            capture_output=True, text=True, check=True)
    return result.stdout.strip()


def normalize_row(row: Any, norm: Normalizer, side: str, seed_ids: set[str], rewrites: dict) -> Any:
    if isinstance(row, dict):
        return {k: normalize_row(v, norm, side, seed_ids, rewrites) for k, v in row.items()}
    if isinstance(row, list):
        return [normalize_row(v, norm, side, seed_ids, rewrites) for v in row]
    if isinstance(row, str):
        row = norm.mask_embedded_times(rewrite_text(row, rewrites.get(side, {})))
        if side == "rust":
            # whole ids, and ids embedded in texts (directory names, model paths, credit comments)
            row = norm.rust_to_play.get(row) or norm.map_rust_text(row)
        if OBJECT_ID.match(row) and row not in seed_ids and row not in norm.play_to_rust:
            return "<unpaired-id>"
        if UUID.match(row) and row not in norm.play_to_rust:
            return "<unpaired-uuid>"
        if ISO_TIME.match(row.replace(" ", "T")) and (parse_iso(row.replace(" ", "T")) or 0) >= norm.run_start_ms - 60_000:
            return "<run-time>"
        return row
    if norm.is_run_time_ms(row):
        return "<run-time>"
    return row


PG = {"host": "127.0.0.1", "port": "5432", "user": "postgres", "password": "postgres"}


# Play's initial data generates the sample team, root folder, users and project ids (ObjectId.generate), so they
# change with every `stack.py seed`. Corpora refer to them as {seed…} variables, resolved here from the seed.
SEED_VARIABLES = {
    "seedTeamId": "SELECT _id FROM webknossos.teams WHERE _organization = 'sample_organization' AND isOrganizationTeam",
    "seedRootFolderId": "SELECT _rootFolder FROM webknossos.organizations WHERE _id = 'sample_organization'",
    "seedAdminId": "SELECT u._id FROM webknossos.users u JOIN webknossos.multiUsers m ON m._id = u._multiUser "
                   "WHERE m.email = 'sample@scm.io'",
    "seedUser2Id": "SELECT u._id FROM webknossos.users u JOIN webknossos.multiUsers m ON m._id = u._multiUser "
                   "WHERE m.email = 'sample2@scm.io'",
    "seedProjectId": "SELECT _id FROM webknossos.projects WHERE name = 'sampleProject'",
}


def seed_variables(pg: dict, seed_db: str) -> dict[str, str]:
    return {name: run_psql(seed_db, pg, sql) for name, sql in SEED_VARIABLES.items()}


def seed_object_ids(pg: dict, seed_db: str) -> set[str]:
    seed = dump_tables(seed_db, pg)
    return {v for rows in seed.values() for row in rows for v in row.values()
            if isinstance(v, str) and OBJECT_ID.match(v)}


def db_diff(norm: Normalizer, pg: dict, seed_db: str, rewrites: dict, random_columns: dict,
            declared_rows: dict | None = None) -> dict:
    """declared_rows: {table: [{column: value}, ...]}; rows matching one filter (on either side) are left out."""
    seed_ids = norm.seed_ids
    seed = dump_tables(seed_db, pg)
    seed_values = {(table, column): {canonical(row.get(column)) for row in seed.get(table, [])}
                   for table, columns in random_columns.items() for column in columns}
    dumps = {"play": dump_tables("wk_diff_play", pg), "rust": dump_tables("wk_diff_rust", pg)}
    report = {}
    row_filters = declared_rows or {}
    stale_rows = []
    for table in sorted(set(dumps["play"]) | set(dumps["rust"])):
        rows = {}
        unfiltered = {}
        for side in SIDES:
            masked = []
            unfiltered[side] = []
            for r in dumps[side].get(table, []):
                declared = any(all(r.get(k) == v for k, v in f.items()) for f in row_filters.get(table, []))
                for column in random_columns.get(table, ()):
                    # Random secrets (token values, password hashes): only presence/emptiness is compared,
                    # unless the value is unchanged from the seed.
                    if column in r and canonical(r[column]) not in seed_values.get((table, column), set()):
                        r[column] = "<random>" if r[column] else r[column]
                normalized = canonical(normalize_row(r, norm, side, seed_ids, rewrites))
                unfiltered[side].append(normalized)
                if not declared:
                    masked.append(normalized)
            rows[side] = sorted(masked)
        if table in row_filters and sorted(unfiltered["play"]) == sorted(unfiltered["rust"]):
            stale_rows.append(table)  # the declared rows no longer differ
        if rows["play"] == rows["rust"]:
            continue
        only_play = multiset_minus(rows["play"], rows["rust"])
        only_rust = multiset_minus(rows["rust"], rows["play"])
        report[table] = {"play_rows": len(rows["play"]), "rust_rows": len(rows["rust"]),
                         "only_play": [redact_row(r) for r in only_play[:5]],
                         "only_rust": [redact_row(r) for r in only_rust[:5]],
                         "only_play_count": len(only_play), "only_rust_count": len(only_rust)}
    if stale_rows:
        report["<stale-row-declarations>"] = stale_rows
    return report


def multiset_minus(a: list[str], b: list[str]) -> list[str]:
    remaining = {}
    for item in b:
        remaining[item] = remaining.get(item, 0) + 1
    out = []
    for item in a:
        if remaining.get(item, 0):
            remaining[item] -= 1
        else:
            out.append(item)
    return out


def redact_row(text: str) -> Any:
    row = json.loads(text)
    if isinstance(row, dict):
        return {k: ("<redacted>" if SENSITIVE.search(k) and v not in (None, "") else v) for k, v in row.items()}
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("corpus", nargs="+", type=Path)
    parser.add_argument("--play", default="http://127.0.0.1:19590")
    parser.add_argument("--rust", default="http://127.0.0.1:19591")
    parser.add_argument("--rust-datastore", default="http://127.0.0.1:19595")
    parser.add_argument("--rust-tracingstore", default="http://127.0.0.1:19596")
    parser.add_argument("--time-tolerance", type=float, default=120.0)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--only", help="regex on step names")
    parser.add_argument("--db-diff", action="store_true", help="diff wk_diff_play vs wk_diff_rust afterwards")
    parser.add_argument("--report", type=Path, help="write the full JSON report here")
    parser.add_argument("--verbose", action="store_true", help="print diffs of every failing step")
    args = parser.parse_args()
    # Timestamps written since the databases were cloned (stack.py reset) count as run-generated.
    reset_marker = Path("/tmp/wk-diff/reset_at_ms")
    run_start = int(reset_marker.read_text()) if reset_marker.exists() else int(time.time() * 1000)
    norm = Normalizer(run_start_ms=run_start, tolerance_ms=int(args.time_tolerance * 1000))
    norm.seed_ids = seed_object_ids(PG, "wk_diff_seed")
    seed_vars = seed_variables(PG, "wk_diff_seed")
    origins = {"play": args.play, "rust": args.rust, "play:datastore": args.play, "play:tracingstore": args.play,
               "rust:datastore": args.rust_datastore, "rust:tracingstore": args.rust_tracingstore}
    all_results = []
    rewrites: dict = {}
    db_divergences: dict = {}
    declared_rows: dict = {}
    random_columns: dict = {}
    loaded = [(path, json.loads(path.read_text())) for path in args.corpus]
    # Corpora that change shared credentials ("run_last": reason) run after the others.
    loaded.sort(key=lambda entry: bool(entry[1].get("run_last")))
    public_uri_file = Path("/tmp/wk-diff/public_uri")
    public_uri = public_uri_file.read_text().strip() if public_uri_file.exists() else None
    skipped = []
    for path, corpus in loaded:
        required = corpus.get("requires_public_uri")
        if required and required != public_uri:
            print(f"SKIP {path.name}: needs the stack started with WK_DIFF_PUBLIC_URI={required} "
                  f"(running: {public_uri})")
            skipped.append(path.name)
            continue
        if corpus.get("version") != 1 or not corpus.get("steps"):
            print(f"invalid corpus {path}", file=sys.stderr)
            return 2
        # A table-level declaration is a reason string; {"reason", "rows": [filters]} declares only matching rows.
        for table, declaration in corpus.get("db_divergences", {}).items():
            if isinstance(declaration, dict):
                declared_rows.setdefault(table, []).extend(declaration["rows"])
            else:
                db_divergences[table] = declaration
        for qualified in corpus.get("db_random_columns", {}):
            table, column = qualified.split(".", 1)
            random_columns.setdefault(table, set()).add(column)
        for side, mapping in corpus.get("side_rewrites", {}).items():
            rewrites.setdefault(side, {}).update(mapping)
        names = [s["name"] for s in corpus["steps"]]
        if len(names) != len(set(names)):
            print(f"duplicate step names in {path}", file=sys.stderr)
            return 2
        for result in run_corpus(corpus, origins, norm, args.timeout, args.only, seed_vars):
            result["corpus"] = path.name
            all_results.append(result)
    report: dict[str, Any] = {"results": all_results, "normalizations": norm.counts}
    if args.db_diff:
        report["db_diff"] = db_diff(norm, PG, "wk_diff_seed", rewrites, random_columns, declared_rows)
    failed = [r for r in all_results if not r["ok"]]
    divergent = [r for r in all_results if r["ok"] and "expected_divergence" in r]
    stale = [r for r in all_results if r.get("stale_declaration")]
    for r in all_results:
        mark = "FAIL" if not r["ok"] else ("STALE" if r.get("stale_declaration") else
                                          "DIV " if "expected_divergence" in r else "ok  ")
        status = r.get("status", r.get("error"))
        print(f"{mark} {r['corpus']}:{r['name']} {r['method']} {r['path']} {status} {r.get('millis', '')}")
        if not r["ok"] or (args.verbose and "expected_divergence" in r):
            for diff in r.get("diffs", []):
                print(f"       {diff['path']} [{diff['kind']}] play={diff['play']} rust={diff['rust']}")
    stale_db: list[str] = []
    if args.db_diff:
        stale_db = report["db_diff"].pop("<stale-row-declarations>", [])
        stale_db += [table for table in db_divergences if table not in report["db_diff"]]
        for table in stale_db:
            print(f"STALE db declaration {table}: no difference left")
        for table, info in report["db_diff"].items():
            if table in db_divergences:
                info["expected_divergence"] = db_divergences[table]
            mark = "DBDIV" if table in db_divergences else "DB  "
            print(f"{mark} {table}: play {info['play_rows']} rows, rust {info['rust_rows']} rows, "
                  f"only-play {info['only_play_count']}, only-rust {info['only_rust_count']}")
            if args.verbose:
                for row in info["only_play"]:
                    print(f"       play-only {canonical(row)[:300]}")
                for row in info["only_rust"]:
                    print(f"       rust-only {canonical(row)[:300]}")
    print(f"\n{len(all_results)} steps: {len(all_results) - len(failed) - len(divergent)} match, "
          f"{len(divergent)} declared divergences ({len(stale)} stale), {len(failed)} mismatches; "
          f"normalizations {norm.counts}"
          + (f"; {len(report['db_diff'])} differing tables"
             f" ({sum(t in db_divergences for t in report['db_diff'])} declared, {len(stale_db)} stale declarations)"
             if args.db_diff else "")
          + (f"; skipped corpora: {', '.join(skipped)}" if skipped else ""))
    report["skipped_corpora"] = skipped
    report["stale_db_declarations"] = stale_db
    if args.report:
        args.report.write_text(json.dumps(report, indent=2))
    undeclared_tables = [t for t in report.get("db_diff", {}) if t not in db_divergences]
    return 1 if failed or undeclared_tables else 0


if __name__ == "__main__":
    sys.exit(main())
