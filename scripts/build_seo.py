#!/usr/bin/env python3
"""Generate deterministic crawler metadata from public, reviewed page copy."""
import argparse
from pathlib import Path
from html.parser import HTMLParser
import html
import json
import re
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
ORIGIN='https://iolinki.com'
PAGES={
 'index.html':('IO-Link device & master stacks in C | iolinki','Build IO-Link sensors and controllers with portable C device and master stacks. Explore Linux tests, STM32 and ESP32 examples, and free IODD tools.'),
 'getting-started.html':('IO-Link C stack: Linux build & tests | iolinki','Evaluate the iolinki IO-Link device stack on Linux. Build the released C examples, run host tests and prepare your firmware integration.'),
 'hardware.html':('IO-Link hardware: STM32, ESP32 & PHY examples | iolinki','Explore IO-Link firmware examples for STM32G0, STM32U5 and ESP32-C3 with TIOL112 and L6362A PHYs. See wiring, build evidence and physical-test limits.'),
 'validation.html':('IO-Link stack testing & validation evidence | iolinki','Review iolinki IO-Link host tests, firmware builds and simulation evidence. Understand what is verified and what still requires physical IO-Link testing.'),
 'faq.html':('IO-Link integration, IODD & licensing FAQ | iolinki','Answers about IO-Link device integration, STM32 and ESP32 examples, TIOL112 and L6362A drivers, IODD tooling, validation and commercial licensing.'),
 'purchase.html':('IO-Link stack commercial licensing | iolinki','Explore commercial licensing for iolinki IO-Link device and master stacks. Review evaluation options and contact the developer for a product-family quote.'),
 'legal.html':('iolinki support, licensing & privacy information','Find iolinki support and seller details, software licensing information, website analytics preferences and hosted IODD MCP privacy and service terms.'),
 'iodd-editor.html':('Free online IODD editor for IO-Link devices | iolinki','Create, import, edit and validate IO-Link IODD XML and ZIP packages in your browser. Export XML, ZIPs and C mappings. Files stay local; no signup needed.'),
 'studio/index.html':('IO-Link station studio: build stations with ChatGPT | iolinki','Ask ChatGPT for an IO-Link station: it places sensors and masters, wires each port and checks every setting against the datasheet. Open it here and order the install.'),
 'iodd-mcp.html':('IO-Link IODD MCP server for ChatGPT & coding agents | iolinki','Create and check IO-Link IODDs with ChatGPT, Codex or Claude using the free iolinki MCP server. Export XML, ZIPs and firmware mappings; use hosted or local tools.'),
}
CALLBACKS=['purchase-success.html','purchase-cancelled.html','generic.html','elements.html']
NS='http://www.sitemaps.org/schemas/sitemap/0.9'

def page_url(name):
 return ORIGIN+('/' if name=='index.html' else '/'+name[:-len('index.html')] if name.endswith('/index.html') else '/'+name)

