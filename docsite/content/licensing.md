# Licensing and publication sources

The device and master are **separate products**. A commercial license for one
does not grant commercial rights to the other. Each follows a GPLv3-or-commercial
model; the applicable accepted agreement determines commercial scope.

Technical documentation is versioned independently of current commercial offers.
Device v2.1.0 pages use source commit
[`ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca`](https://github.com/w1ne/iolinki/tree/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca).
Master v1.0.0 pages use documentation snapshot
[`d23fd3034c0203ef829bd9734806389f8708fa94`](https://github.com/w1ne/iolinki-master/tree/d23fd3034c0203ef829bd9734806389f8708fa94).
Release artifacts retain their own embedded manifests and original terms.

## License texts

- [Device GPLv3 license](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/LICENSE).
- [Device release commercial terms](https://github.com/w1ne/iolinki/blob/ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca/LICENSE.COMMERCIAL).
- [Master GPLv3 license](https://github.com/w1ne/iolinki-master/blob/d23fd3034c0203ef829bd9734806389f8708fa94/LICENSE).
- [Master Indie/Company commercial terms](https://github.com/w1ne/iolinki-master/blob/ee8e51e0cfa3b187a9e850c88688712832cb60f9/LICENSE.COMMERCIAL).
- [Current website licensing information](https://iolinki.com/purchase.html) and
  [product-family terms](https://iolinki.com/legal.html).

The master commercial offer was updated in merged commit `ee8e51e0cfa3`.
Indie is €1,399 for a named individual’s independent product family, with two
onboarding hours. Company is €4,699 for a named legal company’s product family,
with unlimited authorized employees and contractors and eight scoped engineering
hours. Both allow unlimited units royalty-free and perpetual use of the licensed
version. Already-granted rights remain governed by their accepted agreement.

## Reproduce this documentation bundle

The website repository contains curated Markdown under `docsite/content`,
MkDocs configuration and a per-page source manifest. The import script uses an
explicit public-doc allowlist and `git show` at the exact source commit. Each
imported page links its original source and records original/published SHA-256
hashes in `docsite/sources.json`.

```sh
python3 -m venv /tmp/iolinki-docs-venv
/tmp/iolinki-docs-venv/bin/pip install -r docsite/requirements.txt
/tmp/iolinki-docs-venv/bin/python scripts/build_docs.py
/tmp/iolinki-docs-venv/bin/python scripts/build_docs.py --check
python3 scripts/test_docs.py
python3 scripts/check_site.py
```

Only selected public guides are imported. Agent reports, internal source plans,
proprietary IO-Link specification PDFs and licensing archives are not included
in the documentation bundle. GitHub Pages publishes the committed rendered HTML
at `/docs/`; the docs build does not change license archives or activate checkout.
