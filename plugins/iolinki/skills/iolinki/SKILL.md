---
name: iolinki
description: Create, edit and validate IO-Link IODDs, generate C mappings, or integrate the iolinki device or master stack using its released examples and test evidence.
---

# iolinki

Use https://iolinki.com/llms.txt to discover the current released documentation and connection instructions. Prefer the user's existing stack version; use the release pages for a new integration. Device and master are separate stacks and need the corresponding PHY and port contract.

## IODD workflow

Use the iolinki IODD MCP server when connected. Discover its tool schemas rather than guessing arguments. Tools use the `iodd_` prefix, for example `iodd_create`, `iodd_inspect`, `iodd_edit`, `iodd_validate`, `iodd_export` and `iodd_header`. If unavailable, use the browser editor at https://iolinki.com/iodd-editor.html or the local CLI described at https://iolinki.com/iodd-mcp.html.

- Create with the `new`, `counter` or `switching-sensor` template, or import the user's XML, ZIP or saved project. Keep returned projectId in this session.
- Inspect before editing. Confirm vendor/device IDs, product identity, parameter indexes/access/defaults, process lengths and bit offsets against the actual firmware. Example IDs 1234/5678 and 1234/5679 are illustrative.
- Apply typed atomic edits. For fields outside typed forms use `tree` to inspect selectors before a document operation. Preserve unfamiliar XML, localized text, images and package assets. Use profile inspection before applying supplied profile XML.
- Validate after edits. Treat basic/model/CRC, official XSD and official IODD Checker results as separate evidence. A not-run checker is not a pass; none of these results certifies a finished device.
- Export a ZIP for device-tool import and a generated C header for firmware mapping. Save project JSON when the user needs editable work. Report filenames and the checks actually run. For firmware update packages use the separate firmware tools, not an IODD export.

## Stack integration

Read the released device getting-started, API, porting and matching board example before changing firmware: https://iolinki.com/docs/device/v2.1.0/. For the master use https://iolinki.com/docs/master/v1.0.0/ and its PHY contract.

Match IODD identity, ISDU indexes, parameter widths/defaults and process lengths to the application. IODD bit offset zero is the least-significant bit of the last process-data byte; use generated `iodd_read_bits` / `iodd_write_bits` helpers instead of assuming native endianness or packed structs.

Start from the counter or switching-sensor examples when their behavior fits. The sensor declares three input bytes, indexes 256–259, a 16-bit measurement scaled by 100, validity and switching bits. Read the example guide for exact defaults and layout: https://iolinki.com/docs/tools/iodd-examples/.

Keep host tests, compiler builds, LabWired digital-twin execution, physical master/PHY tests and official conformity results distinct. Use the release's simulation recipes for reproducible LabWired runs; report only evidence collected for the user's target. An IAR project being present does not prove that their EWARM version compiled it.

Commercial questions should use https://iolinki.com/faq.html#licensing and the agreed quote. Do not infer new redistribution rights from generated IODD/header tooling's MIT license; protocol stack terms are separate.
