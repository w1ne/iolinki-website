#!/usr/bin/env python3
"""Build deterministic MkDocs output while preserving repository planning docs."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / 'docsite/generated-files.json'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Compare without changing committed output')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='iolinki-docs-') as temporary:
        staging = Path(temporary)
        subprocess.run([sys.executable, '-m', 'mkdocs', 'build', '--strict',
                        '--config-file', str(ROOT / 'docsite/mkdocs.yml'),
                        '--site-dir', str(staging)], check=True)
        # MkDocs emits a gzip sitemap containing wall-clock metadata. The plain
        # sitemap is deterministic and sufficient for crawlers.
        gzip = staging / 'sitemap.xml.gz'
        if gzip.exists():
            gzip.unlink()
        # MkDocs defaults lastmod to the build date, which is not source
        # provenance. Omit it so a next-day CI rebuild produces the same bytes.
        sitemap = staging / 'sitemap.xml'
        tree = ET.parse(sitemap)
        namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9'
        ET.register_namespace('', namespace)
        for url in tree.getroot():
            for lastmod in list(url.findall('{' + namespace + '}lastmod')):
                url.remove(lastmod)
        tree.write(sitemap, encoding='utf-8', xml_declaration=True)
        files = {path.relative_to(staging).as_posix(): digest(path)
                 for path in sorted(staging.rglob('*')) if path.is_file()}
        previous = json.loads(GENERATED.read_text()) if GENERATED.exists() else {}
        if args.check:
            errors = []
            if files != previous:
                errors.append('generated-files.json differs from the current build')
            for name, expected in files.items():
                path = ROOT / 'docs' / name
                if not path.is_file() or digest(path) != expected:
                    errors.append('stale or absent docs/' + name)
            if errors:
                print('\n'.join(errors), file=sys.stderr)
                return 1
            print(f'Checked {len(files)} generated files: committed docs match the build')
            return 0
        for name in previous.keys() - files.keys():
            (ROOT / 'docs' / name).unlink(missing_ok=True)
        for name in files:
            destination = ROOT / 'docs' / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(staging / name, destination)
        GENERATED.write_text(json.dumps(files, indent=2, sort_keys=True) + '\n')
        print(f'Published {len(files)} generated files under docs/; planning files preserved')
    return 0


if __name__ == '__main__':
    sys.exit(main())
