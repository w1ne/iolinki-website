# Finder search implementation plan

**Goal:** Make the default Finder search find manufacturers such as ifm.
**Architecture:** Existing read-only proxy and immutable engine remain. Browser Finder adapter chooses the category; UI identifies it.

- [x] Adapter agent: assets/js/iodd/finder.js and tests/iodd/finder.test.mjs; automatic fallback, explicit mode, validation of result shape, pagination and failure regression tests.
- [x] Browser agent: iodd-editor.html, assets/js/iodd/editor.js, scripts/check-iodd-editor.mjs; default Automatic option, matched category, no-results guidance, clear entry title/instructions, exact ifm browser test. Verify live current failure before edits.
- [x] Root: review adapter/UI behavior, update deterministic download, run full shared/browser checks and exact live query/import, merge after CI and verify deployment.

Verified before merge: 49 Node tests, browser flows1440/390/320, actual public ifm2597results andPV2304ZIPimportdesktop/mobile. Final step is CI merge and live verification of the exact fix.
