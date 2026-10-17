#!/usr/bin/env python3
"""Latency/throughput comparison of Play and Rust on identical databases (stack.py reset --volume).

Uses `oha` (cargo install oha --locked --root /tmp/wk-diff/tools). For every endpoint and side: a warmup
(JIT for the JVM, caches and pools for both), then measured runs per concurrency level. Sides alternate
per endpoint so neither systematically runs on a warmer database. Also records CPU seconds and peak RSS of
the main application processes (the Play JVM additionally hosts its idle embedded datastore/tracingstore).

  python3 tools/app_differential/bench.py --report /tmp/wk-diff/bench.json --markdown /tmp/wk-diff/bench.md
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

OHA = os.environ.get("WK_DIFF_OHA", "/tmp/wk-diff/tools/bin/oha")
TOKEN = "secretSampleUserToken"  # Play's public dev sample token
T = "6ad299887e8ea1667bf41107"
DS = "68b80290d4000090f8f4aa62"
U = "6ad299887e8ea1667bf41109"
TIME = "start=1600000000000&end=1900000000000&annotationTypes=Explorational,Task&annotationStates=Active,Finished"

ENDPOINTS = [
    ("health (no db)", "/api/health"),
    ("features (no db)", "/api/features"),
    ("current user", "/api/user"),
    ("dataset read", f"/api/datasets/{DS}"),
    ("datasets compact, 2006 rows", "/api/datasets?compact=true"),
    ("datasets search, limit 20", "/api/datasets?compact=true&searchQuery=volume_dataset_1&limit=20"),
    ("datasets full v12, limit 50", "/api/v12/datasets?limit=50"),
    ("readable annotations page", "/api/annotations/readable?limit=50&pageNumber=3&includeTotalCount=true"),
    ("users, 302 rows", "/api/users"),
    ("folder tree", "/api/folders/tree"),
    ("projects with status", "/api/projects/withStatus"),
    ("available tasks report", f"/api/teams/{T}/availableTasksReport"),
    ("time overview", f"/api/time/overview?{TIME}"),
]


def oha(url: str, concurrency: int, duration: str) -> dict:
    result = subprocess.run(
        [OHA, "--no-tui", "--output-format", "json", "-c", str(concurrency), "-z", duration,
         "-H", f"X-Auth-Token: {TOKEN}", url],
        capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def process_stats(pid: int) -> tuple[float, int]:
    """CPU seconds (user+sys) and RSS KiB of a process and its children."""
    out = subprocess.run(["ps", "-o", "time=,rss=", "-g", str(os.getpgid(pid))], capture_output=True, text=True).stdout
    cpu, rss = 0.0, 0
    for line in out.splitlines():
        cputime, kib = line.split()
        parts = [float(p) for p in cputime.replace("-", ":").split(":")]
        while len(parts) < 3:
            parts.insert(0, 0.0)
        cpu += parts[-3] * 3600 + parts[-2] * 60 + parts[-1]
        rss += int(kib)
    return cpu, rss


def summarize(raw: dict) -> dict:
    summary, latency = raw["summary"], raw.get("latencyPercentiles", {})
    status = raw.get("statusCodeDistribution", {})
    ok = sum(n for code, n in status.items() if code.startswith("2"))
    total = sum(status.values())
    return {
        "rps": round(summary["requestsPerSec"], 1),
        "p50_ms": round((latency.get("p50") or 0) * 1000, 2),
        "p95_ms": round((latency.get("p95") or 0) * 1000, 2),
        "p99_ms": round((latency.get("p99") or 0) * 1000, 2),
        "requests": total,
        "non_2xx": total - ok,
        "errors": sum(raw.get("errorDistribution", {}).values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--play", default="http://127.0.0.1:19590")
    parser.add_argument("--rust", default="http://127.0.0.1:19591")
    parser.add_argument("--levels", default="1,32")
    parser.add_argument("--duration", default="8s")
    parser.add_argument("--warmup", default="5s")
    parser.add_argument("--only", help="substring filter on endpoint labels")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--markdown", type=Path)
    args = parser.parse_args()
    state = json.loads(Path("/tmp/wk-diff/state.json").read_text())
    pids = {"play": state["play"], "rust": state["rust"]}
    levels = [int(level) for level in args.levels.split(",")]
    before = {side: process_stats(pid) for side, pid in pids.items()}
    peak_rss = {side: before[side][1] for side in pids}
    results = []
    for index, (label, path) in enumerate(ENDPOINTS):
        if args.only and args.only not in label:
            continue
        order = ("play", "rust") if index % 2 == 0 else ("rust", "play")
        for side in order:
            origin = getattr(args, side)
            oha(origin + path, 16, args.warmup)
            for level in levels:
                cpu_before = process_stats(pids[side])[0]
                measured = summarize(oha(origin + path, level, args.duration))
                cpu_after, rss = process_stats(pids[side])
                peak_rss[side] = max(peak_rss[side], rss)
                measured["cpu_ms_per_request"] = round(
                    (cpu_after - cpu_before) * 1000 / max(measured["requests"], 1), 3)
                results.append({"endpoint": label, "path": path, "side": side, "concurrency": level, **measured})
                print(f"{label:32} {side:4} c={level:<3} {measured['rps']:>9} rps  p50 {measured['p50_ms']:>8} ms"
                      f"  p99 {measured['p99_ms']:>8} ms  cpu/req {measured['cpu_ms_per_request']:>7} ms"
                      f"  non2xx {measured['non_2xx']}", flush=True)
    after = {side: process_stats(pid) for side, pid in pids.items()}
    totals = {side: {"cpu_seconds": round(after[side][0] - before[side][0], 1),
                     "rss_mib_start": before[side][1] // 1024, "rss_mib_peak": peak_rss[side] // 1024}
              for side in pids}
    report = {"results": results, "process": totals, "levels": levels, "duration": args.duration}
    if args.report:
        args.report.write_text(json.dumps(report, indent=2))
    if args.markdown:
        lines = ["| Endpoint | c | Play rps | Rust rps | Play p50/p99 ms | Rust p50/p99 ms | CPU ms/req Play / Rust |",
                 "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for label, _ in ENDPOINTS:
            for level in levels:
                row = {r["side"]: r for r in results if r["endpoint"] == label and r["concurrency"] == level}
                if len(row) != 2:
                    continue
                p, r = row["play"], row["rust"]
                lines.append(f"| {label} | {level} | {p['rps']} | {r['rps']} | {p['p50_ms']} / {p['p99_ms']} | "
                             f"{r['p50_ms']} / {r['p99_ms']} | {p['cpu_ms_per_request']} / {r['cpu_ms_per_request']} |")
        lines.append("")
        lines.append(f"Process totals: {json.dumps(totals)}")
        args.markdown.write_text("\n".join(lines) + "\n")
    print(json.dumps(totals))
    return 0


if __name__ == "__main__":
    sys.exit(main())
