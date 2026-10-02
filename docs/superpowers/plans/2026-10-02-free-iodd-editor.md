# Free IODD editor implementation plan

1. Vendor pinned MIT XML/tree and CRC modules with licenses; copy released XML
   templates. Add tests describing import, edit, preserve, diagnostics and export.
2. Build a headless document adapter with strict imports, supported-section
   projection, targeted tree edits, structural/type checks and stamped exports.
3. Build a responsive site page with template/import actions, identity/parameter/
   process-data forms, XML editing, validation messages and download.
4. Add site navigation and sitemap discovery; retain existing checkout settings.
5. Execute browser tests and downloaded-file CLI/XSD validation, inspect mobile
   screenshots, run existing browser/link checks, then commit/push/open a PR.
