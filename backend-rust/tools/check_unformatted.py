#!/usr/bin/env python3
"""Find Rust statements that rustfmt left unformatted.

When rustfmt cannot fit a statement into the line width (typically because of a long SQL or
message literal), it keeps the statement exactly as written and `cargo fmt --check` still
passes. This check strips string literals and comments and flags code that rustfmt never
emits: a comma without a following space, `let x:T=` without spaces, and code lines over the
line width. Fix a finding by breaking the literal over several lines (SQL ignores the extra
whitespace) or moving it into a `const`, then run `cargo fmt`.

Usage: python3 tools/check_unformatted.py [paths...]   (default: every crate's .rs files)
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CRATE_DIRS = ["src", "tests", "common", "datastore"]
MAX_WIDTH = 100
# Macro bodies that are not comma-separated Rust expressions (`json!({"a":1})`, tracing's
# `field = %value`, macro definitions) are never formatted by rustfmt.
SKIPPED_MACRO = re.compile(
    r"\b(json|matches|trace|debug|info|warn|error|event|\w+_span|macro_rules!\s*\w+)!?\s*$"
)
CHECKS = [
    (re.compile(r",[^\s)\]}>]"), "comma without a following space"),
    (re.compile(r"\blet (mut )?\w+:[^\s:]"), "`let` binding without a space after the colon"),
    (re.compile(r"\blet (mut )?[^=;]*[^\s=!<>+\-*/%&|^]=[^\s=>]"), "`let` without spaces around `=`"),
]


def mask(source: str) -> str:
    """Blank out string/char literal contents and comments, keeping line structure."""
    out = []
    i, n = 0, len(source)
    while i < n:
        c = source[i]
        if source.startswith("//", i):
            j = source.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
        elif source.startswith("/*", i):
            depth, j = 1, i + 2
            while j < n and depth:
                if source.startswith("/*", j):
                    depth, j = depth + 1, j + 2
                elif source.startswith("*/", j):
                    depth, j = depth - 1, j + 2
                else:
                    j += 1
            out.append(re.sub(r"[^\n]", " ", source[i:j]))
            i = j
        elif m := re.compile(r"b?r(#*)\"").match(source, i):
            if i and (source[i - 1].isalnum() or source[i - 1] == "_"):
                out.append(c)
                i += 1
                continue
            end = source.find('"' + m.group(1), m.end())
            end = n if end < 0 else end + 1 + len(m.group(1))
            out.append(literal(source, i, m.end(), end - 1 - len(m.group(1)), end))
            i = end
        elif c == '"' or (c == "b" and source.startswith('b"', i)):
            start = i + (2 if c == "b" else 1)
            j = start
            while j < n and source[j] != '"':
                j += 2 if source[j] == "\\" else 1
            out.append(literal(source, i, start, j, j + 1))
            i = j + 1
        elif c == "'" and (m := re.compile(r"'(\\.[^']*|[^\\'])'").match(source, i)):
            out.append("'" + "x" * (m.end() - i - 2) + "'")
            i = m.end()
        else:
            out.append(c)
            i += 1
    return "".join(out)


def literal(source: str, open_start: int, body_start: int, body_end: int, close_end: int) -> str:
    """Keep the delimiters, blank the body; `\x00` marks literal characters for width checks."""
    body = re.sub(r"[^\n]", "\x00", source[body_start:body_end])
    return source[open_start:body_start] + body + source[body_end:close_end]


def blank_unformatted_macros(masked: str) -> str:
    """Blank the bodies of macros that rustfmt does not format, keeping line structure."""
    chars = list(masked)
    pairs = {"(": ")", "[": "]", "{": "}"}
    for m in re.finditer(r"[(\[{]", masked):
        if not SKIPPED_MACRO.search(masked, max(0, m.start() - 40), m.start()):
            continue
        depth, j = 0, m.start()
        while j < len(masked):
            ch = masked[j]
            if ch in pairs:
                depth += 1
            elif ch in pairs.values():
                depth -= 1
                if depth == 0:
                    break
            j += 1
        for k in range(m.start() + 1, j):
            if chars[k] != "\n":
                chars[k] = " "
    return "".join(chars)


def check_file(path: Path) -> list[str]:
    source = path.read_text()
    masked = blank_unformatted_macros(mask(source))
    findings = []
    for number, (line, code) in enumerate(zip(source.split("\n"), masked.split("\n")), 1):
        stripped = code.strip()
        if stripped.startswith(("#[", "#![")):
            continue
        logic = code.replace("\x00", "")
        for pattern, message in CHECKS:
            if pattern.search(logic):
                findings.append(f"{path.relative_to(ROOT)}:{number}: {message}")
                break
        else:
            # Over-wide lines are fine when the literal alone cannot fit (rustfmt cannot break it);
            # flag them only when enough code shares the line that rustfmt would have wrapped it.
            # Constants holding one long literal and long `fn` names cannot be wrapped either.
            unbreakable = re.match(r"\s*(pub(\(\w+\))? )?(const|static) ", code) or re.match(
                r"\s*(pub(\(\w+\))? )?(async )?fn \w+\(\)?[^,]*$", code
            )
            if len(line) > MAX_WIDTH and not unbreakable:
                around_literals = len(re.sub(r"[\s\"#]", "", logic))
                if around_literals > 40:
                    findings.append(f"{path.relative_to(ROOT)}:{number}: code line over {MAX_WIDTH} columns")
    return findings


def main() -> int:
    paths = [Path(p).resolve() for p in sys.argv[1:]] or [ROOT / d for d in CRATE_DIRS]
    files = sorted(
        f
        for p in paths
        for f in ([p] if p.is_file() else p.rglob("*.rs"))
        if "target" not in f.relative_to(ROOT).parts
    )
    findings = [finding for f in files for finding in check_file(f)]
    for finding in findings:
        print(finding)
    if findings:
        print(f"\n{len(findings)} line(s) look unformatted; see the docstring of {Path(__file__).name}.")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
