#!/usr/bin/env python3
"""Import only selected public docs from immutable stack commits."""
import argparse
import hashlib
import json
import posixpath
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / 'docsite/content'
PRODUCTS = {
    'device': ('w1ne/iolinki', 'ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca', {
        'docs/ARCHITECTURE.md': 'architecture.md',
        'docs/TESTING.md': 'testing.md',
        'docs/CONFORMANCE.md': 'conformance.md',
        'docs/hardware/TIOL112.md': 'tiol112.md',
        'examples/reference_device/README.md': 'examples/counter.md',
        'examples/switching_sensor/README.md': 'examples/switching-sensor.md',
        'examples/stm32g0_tiol112/README.md': 'examples/stm32g0.md',
        'examples/esp32_l6362a/README.md': 'examples/esp32-c3.md',
        'samples/stm32u5_tiol112/README.md': 'examples/stm32u5.md',
        'tools/IODD_GEN.md': 'iodd.md',
        'validation/labwired/README.md': 'simulation.md',
        'docs/PHYSICAL_TESTING.md': 'physical-validation.md',
    }),
    'master': ('w1ne/iolinki-master', 'd23fd3034c0203ef829bd9734806389f8708fa94', {
        'docs/API.md': 'api.md',
        'docs/ARCHITECTURE.md': 'architecture.md',
        'docs/PORTING.md': 'porting.md',
        'docs/PHY_BOUNDARY.md': 'phy-contract.md',
        'docs/TESTING.md': 'testing.md',
        'docs/HARDWARE_VALIDATION.md': 'hardware-validation.md',
        'docs/IMPLEMENTATION_STATUS.md': 'implementation-status.md',
    }),
}
VERSIONS = {'device': 'v2.1.0', 'master': 'v1.0.0'}


def git_read(checkout, revision, path):
    return subprocess.check_output(['git', '-C', str(checkout), 'show', revision + ':' + path])


def rewrite_links(text, source, output, repo, revision, mapping, prefix):
    def rewrite(match):
        label, target = match.groups()
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc or target.startswith('#'):
            return match.group(0)
        path = posixpath.normpath(posixpath.join(posixpath.dirname(source), unquote(parsed.path)))
        if path in mapping:
            target = posixpath.relpath(prefix + '/' + mapping[path], posixpath.dirname(output))
        else:
            target = f'https://github.com/{repo}/blob/{revision}/{path}'
        if parsed.fragment:
            target += '#' + parsed.fragment
        return f'[{label}]({target})'
    # Markdown link destinations; preserve fenced source examples verbatim.
    parts = re.split(r'(^```.*?^```[^\n]*$)', text, flags=re.M | re.S)
    for i in range(0, len(parts), 2):
        parts[i] = re.sub(r'\[([^\]]*)\]\(([^\s)]+)\)', rewrite, parts[i])
    return ''.join(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', type=Path, required=True)
    parser.add_argument('--master', type=Path, required=True)
    args = parser.parse_args()
    manifest = {'documents': []}
    for product, (repo, revision, mapping) in PRODUCTS.items():
        prefix = product + '/' + VERSIONS[product]
        checkout = getattr(args, product)
        for source, destination in mapping.items():
            original = git_read(checkout, revision, source)
            output = prefix + '/' + destination
            source_url = f'https://github.com/{repo}/blob/{revision}/{source}'
            text = original.decode()
            # Older architecture pages use Mermaid fences. Display source
            # honestly without pulling a third-party graph runtime into docs.
            text = text.replace('```mermaid', '```text')
            text = rewrite_links(text, source, output, repo, revision, mapping, prefix)
            note = (f'\n\n> Source snapshot: [{source}]({source_url}), '
                    f'`{revision[:12]}`.\n')
            heading_end = text.find('\n')
            text = text[:heading_end] + note + text[heading_end:]
            path = CONTENT / output
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
            manifest['documents'].append({
                'product': product, 'revision': revision, 'source': source,
                'source_url': source_url, 'source_sha256': hashlib.sha256(original).hexdigest(),
                'output': output, 'published_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            })
    (ROOT / 'docsite/sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Imported {len(manifest["documents"])} public documents at immutable commits')


if __name__ == '__main__':
    main()