def render(name,src):
 title,description=PAGES[name];url=page_url(name)
 src=re.sub(r'<title>.*?</title>','<title>'+html.escape(title)+'</title>',src,count=1,flags=re.S)
 src=re.sub(r'<meta\s+name="description"\s+content="[^"]*"\s*/?>','<meta name="description" content="'+html.escape(description,quote=True)+'" />',src,count=1,flags=re.S)
 src=re.sub(r'\s*<!-- BEGIN GENERATED SEO -->.*?<!-- END GENERATED SEO -->','',src,flags=re.S)
 src=re.sub(r'\s*<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*")\s+content="[^"]*"\s*/?>','',src,flags=re.S)
 nodes=[{'@type':'Organization','@id':ORIGIN+'/#organization','name':'iolinki','url':ORIGIN+'/','logo':ORIGIN+'/favicon.svg','sameAs':['https://github.com/w1ne/iolinki','https://github.com/w1ne/iolinki-master','https://github.com/w1ne/iolinki-website']},
 {'@type':'WebSite','@id':ORIGIN+'/#website','name':'iolinki','url':ORIGIN+'/','inLanguage':'en','publisher':{'@id':ORIGIN+'/#organization'}},
 {'@type':'WebPage','@id':url+'#webpage','url':url,'name':title,'description':description,'inLanguage':'en','isPartOf':{'@id':ORIGIN+'/#website'}}]
 if name!='index.html':nodes.append({'@type':'BreadcrumbList','itemListElement':[{'@type':'ListItem','position':1,'name':'iolinki','item':ORIGIN+'/'},{'@type':'ListItem','position':2,'name':title.split(' | ')[0],'item':url}]})
 if name in ['iodd-editor.html','iodd-mcp.html']:
  nodes.append({'@type':'SoftwareApplication','name':'iolinki IODD editor' if name=='iodd-editor.html' else 'iolinki IODD MCP server','url':url,'applicationCategory':'DeveloperApplication','operatingSystem':'Web browser' if name=='iodd-editor.html' else 'Hosted MCP or Node.js 22+','description':description,'isAccessibleForFree':True,'license':'https://github.com/w1ne/iolinki-website/blob/master/tools/iodd/LICENSE','offers':{'@type':'Offer','price':'0','priceCurrency':'EUR'}})
 block='\n    <!-- BEGIN GENERATED SEO -->\n'
 for key,value in [('og:type','website'),('og:site_name','iolinki'),('og:title',title),('og:description',description),('og:url',url),('og:image',ORIGIN+'/assets/images/og-card.png'),('og:image:width','1200'),('og:image:height','630'),('og:image:alt','iolinki: IO-Link C stacks, IODD editor and MCP tools')]:block+=f'    <meta property="{key}" content="{html.escape(value,quote=True)}" />\n'
 for key,value in [('twitter:card','summary_large_image'),('twitter:title',title),('twitter:description',description),('twitter:image',ORIGIN+'/assets/images/og-card.png')]:block+=f'    <meta name="{key}" content="{html.escape(value,quote=True)}" />\n'
 block+='    <script type="application/ld+json">'+json.dumps({'@context':'https://schema.org','@graph':nodes},separators=(',',':')).replace('<','\\u003c')+'</script>\n    <!-- END GENERATED SEO -->\n'
 return src.replace('  </head>',block+'  </head>')

def generated():
 out={}
 for name in PAGES:out[ROOT/name]=render(name,(ROOT/name).read_text())
 for name in CALLBACKS:
  src=(ROOT/name).read_text()
  if 'name="robots"' not in src:src=src.replace('</head>','<meta name="robots" content="noindex, follow" />\n  </head>')
  out[ROOT/name]=src
 ET.register_namespace('',NS)
 sitemap=ET.Element('{'+NS+'}urlset')
 urls=[page_url(name) for name in PAGES]
 urls += ['https://iolinki.com/terms/purchase-terms.html']
 urls += [e.text for e in ET.parse(ROOT/'docs/sitemap.xml').iter('{'+NS+'}loc')]
 for url in dict.fromkeys(urls):
  row=ET.SubElement(sitemap,'{'+NS+'}url');ET.SubElement(row,'{'+NS+'}loc').text=url
 ET.indent(sitemap,space='  ')
 out[ROOT/'sitemap.xml']=ET.tostring(sitemap,encoding='unicode',xml_declaration=True)+'\n'
 out[ROOT/'robots.txt']='User-agent: *\nAllow: /\n\nSitemap: https://iolinki.com/sitemap.xml\nSitemap: https://iolinki.com/docs/sitemap.xml\n'
 return out

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');args=p.parse_args()
 for path,text in generated().items():
  if args.check:
   if path.read_text()!=text:raise SystemExit('Stale SEO metadata: '+str(path.relative_to(ROOT)))
  else:path.write_text(text)
 print('SEO metadata and sitemap are reproducible' if args.check else 'Updated crawler and share metadata')
