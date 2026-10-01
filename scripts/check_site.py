#!/usr/bin/env python3
"""Check static-site local links, fragments, assets and sitemap destinations."""
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.path = path
        self.ids = set()
        self.links = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            if attrs['id'] in self.ids:
                self.errors.append(f'{self.path}: duplicate id {attrs["id"]}')
            self.ids.add(attrs['id'])
        for attr in ('href', 'src'):
            if attrs.get(attr):
                self.links.append(attrs[attr])


def check():
    pages = {}
    references = []
    errors = []
    for path in sorted(ROOT.glob('*.html')):
        page = Page(path.relative_to(ROOT))
        page.feed(path.read_text())
        pages[path.resolve()] = page
        errors.extend(page.errors)
        references.extend((path, link) for link in page.links)
    for path in ROOT.rglob('*.css'):
        references.extend((path, link.strip(' \t\"\'')) for link in re.findall(r'url\(([^)]+)\)', path.read_text()))
    for source, link in references:
        parsed = urlsplit(link)
        if parsed.scheme or parsed.netloc:
            continue
        target = (ROOT / unquote(parsed.path).lstrip('/') if parsed.path.startswith('/')
                  else source.parent / unquote(parsed.path)) if parsed.path else source
        if target.is_dir():
            target /= 'index.html'
        target = target.resolve()
        if not target.is_relative_to(ROOT):
            errors.append(f'{source.relative_to(ROOT)}: link escapes site: {link}')
        elif not target.is_file():
            errors.append(f'{source.relative_to(ROOT)}: missing local target: {link}')
        elif parsed.fragment and target in pages and unquote(parsed.fragment) not in pages[target].ids:
            errors.append(f'{source.relative_to(ROOT)}: missing fragment: {link}')
    sitemap = ROOT / 'sitemap.xml'
    for loc in ET.parse(sitemap).iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc'):
        path = ROOT / urlsplit(loc.text).path.lstrip('/')
        if path.is_dir():
            path /= 'index.html'
        if not path.is_file():
            errors.append(f'sitemap.xml: missing page: {loc.text}')
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print(f'Checked {len(pages)} HTML pages, {len(references)} local/external references and sitemap: no broken local targets or fragments.')
    return 0


if __name__ == '__main__':
    sys.exit(check())
