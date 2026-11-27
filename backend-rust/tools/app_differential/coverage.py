#!/usr/bin/env python3
"""Route coverage of the differential corpora against Play's main application routes.

Every corpus step that targets the main application (no `"service"`) is mapped to a route template of
`conf/webknossos.latest.routes`: `/api` and `/api/vN` are stripped, `{variables}` stand for one
segment, `:param` matches one segment and `*param` any number of them, and the method must match.
Like Play, the first matching route in file order wins. A versioned step that hits a dedicated
route in `conf/webknossos.versioned.routes` (LegacyApiController) is reported as legacy, not as
coverage of the latest route it shadows. Store steps (`"service": "datastore"/"tracingstore"`) are
not main application routes and are skipped.

  python3 tools/app_differential/coverage.py              # summary, per controller, uncovered routes
  python3 tools/app_differential/coverage.py --min 250    # exit 1 when fewer routes are covered
  python3 tools/app_differential/coverage.py --json       # machine-readable
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[2]
ROUTE_LINE = re.compile(r"^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+([\w.]+)")
VARIABLE = re.compile(r"\{\{?[A-Za-z][A-Za-z0-9_]*\}?\}")
VERSION_PREFIX = re.compile(r"^/v(\d+)(?=/)")


@dataclass
class Route:
    method: str
    template: str
    action: str
    pattern: re.Pattern
    steps: list[str] = field(default_factory=list)

    @property
    def controller(self) -> str:
        return self.action.rsplit(".", 1)[0].removeprefix("controllers.")


def template_regex(template: str) -> re.Pattern:
    parts = []
    for match in re.finditer(r"\$[A-Za-z_]\w*<([^>]+)>|:[A-Za-z_]\w*|\*[A-Za-z_]\w*|[^$:*]+|.", template):
        token = match.group(0)
        if token.startswith("$"):
            parts.append(f"(?:{match.group(1)})")
        elif token.startswith(":"):
            parts.append(r"[^/]+")
        elif token.startswith("*"):
            parts.append(r".+")
        else:
            parts.append(re.escape(token))
    return re.compile("^" + "".join(parts) + "$")


def parse_routes(path: Path, prefix_filter: str | None = None) -> list[Route]:
    routes = []
    for line in path.read_text().splitlines():
        match = ROUTE_LINE.match(line)
        if match:
            method, template, action = match.groups()
            if prefix_filter is None or template.startswith(prefix_filter):
                routes.append(Route(method, template, action, template_regex(template)))
    return routes


def step_path(step: dict) -> str:
    # Captured values are always single, non-empty path segments in the corpora.
    return VARIABLE.sub("X", step.get("path", "")).split("?", 1)[0]


def analyse(corpus_files: list[Path], routes_file: Path, versioned_file: Path) -> dict:
    routes = parse_routes(routes_file)
    legacy = parse_routes(versioned_file, prefix_filter="/v")
    unmatched: list[str] = []
    legacy_hits: dict[str, list[str]] = {}
    store_steps = app_steps = 0
    for corpus_file in corpus_files:
        corpus = json.loads(corpus_file.read_text())
        for step in corpus.get("steps", []):
            if step.get("service"):
                store_steps += 1
                continue
            app_steps += 1
            method = step.get("method", "GET").upper()
            label = f"{corpus_file.name}:{step['name']}"
            path = step_path(step)
            if not path.startswith("/api"):
                unmatched.append(f"{label} {method} {path}")
                continue
            path = path[len("/api"):] or "/"
            legacy_route = next((r for r in legacy if r.method == method and r.pattern.match(path)), None)
            if legacy_route:
                legacy_hits.setdefault(f"{method} {legacy_route.template}", []).append(label)
                continue
            path = VERSION_PREFIX.sub("", path)
            route = next((r for r in routes if r.method == method and r.pattern.match(path)), None)
            if route:
                route.steps.append(label)
            else:
                unmatched.append(f"{label} {method} {path}")
    controllers: dict[str, list[int]] = {}
    for route in routes:
        entry = controllers.setdefault(route.controller, [0, 0])
        entry[0] += bool(route.steps)
        entry[1] += 1
    covered = sum(bool(r.steps) for r in routes)
    return {
        "covered": covered,
        "total": len(routes),
        "app_steps": app_steps,
        "store_steps": store_steps,
        "controllers": {name: {"covered": c, "total": t} for name, (c, t) in sorted(controllers.items())},
        "uncovered": [f"{r.method} {r.template} ({r.controller})" for r in routes if not r.steps],
        "legacy": legacy_hits,
        "unmatched_steps": unmatched,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("corpus", nargs="*", type=Path, help="corpus files (default: corpus/*.json)")
    parser.add_argument("--routes", type=Path, default=REPOSITORY / "conf" / "webknossos.latest.routes")
    parser.add_argument("--versioned-routes", type=Path, default=REPOSITORY / "conf" / "webknossos.versioned.routes")
    parser.add_argument("--min", type=int, help="exit 1 when fewer routes are covered")
    parser.add_argument("--json", action="store_true", help="print the analysis as JSON")
    parser.add_argument("--quiet", action="store_true", help="only the summary line")
    args = parser.parse_args()
    corpus_files = args.corpus or sorted((HERE / "corpus").glob("*.json"))
    result = analyse(corpus_files, args.routes, args.versioned_routes)
    covered, total = result["covered"], result["total"]
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"routes covered: {covered}/{total} ({100 * covered / total:.0f}%) by {result['app_steps']} app steps"
              f" ({result['store_steps']} store steps not counted)")
        if not args.quiet:
            print("\nper controller:")
            for name, entry in sorted(result["controllers"].items(),
                                      key=lambda item: (item[1]["covered"] / item[1]["total"], item[0])):
                print(f"  {entry['covered']:3}/{entry['total']:<3} {name}")
            if result["legacy"]:
                print("\nlegacy (versioned) routes:")
                for route, steps in sorted(result["legacy"].items()):
                    print(f"  {route} ({len(steps)} steps)")
            print(f"\nuncovered ({total - covered}):")
            for route in result["uncovered"]:
                print(f"  {route}")
        if result["unmatched_steps"]:
            print(f"\nsteps matching no route ({len(result['unmatched_steps'])}):")
            for step in result["unmatched_steps"]:
                print(f"  {step}")
    if args.min is not None and covered < args.min:
        print(f"coverage {covered} is below the minimum {args.min}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
