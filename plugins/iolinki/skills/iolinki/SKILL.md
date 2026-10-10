---
name: iolinki
description: Use when planning an IO-Link station (sensors, masters, wiring, order), authoring or recovering IO-Link IODDs, preparing a switching-sensor firmware proof, or integrating the iolinki device or master stack.
---

# iolinki

Use https://iolinki.com/llms.txt to discover the current released documentation and connection instructions. Prefer the user's existing stack version; use the release pages for a new integration. Device and master are separate stacks and need the corresponding PHY and port contract.

## IO-Link stations

For a station, machine or line ("pressure switch at 40 bar on the pump", "detect boxes on the conveyor"), call `iolink_station_parts` first; pass `query` to find devices beyond the filed parts in IODD Finder (any vendor, typed `iodd-<vendorId>-<ioddId>`). Then call `iolink_station` with every part placed on the floor (x, z in metres) and a wire from a master port pin `X1..Xn` to each sensor's `C/Q`, with settings in the units at the machine. Inductive distances are for the named target material. To change the station, call it again with the full updated diagram.

The widget already shows the 3D station, run mode, wiring, port table, installer notes and the order with Buy. Reply in one or two sentences: what was built and any note that needs the user's decision. Do not restate the parts, settings or order as a table, and do not draw a diagram. Nothing is written to a sensor and no payment is taken.

## IODD workflow

Use the iolinki IODD MCP server when connected. Discover its tool schemas rather than guessing arguments. The hosted/local server exposes 20 tools using the `iodd_` prefix, for example `iodd_create`, `iodd_inspect`, `iodd_edit`, `iodd_validate`, `iodd_export` and `iodd_header`. If unavailable, use the browser editor at https://iolinki.com/iodd-editor.html or the local CLI described at https://iolinki.com/iodd-mcp.html.

- Create with the `new`, `counter` or `switching-sensor` template, or import the user's XML, ZIP or saved project. Keep returned projectId in this session.
- Inspect before editing. Confirm vendor/device IDs, product identity, parameter indexes/access/defaults, process lengths and bit offsets against the actual firmware. Example IDs 1234/5678 and 1234/5679 are illustrative.
- Apply typed atomic edits. For fields outside typed forms use `tree` to inspect selectors before a document operation. Preserve unfamiliar XML, localized text, images and package assets. Use profile inspection before applying supplied profile XML.
- Validate after edits. Hosted validation uses the pinned October 2025 official XSD package and reports its validator/provenance separately from basic/model/CRC checks. Inspect actual statuses; unavailable, failed or not-run means no pass. The official IODD Checker is a separate tool installation and is not configured on the hosted server; its official distribution is being checked separately. None of these results certifies a finished device.
- Export a ZIP for device-tool import and a generated C header for firmware mapping. Save project JSON when the user needs editable work. Report filenames and the checks actually run. For firmware update packages use the separate firmware tools, not an IODD export.

## Recovery

When the user needs recoverable work, call `iodd_save` explicitly. Keep its private `token` and reported expiry; do not publish tokens in shared artifacts. Anyone with the token can restore or delete that snapshot. Hosted saves report `durable:true` and survive session/runtime restarts for up to 24 hours from saving. Changes after a save require another save. Use `iodd_restore` with the token in a new session and keep the new returned projectId. Use `iodd_delete_saved` when recovery is no longer needed; closing a session project does not delete snapshots.

Local stdio saves report `durable:false` and live only in process memory. Export JSON/ZIP before restarting locally or before the hosted snapshot expires. Export-download URLs and recovery tokens have different lifetimes. Do not describe a successful save as permanent storage.

## Actual firmware proof

For a compatible switching-sensor IODD, call `iodd_firmware_source`. Pass its returned `compile` object to the connected LabWired plugin's `labwired_compile`, then pass `verify` plus the actual compiled `firmware_ref` to `labwired_verify`. Optionally use `labwired_put_source` for the provided source/files first. If LabWired is unavailable, export the kit and state that compilation/execution has not been performed; do not manufacture a result.

`iodd_firmware_kit` exports complete GPL-3.0-or-later application source, authored JSON/XML, generated mapping/defaults, pinned released sensor implementation, license/hashes and `labwired.json` arguments. It rejects unsupported parameter/process contracts. It is distinct from `iodd_firmware_create`/`iodd_firmware_inspect`, which package or inspect supplied IOLFW binaries.

The supported proof target is STM32F401 Blackpill (`stm32f401cdu6-blackpill`), C entry `src/main.c`, UART2 output. The actual firmware checks authored defaults, threshold/hysteresis, validity, parameter write/readback, process-byte decoding, inversion and teach before printing `IODD_SENSOR_PROOF_PASS`. Report the returned verdict, observed console and model gaps. A source kit, compile or printed partial marker alone is not a verification pass. This proof executes the sensor application on the MCU model; it excludes IO-Link transport/PHY/cable, physical master, retained flash, IAR and official conformity. Retain supply/clock approximations disclosed by LabWired.

## Stack integration

Read the released device getting-started, API, porting and matching board example before changing firmware: https://iolinki.com/docs/device/v2.1.0/. For the master use https://iolinki.com/docs/master/v1.0.0/ and its PHY contract.

Match IODD identity, ISDU indexes, parameter widths/defaults and process lengths to the application. IODD bit offset zero is the least-significant bit of the last process-data byte; use generated `iodd_read_bits` / `iodd_write_bits` helpers instead of assuming native endianness or packed structs.

Start from the counter or switching-sensor examples when their behavior fits. The sensor declares three input bytes, indexes 256–259, a 16-bit measurement scaled by 100, validity and switching bits. Read the example guide for exact defaults and layout: https://iolinki.com/docs/tools/iodd-examples/.

Keep host tests, compiler builds, LabWired digital-twin execution, physical master/PHY tests and official conformity results distinct. Use the release's simulation recipes for reproducible LabWired runs; report only evidence collected for the user's target. An IAR project being present does not prove that their EWARM version compiled it.

Commercial questions should use https://iolinki.com/faq.html#licensing and the agreed quote. Do not infer new redistribution rights from generated IODD/header tooling's MIT license; protocol stack terms are separate.
