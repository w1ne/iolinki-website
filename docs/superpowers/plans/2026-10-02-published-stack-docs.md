# Published stack documentation implementation plan

> Execute inline in the isolated `feat/published-stack-docs` worktree. Use the
> executing-plans and verification-before-completion skills task by task.

**Goal:** Publish source-grounded rendered docs for device v2.1.0 and master v1.0.0.

**Architecture:** MkDocs Material builds checked-in curated source documents into
committed `/docs/` HTML. Explicit pinned import manifests make source snapshots
reviewable and immutable; current commercial offers carry separate provenance.

**Tech stack:** Python, MkDocs Material, Markdown, Node Playwright, GitHub Pages.

## Tasks

- [ ] Record approval and commit the design/plan.
- [ ] Write `scripts/test_docs.py` contracts for version roots, private-source
  exclusion, provenance hashes and immutable source links. Run
  `python3 scripts/test_docs.py`; expect missing manifest before implementation.
- [ ] Add pinned `docsite/requirements.txt`, `docsite/mkdocs.yml` and explicit
  `scripts/import_docs.py` allowlists. Use `git show COMMIT:PATH` to obtain source
  bytes and map Markdown links with `urllib.parse`/`posixpath`; fail on absent
  sources instead of silently dropping pages.
- [ ] Import curated public docs, record original source hashes and rendered
  source hashes in `docsite/sources.json`; author version landing/getting-started,
  context-based device API/porting, IODD and release-evidence pages.
- [ ] Add `scripts/build_docs.py` staging and generated-path synchronization;
  `--check` rebuilds and compares every generated output without mutation.
- [ ] Install dependencies in `/tmp/iolinki-docs-venv`, run
  `python scripts/build_docs.py`, then provenance contracts and existing site
  checks. Extend `scripts/check_site.py` to recursively validate generated docs.
- [ ] Add docs provenance/build check steps to static-site CI using the pinned
  requirements; preserve the existing branch publishing configuration.
- [ ] Add `scripts/check-docs-browser.mjs` covering version navigation, search,
  code content and 1440/390/320px layout. Run with system Chromium and inspect
  saved desktop/mobile screenshots. Fix failures and re-run affected checks.
- [ ] Confirm the merged master commercial-offer pin with root; update only its
  docs snapshot/provenance, keeping technical version pins unchanged.
- [ ] Run deterministic build, full static link checks and docs browser checks;
  commit/push the reviewed docs change and create a PR with actual results and
  explicit native-IAR/hardware limitations. Report CI and exact public paths.
