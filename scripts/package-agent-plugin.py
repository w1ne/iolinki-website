#!/usr/bin/env python3
"""Build the portable iolinki skill/MCP package without environment files."""
import argparse
import io
from pathlib import Path
import zipfile
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'downloads/iolinki-agent-plugin.zip'
FULL = ROOT / 'llms-full.txt'

def full_text():
    paths = ['llms.txt', 'plugins/iolinki/skills/iolinki/SKILL.md', 'docsite/content/tools/agents.md', 'docs/iodd-examples.md']
    return '\n\n'.join((ROOT / path).read_text().strip() for path in paths) + '\n'

def bundle():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        files = sorted((ROOT / 'plugins/iolinki').rglob('*'))
        files += [ROOT / '.agents/plugins/marketplace.json', ROOT / 'llms.txt']
        for path in files:
            if not path.is_file():
                continue
            name = path.relative_to(ROOT).as_posix()
            item = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            archive.writestr(item, path.read_bytes())
    return stream.getvalue()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = bundle()
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_bytes() != data:
            raise SystemExit('Agent plugin archive differs from its sources')
        if not FULL.is_file() or FULL.read_text() != full_text():
            raise SystemExit('Full agent instructions differ from sources')
        print('Agent plugin package and full instructions are reproducible')
    else:
        OUTPUT.write_bytes(data)
        FULL.write_text(full_text())
        print(f'Wrote {OUTPUT.relative_to(ROOT)} ({len(data)} bytes)')
