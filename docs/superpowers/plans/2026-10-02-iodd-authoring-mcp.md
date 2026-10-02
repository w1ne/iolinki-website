# IODD authoring implementation plan

> Use subagent-driven-development for independent ownership, then spec and quality review before merge.

**Goal:** Shared deterministic authoring across browser, CLI and local MCP.
**Architecture:** Immutable JSON projects wrap preserved XML and attachments. Browser and Node call the same engine; transport code contains no separate authoring logic.
**Tech stack:** JavaScript ES modules, official MCP SDK, fflate, XML DOM adapter, Playwright, released Python IODD CLI and official XSD.

- [x] Engine agent owns `assets/js/iodd/project.js`, `package.js`, enhancements to `document.js`, vendor ZIP library, core tests and Node XML adapter. Write failing behavior tests first, implement contract in spec, test `node --test tests/iodd/project.test.mjs`. Preserve existing exports.
- [x] Transport agent owns `tools/iodd/cli.mjs`, `mcp.mjs`, transport tests and usage docs. Use spec API, official SDK and typed schemas. Test real stdio client lifecycle using `node --test tests/iodd/transport.test.mjs`. Verify malformed requests, independent sessions and export roundtrips.
- [x] Browser agent owns `iodd-editor.html`, editor JS/CSS, browser checks. Replace stacked forms with navigation/row selection, add project and ZIP handling, text/event/menu/assets controls, bit layout, firmware header and diff. Run browser tests at1440/390/320, inspect screenshots and verify user scenario.
- [x] Root owns dependency manifests, CI, docs/index discovery, external checker integration and source download package. Install pinned packages once; avoid concurrent lockfile edits. Run all Node tests, site checks, browser flows, official XSD/CLI on exported XML and C header compilation. Review integration and address findings.
- [x] Independent reviewer checks spec coverage then correctness/security/usability. Merge only after required CI passes. Wait for Pages and repeat live editor/docs checks; expose exact MCP install/start command and evidence limitations.

Expanded acceptance includes minimal device creation, generic XML tree forms, reusable dependencies, official profile template bindings, wired/wireless configuration, configurable validation, live Finder imports and IOLFW packages. Independent reviews found and fixed atomic-save, CRC-label and pattern-backtracking defects. Public deployment verification follows the merge.

Importable public counter and switching-sensor ZIPs now have byte-for-byte generation checks, CLI/browser import tests and official XSD checks. Actual released stack tests pass 100 cyclic exchanges, wire ISDU teach/read and 300 counter samples using the downloaded package mappings. Shared optional profile composition is constrained and checked with Common, Locator and BLOB packs.
