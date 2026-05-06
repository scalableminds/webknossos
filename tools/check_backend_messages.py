#!/usr/bin/env python3
"""Check conf/messages for duplicates and unused keys in Scala code."""

import re
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
MESSAGES_FILE = REPO_ROOT / "conf" / "messages"
SCALA_DIRS = [
    REPO_ROOT / "app",
    REPO_ROOT / "util" / "src",
    REPO_ROOT / "webknossos-datastore" / "app",
    REPO_ROOT / "webknossos-tracingstore" / "app",
]


def main() -> None:
    print(f"Hello from check_backend_messages! Checking {MESSAGES_FILE} against Scala sources...")
    t0 = time.monotonic()

    keys, duplicates = parse_messages(MESSAGES_FILE)

    errors: list[str] = []

    if duplicates:
        errors.append(f"Duplicate keys in {MESSAGES_FILE.relative_to(REPO_ROOT)}:")
        errors.extend(duplicates)

    scala_text = collect_scala_text()
    scala_lines = scala_text.count("\n")
    unused = find_unused_keys(keys, scala_text)

    if unused:
        errors.append(f"\nKeys defined in {MESSAGES_FILE.relative_to(REPO_ROOT)} but not used in Scala code:")
        errors.extend(unused)

    undefined = find_undefined_references(keys, scala_text)

    if undefined:
        errors.append(f"\nKeys referenced in Scala code but not defined in {MESSAGES_FILE.relative_to(REPO_ROOT)}:")
        errors.extend(sorted(undefined))

    elapsed = time.monotonic() - t0

    if errors:
        print("\n".join(errors))
        print(f"\nAll done with {len(errors)} errors. Checking {len(keys)} message keys against {scala_lines} Scala lines took {elapsed:.2f}s.")
        sys.exit(1)

    print(f"\nAll done with no errors! Checking {len(keys)} message keys against {scala_lines} Scala lines took {elapsed:.2f}s.")


def parse_messages(path: Path) -> tuple[dict[str, int], list[str]]:
    """Return (key -> line_number, list_of_duplicate_keys)."""
    keys: dict[str, int] = {}
    duplicates: list[str] = []

    for line_number, raw in enumerate(path.read_text().splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z][A-Za-z0-9_.]*)\s*=", line)
        if match:
            key = match.group(1)
            if key in keys:
                duplicates.append(f"  {key!r} (lines {keys[key]} and {line_number})")
            else:
                keys[key] = line_number

    return keys, duplicates


def collect_scala_text() -> str:
    """Concatenate all Scala source files into one big string."""
    parts: list[str] = []
    for scala_dir in SCALA_DIRS:
        if not scala_dir.exists():
            continue
        for path in scala_dir.rglob("*.scala"):
            parts.append(path.read_text())
    return "\n".join(parts)


def find_unused_keys(keys: dict[str, int], scala_text: str) -> list[str]:
    unused: list[str] = []
    for key in keys:
        # The key must appear as a quoted string literal somewhere in Scala code
        if f'"{key}"' not in scala_text:
            unused.append(f"  ‘{key}’ (L{keys[key]})")
    return unused


# Matches strings used as message keys: first arg of Messages(...) or right-hand side of ?~> / ?~!
_SCALA_KEY_RE = re.compile(r'(?:Messages\(\s*|[?]\~[>!]\s*)"([a-z][a-zA-Z0-9_.]*)"')


def find_undefined_references(keys: dict[str, int], scala_text: str) -> list[str]:
    undefined: list[str] = []
    seen: set[str] = set()
    for match in _SCALA_KEY_RE.finditer(scala_text):
        key = match.group(1)
        if key not in keys and key not in seen:
            undefined.append(f"  ‘{key}’")
            seen.add(key)
    return undefined


if __name__ == "__main__":
    main()
