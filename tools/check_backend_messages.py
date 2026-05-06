#!/usr/bin/env python3
"""Check conf/messages for duplicates and unused keys in Scala code."""

import os
import re
import sys
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

    keys, duplicates = parse_messages(MESSAGES_FILE)

    errors: list[str] = []

    if duplicates:
        errors.append(f"Duplicate keys in {MESSAGES_FILE.relative_to(REPO_ROOT)}:")
        errors.extend(duplicates)

    scala_text = collect_scala_text()
    unused = find_unused_keys(keys, scala_text)

    if unused:
        errors.append(f"\nKeys defined in {MESSAGES_FILE.relative_to(REPO_ROOT)} but not used in Scala code:")
        errors.extend(unused)

    if errors:
        print("\n".join(errors))
        sys.exit(1)

    print(f"All done! Checked {len(keys)} message keys.")


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
            unused.append(f"L{keys[key]}: ‘{key}’ unused in Scala code.")
    return unused


if __name__ == "__main__":
    main()
