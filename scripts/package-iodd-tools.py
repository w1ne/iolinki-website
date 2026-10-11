#!/usr/bin/env python3
"""Publish a reproducible, allowlisted IODD CLI/MCP source bundle."""
import argparse
import hashlib
import io
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'downloads/iodd-tools.zip'


def bundle():
    files = [ROOT / 'package.json', ROOT / 'package-lock.json', ROOT / 'docs/iodd-mcp.md', ROOT / 'docs/iodd-examples.md', ROOT / 'scripts/package-iodd-examples.mjs', ROOT / 'scripts/package-iodd-npm.mjs', ROOT / 'scripts/check-iodd-mcp-recovery.mjs', ROOT / 'downloads/iodd-counter.zip', ROOT / 'downloads/iodd-switching-sensor.zip', ROOT / 'downloads/iodd-mcp-1.1.2.tgz']
    for folder in ['tools/iodd', 'assets/js/iodd', 'assets/iodd', 'tests/iodd', 'catalog-worker', 'agent-worker']:
        files.extend(p for p in (ROOT / folder).rglob('*') if p.is_file() and not any(part.startswith('.') or part in {'node_modules', '__pycache__'} for part in p.relative_to(ROOT / folder).parts))
    files = sorted(set(files))
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        checksums = []
        for file in files:
            name = file.relative_to(ROOT).as_posix()
            data = file.read_bytes()
            item = zipfile.ZipInfo('iodd-tools/' + name, (1980, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            archive.writestr(item, data)
            checksums.append(hashlib.sha256(data).hexdigest() + '  ' + name)
        archive.writestr(zipfile.ZipInfo('iodd-tools/SHA256SUMS', (1980, 1, 1, 0, 0, 0)),
                         '\n'.join(checksums) + '\n')
    return stream.getvalue()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = bundle()
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_bytes() != data:
            raise SystemExit('IODD tool download differs from the current allowlisted sources')
        print('IODD source bundle is current and reproducible')
    else:
        OUTPUT.parent.mkdir(exist_ok=True)
        OUTPUT.write_bytes(data)
        print(f'Wrote {OUTPUT.relative_to(ROOT)} ({len(data)} bytes)')
