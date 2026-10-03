# Website analytics implementation plan

Goal: release useful consent-controlled website analytics on iolinki.com.
Architecture: shared static GA4 controller, minimal outcome events in the browser UI, deterministic MkDocs inclusion. Execute inline in the existing isolated worktree.

- [ ] Verify or create a dedicated iolinki GA4 property/stream through the existing browser; disable enhanced measurement and advertising features.
- [ ] Add `scripts/check-analytics.mjs` behavior tests. Run against current source and confirm missing consent UI fails. Route the production hostname to local source for tests; stub only Google's loader/network. Use `ANALYTICS_CDP_URL` to connect to existing Chrome locally.
- [ ] Implement `assets/js/analytics.js` and `assets/css/analytics.css`: default-denied consent, expiring choice, suppression, revocation, strict event/payload allowlist and sanitized page URLs.
- [ ] Load the shared assets on static HTML pages and through `docsite/mkdocs.yml`. Add outcome-only events after successful editor imports/creation/exports, clipboard copies and validated checkout starts. Rebuild docs.
- [ ] Update `legal.html` privacy and add `docs/ANALYTICS.md` for property identifiers, event contract, internal exclusion, reporting and proof boundaries. Add the browser test to CI.
- [ ] Run consent/privacy/outcome tests, existing relevant editor/setup and site checks, generated docs checks, and diff validation. Review final code and create a concrete PR.
- [ ] Merge after required green checks; verify GitHub Pages deployment and public analytics bytes. Run live consent checks and a debug Google collection request without exposing private contents. Read property reporting where available.
