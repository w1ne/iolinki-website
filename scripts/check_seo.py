#!/usr/bin/env python3
"""Check the crawler contract on primary landing pages and published docs."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import json
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://iolinki.com'
CALLBACKS = ['purchase-success.html', 'purchase-cancelled.html', 'elements.html', 'generic.html']
PUBLIC = ['index.html','getting-started.html','hardware.html','validation.html','faq.html','purchase.html','legal.html','iodd-editor.html','iodd-mcp.html','blog/index.html','blog/stainless-part-at-conveyor-stop.html','blog/pump-discharge-pressure-switch.html','blog/tank-level-guided-wave-radar.html','blog/machine-tool-coolant-flow.html','blog/box-detection-on-conveyor.html']

class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(); self.meta={}; self.canonical=[]; self.title=''; self.in_title=False; self.in_head=False; self.ld=[]; self.in_ld=False
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='meta': self.meta[a.get('name') or a.get('property')]=a.get('content','')
        if tag=='link' and a.get('rel')=='canonical': self.canonical.append(a.get('href'))
        if tag=='head':self.in_head=True
        if tag=='title' and self.in_head:self.in_title=True
        if tag=='script' and a.get('type')=='application/ld+json': self.in_ld=True;self.ld.append('')
    def handle_endtag(self, tag):
        if tag=='head':self.in_head=False
        if tag=='title':self.in_title=False
        if tag=='script':self.in_ld=False
    def handle_data(self,data):
        if self.in_title:self.title+=data
        if self.in_ld:self.ld[-1]+=data

pages={p:Page((ROOT/p).read_text()) for p in PUBLIC+CALLBACKS}
urls=[e.text for e in ET.parse(ROOT/'sitemap.xml').iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
assert len(urls)==len(set(urls)), 'Duplicate sitemap URLs'
for name in CALLBACKS:
    assert 'noindex' in pages[name].meta.get('robots',''), 'Checkout callbacks/templates must be noindex: '+name
    assert ORIGIN+'/'+name not in urls, 'Nonindexable URL in sitemap: '+name
for name in PUBLIC:
    p=pages[name]; canonical=ORIGIN+('/' if name=='index.html' else '/'+name[:-len('index.html')] if name.endswith('/index.html') else '/'+name)
    assert p.canonical==[canonical], 'One exact canonical per landing page: '+name
    assert canonical in urls, 'Landing page omitted from sitemap: '+name
    assert 20<=len(p.title)<=80, 'Useful search title: '+name
    assert 50<=len(p.meta.get('description',''))<=200, 'Useful description: '+name
    assert p.meta.get('og:url')==canonical, 'Share URL must be canonical: '+name
    assert p.meta.get('og:title')==p.title, 'Search/share title mismatch: '+name
    assert p.meta.get('og:description')==p.meta['description'], 'Search/share description mismatch: '+name
    assert p.meta.get('twitter:card')=='summary_large_image', 'Share preview missing: '+name
    image=p.meta.get('og:image',''); assert image.startswith(ORIGIN+'/'), 'Same-site social image: '+name
    assert (ROOT/urlsplit(image).path.lstrip('/')).is_file(), 'Missing social image'
    assert p.ld, 'Structured data missing: '+name
    for ld in p.ld:
        graph=json.loads(ld)
        assert graph.get('@context')=='https://schema.org', 'JSON-LD context'
        assert isinstance(graph.get('@graph'),list), 'JSON-LD graph'
        assert all(n.get('@type') for n in graph['@graph']), 'Typed graph nodes'
        assert not any(k in json.dumps(graph) for k in ['aggregateRating','reviewCount']), 'No invented reviews'
for e in ET.parse(ROOT/'docs/sitemap.xml').iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc'):
    assert e.text in urls, 'Documentation missing from primary sitemap: '+e.text
assert 'Sitemap: https://iolinki.com/docs/sitemap.xml' in (ROOT/'robots.txt').read_text(), 'Documentation sitemap not advertised'
assert len({pages[n].title for n in PUBLIC})==len(PUBLIC), 'Distinct page titles'
assert len({pages[n].meta['description'] for n in PUBLIC})==len(PUBLIC), 'Distinct descriptions'
print(f'PASS crawler metadata, structured data and {len(urls)} canonical sitemap entries')
