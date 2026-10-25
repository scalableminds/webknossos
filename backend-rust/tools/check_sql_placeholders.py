#!/usr/bin/env python3
"""Reject hand-numbered SQL placeholders in composed statements.

A `$n` placeholder is only safe in a fixed SQL literal, where it sits next to the binds that
fill it. Splicing a fragment with its own `$n` into a `format!` string makes the caller bind
values in an order defined somewhere else, and a mismatch silently checks the wrong value.
Compose such statements with `crate::sql::Sql` (sqlx's `QueryBuilder`) instead: `push` the
text and `push_bind` the values, so the builder numbers the parameters.

Flags `format!` strings containing `$n` or interpolating a `const` that does, and `$n` in text
pushed onto a builder (`Sql::new`, `QueryBuilder::new`, `.push`).

Usage: python3 tools/check_sql_placeholders.py [paths...]   (default: src/)
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLACEHOLDER = re.compile(r"\$\d")
CONST = re.compile(r"\bconst ([A-Z][A-Z0-9_]*): &(?:'static )?str\s*=", re.MULTILINE)
CALL = re.compile(r"\bformat!\(|\b(?:Sql|QueryBuilder)(?:::<[^>]*>)?::new\(|\.push\(")


TOKEN = re.compile(
    r'b?r(#*)".*?"\1|b?"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])\'|//[^\n]*|[()]',
    re.DOTALL,
)


def call_body(source: str, start: int) -> str:
    """The text of a call from its opening parenthesis to the matching close."""
    depth = 1
    for token in TOKEN.finditer(source, start):
        depth += {"(": 1, ")": -1}.get(token.group(), 0)
        if not depth:
            return source[start : token.end()]
    return source[start:]


def const_value(source: str, start: int) -> str:
    end = source.find(";\n", start)
    return source[start : end if end >= 0 else len(source)]


def main(paths: list[str]) -> int:
    files = [
        p.resolve()
        for arg in paths
        for p in (Path(arg).rglob("*.rs") if Path(arg).is_dir() else [Path(arg)])
    ]
    sources = {path: path.read_text() for path in files}
    # Fragments are spliced across modules, so collect them from the whole crate.
    numbered = {
        m.group(1)
        for path in (ROOT / "src").rglob("*.rs")
        for source in [sources.get(path) or path.read_text()]
        for m in CONST.finditer(source)
        if PLACEHOLDER.search(const_value(source, m.end()))
    }
    findings = []
    for path, source in sources.items():
        for m in CALL.finditer(source):
            body = call_body(source, m.end())
            spliced = [name for name in numbered if re.search(rf"\b{name}\b", body)]
            is_format = m.group().startswith("format!")
            if PLACEHOLDER.search(body) or (is_format and spliced):
                line = source.count("\n", 0, m.start()) + 1
                what = f"splices {', '.join(sorted(spliced))}" if spliced and not PLACEHOLDER.search(body) else "contains `$n`"
                findings.append(f"{path.relative_to(ROOT)}:{line}: {m.group().rstrip('(')} {what}")
    for finding in sorted(findings):
        print(finding)
    if findings:
        print(f"\n{len(findings)} composed SQL statement(s) with hand-numbered placeholders; use crate::sql::Sql.")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or [str(ROOT / "src")]))
