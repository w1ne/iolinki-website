# IO-Link Product Site Implementation Plan

> Execute in this session using superpowers:subagent-driven-development. The owner approved the design and implementation; continue through public deployment verification.

**Goal:** Replace the Spectral customer-facing template with a professional, responsive IO-Link product site.

**Architecture:** Static HTML pages share `assets/css/site.css` and accessible navigation in `assets/js/site.js`. Existing technical content, payment identifiers and checkout behavior remain intact. GitHub Pages continues to serve the site from `master`.

**Tech Stack:** HTML, CSS, native JavaScript, Python link checker, Playwright real Chromium browser checks.

## 1. Capture the regression and verification contract

- [x] Add `scripts/check-browser.mjs`, `package.json` and lockfile with Playwright.
- [x] Check every customer page at 1440px and 390px, page overflow, JavaScript/asset errors, named primary navigation, mobile Menu expansion/Escape, FAQ expansion, and disabled purchase state.
- [x] Run `npm run check:browser` against a local Python server and observe the missing accessible navigation failure on the old template.

## 2. Build the shared presentation

- [x] Create `assets/css/site.css` for readable typography, light/teal colors, cards, accessible controls, responsive tables/code and compact guide headers.
- [x] Create `assets/js/site.js`: enhance mobile navigation, toggle `aria-expanded`, close on Escape/link selection, return focus on Escape. Content remains available with JavaScript disabled.
- [x] Replace headers/footers and legacy presentation assets across customer pages; retain HTML5 UP attribution for retained content.
- [x] Preserve technical copy, existing URLs/anchors, forms and `assets/js/purchase.js`.

## 3. Implement the product homepage and seller notice

- [x] Replace `index.html` with hero, inline architecture diagram, separate device/master cards, integration paths, evaluation steps, validation link and scoped published prices.
- [x] Create `legal.html` with the owner-confirmed published seller identity and status links. Add it to `sitemap.xml` and the shared footer.
- [x] Record the newly reproduced published master/device integration failures on `validation.html`, including exact commits and reproducible test scope.

## 4. Verify and release

- [x] Run `python3 scripts/check_site.py`, `npm run check:browser`, and checkout `npm run check` if form presentation changed.
- [ ] Inspect real desktop/mobile screenshots and review the patch for accessibility, copy, licensing and scope.
- [ ] Commit, push, create focused PR, wait for required checks and merge without bypasses.
- [ ] Wait for GitHub Pages deployment and run the same browser checks against `https://iolinki.com/`; capture public screenshots and report any remaining non-site blockers.
