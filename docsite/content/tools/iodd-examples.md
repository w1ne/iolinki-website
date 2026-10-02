# Importable IODD examples

Download and import these ZIPs directly into the [browser editor](https://iolinki.com/iodd-editor.html):

- [Counter button LED](https://iolinki.com/downloads/iodd-counter.zip) — stamped XML, README, generated C mapping header and MIT/GPL licenses.
- [Switching sensor](https://iolinki.com/downloads/iodd-switching-sensor.zip) — stamped XML, README, generated C mapping header and MIT/GPL licenses.

Example vendor/device IDs: Counter button LED 1234/5678; Switching sensor 1234/5679. These IDs must match the connected firmware for automatic IODD selection. Replace them with assigned production identifiers when describing your own device.

# Counter, button and LED — importable IODD example

This package contains stamped iolinki_example-reference-device-20261002-IODD1.1.xml, this guide, a generated C firmware mapping header and both MIT/GPL license grants. The iolinki-authored XML templates are additionally available under MIT; this does not change the protocol stack license. Import the ZIP directly into the browser editor or another IODD importer. The examples describe the released [iolinki stack](https://github.com/w1ne/iolinki) applications.

The released reference-device demo produces a 16-bit counter followed by one button/state byte. Output bit 0 drives the LED; preserve the remaining output bits when changing it.

## Identity and use

Vendor ID 1234 and device ID 5678 are example identifiers. Product ID: reference-device. Replace example identity with IDs assigned to your own device before production use. Importing a file does not program the device or change its firmware IDs. A connected device must expose matching identity and process-data lengths.

## Parameters

This counter example has no application ISDU parameters. Standard identification records remain in the IODD.

## Process data

| Direction | Field | Subindex | Bit offset | Width |
| --- | --- | --- | --- | --- |
| Input | Counter | 1 | 8 | 16 |
| Input | Button | 2 | 0 | 8 |
| Output | LED | 1 | 0 | 1 |

Byte 0 is most significant. IODD offset 0 denotes the least-significant bit of the final process-data byte. Use the generated `iodd_read_bits` / `iodd_write_bits` helpers to avoid host endianness or packed-struct assumptions. Input length is 3 bytes; output length is 1 byte.

## Reopen and generate

From the iolinki website source checkout:

```sh
node tools/iodd/cli.mjs import --format package --input downloads/iodd-counter.zip --output counter.project.json
node tools/iodd/cli.mjs inspect --input counter.project.json
node tools/iodd/cli.mjs validate --input counter.project.json
node tools/iodd/cli.mjs export --input counter.project.json --format xml --output counter.xml
node tools/iodd/cli.mjs header --input counter.project.json --output counter-mapping.h
```

The repository's firmware proof compiles and runs the released application C against generated indexes, parameter defaults and bit mappings. That provides host execution evidence; physical IO-Link communication and hardware behavior require a connected-device test. Basic model/CRC validation, official XSD validation and official checker approval are separate results. This package contains no manufacturer declaration.

---

# Switching sensor — importable IODD example

This package contains stamped iolinki_example-switching-sensor-20261002-IODD1.1.xml, this guide, a generated C firmware mapping header and both MIT/GPL license grants. The iolinki-authored XML templates are additionally available under MIT; this does not change the protocol stack license. Import the ZIP directly into the browser editor or another IODD importer. The examples describe the released [iolinki stack](https://github.com/w1ne/iolinki) applications.

The released switching-sensor application returns a 16-bit measurement scaled by 100, a validity bit and a switching-output bit. Its ISDU service supplies setpoint, hysteresis, inversion and a teach command.

## Identity and use

Vendor ID 1234 and device ID 5679 are example identifiers. Product ID: switching-sensor. Replace example identity with IDs assigned to your own device before production use. Importing a file does not program the device or change its firmware IDs. A connected device must expose matching identity and process-data lengths.

## Parameters

| Parameter | ISDU index | Access | Default | Width |
| --- | --- | --- | --- | --- |
| Switch-on threshold x100 | 256 | rw | 5000 | 16 bits |
| Hysteresis x100 | 257 | rw | 200 | 16 bits |
| Invert switching output | 258 | rw | 0 | 8 bits |
| Teach current value: write 1 | 259 | wo | Command; no default | 8 bits |

## Process data

| Direction | Field | Subindex | Bit offset | Width |
| --- | --- | --- | --- | --- |
| Input | Measurement x100 | 1 | 8 | 16 |
| Input | Valid | 2 | 1 | 1 |
| Input | Switching output | 3 | 0 | 1 |

Byte 0 is most significant. IODD offset 0 denotes the least-significant bit of the final process-data byte. Use the generated `iodd_read_bits` / `iodd_write_bits` helpers to avoid host endianness or packed-struct assumptions. Input length is 3 bytes; no process-data output is declared.

## Reopen and generate

From the iolinki website source checkout:

```sh
node tools/iodd/cli.mjs import --format package --input downloads/iodd-switching-sensor.zip --output switching-sensor.project.json
node tools/iodd/cli.mjs inspect --input switching-sensor.project.json
node tools/iodd/cli.mjs validate --input switching-sensor.project.json
node tools/iodd/cli.mjs export --input switching-sensor.project.json --format xml --output switching-sensor.xml
node tools/iodd/cli.mjs header --input switching-sensor.project.json --output switching-sensor-mapping.h
```

The repository's firmware proof compiles and runs the released application C against generated indexes, parameter defaults and bit mappings. That provides host execution evidence; physical IO-Link communication and hardware behavior require a connected-device test. Basic model/CRC validation, official XSD validation and official checker approval are separate results. This package contains no manufacturer declaration.


## Reproducible release files

Run `node scripts/package-iodd-examples.mjs` to rebuild the downloadable ZIPs and this guide from the same engine/templates used by browser, CLI and MCP. Run with `--check` to verify committed files byte-for-byte without writing.
