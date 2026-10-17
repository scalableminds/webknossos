#!/usr/bin/env python3
"""Guard for state the Scala and Rust datastores share during coexistence and rollback.

Both services read and write the same Redis upload metadata. A key the other side does not know
silently breaks resumable uploads after a switch or a rollback. This compares the key layout
(prefix, per-upload and per-file suffixes, reverse lookup) and idle expiry, and the special
directory names under the base directories (upload staging, unpack, conversion, trash, mirror).
Exit 0: identical; 1: drift (printed); 2: a source file or pattern is missing.

  python3 tools/datastore_replay/check_shared_formats.py
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
SCALA = ROOT / 'webknossos-datastore/app/com/scalableminds/webknossos/datastore/services/uploading/UploadMetadataStore.scala'
RUST = ROOT / 'backend-rust/datastore/src/services/upload/mod.rs'
SCALA_APP = ROOT / 'webknossos-datastore/app'
RUST_SRC = ROOT / 'backend-rust/datastore/src'
SPECIAL_DIR = re.compile(r'"(\.(?:uploading|unpacked|forConversion|converting|trash|mirror))"')


def special_dirs(root, suffix):
    return {m for f in root.rglob('*' + suffix) for m in SPECIAL_DIR.findall(f.read_text())}


def expiry_days(text, pattern):
    match = re.search(pattern, text)
    return match and match.group(1)


def scala_layout(text):
    prefix = re.search(r'keyPrefix: String = s"([^"]+)"', text)
    upload = set(re.findall(r'\$\{?keyPrefix\}?\$\{uploadId\}___([A-Za-z]+)"', text))
    file = set(re.findall(r'\$\{uploadId\}___file___\$\{fileName\}___([A-Za-z]+)"', text))
    upload -= {'file'}
    reverse = set(re.findall(r'\$\{keyPrefix\}___\$\{Json\.stringify\(Json\.toJson\(\w+\)\)\}___([A-Za-z]+)"', text))
    return prefix and prefix.group(1).replace('${domain}', '{domain}'), upload, file, reverse


def rust_layout(text):
    prefix = re.search(r'format!\("(upload___\{\}___)", self\.domain\)', text)
    upload = set(re.findall(r'self\.key\(\s*upload_id,\s*"([A-Za-z]+)"', text))
    # Domain-specific keys (Scala's Dataset/Mag/AttachmentUploadMetadataStore) come from one table:
    # `UploadDomain::Mag => &["mag", "layerName"],`.
    for keys in re.findall(r'UploadDomain::\w+ => &\[([^\]]*)\]', text):
        upload |= set(re.findall(r'"([A-Za-z]+)"', keys))
    file = set(re.findall(r'self\.file_key\(\s*upload_id,\s*file,\s*"([A-Za-z]+)"', text))
    reverse = set(re.findall(r'"\{\}___\{\}___([A-Za-z]+)"', text))
    return prefix and prefix.group(1).replace('{}', '{domain}'), upload, file, reverse


def main():
    if not SCALA.is_file() or not RUST.is_file():
        print('source file missing')
        return 2
    scala, rust = scala_layout(SCALA.read_text()), rust_layout(RUST.read_text())
    if not scala[0] or not rust[0] or not scala[1] or not rust[1]:
        print('key prefix or suffix pattern not found; update the extraction')
        return 2
    scala += (special_dirs(SCALA_APP, '.scala'),
              expiry_days(SCALA.read_text(), r'uploadIdleExpiry: FiniteDuration = (\d+) days'))
    rust_expiry = re.search(r'UPLOAD_IDLE_EXPIRY: Duration = Duration::from_secs\((\d+) \* 24 \* 60 \* 60\)',
                            RUST.read_text())
    rust += (special_dirs(RUST_SRC, '.rs'), rust_expiry and rust_expiry.group(1))
    drift = []
    for name, left, right in zip(('prefix', 'upload keys', 'file keys', 'reverse lookup', 'special directories',
                                  'upload idle expiry (days)'), scala, rust):
        if left != right:
            if isinstance(left, set):
                drift.append(f'{name}: only Scala {sorted(left - right)}, only Rust {sorted(right - left)}')
            else:
                drift.append(f'{name}: Scala {left!r}, Rust {right!r}')
    for line in drift:
        print(line)
    if not drift:
        print(f'shared state identical: prefix {scala[0]!r}, {len(scala[1])} upload keys, {len(scala[2])} file keys, '
              f'{len(scala[3])} reverse lookup, idle expiry {scala[5]} days, directories {sorted(scala[4])}')
    return 1 if drift else 0


if __name__ == '__main__':
    sys.exit(main())
