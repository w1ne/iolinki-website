# Complete IODD agent workflow

Goal: a user describes a switching sensor, an assistant authors and validates its IODD, exports recoverable artifacts, and uses the actual generated firmware mapping in compiled and executed code.

Approved scope follows the user request to cover the remaining MCP work. Preserve one shared XML engine and typed tools. Reuse LabWired compile/verify capabilities instead of exposing arbitrary shell commands in the hosted server.

## Hosted official schema validation
- Add an externalValidation capability to IoddHttpHost and wire the Worker to a real XSD validator.
- Fetch only the fixed published October2025 official schema package, verify its pinned archive hash, and resolve only its included local schemas. Never accept user URLs or fetch external entities.
- Report schema validator, schema provenance/digest, passed/failed/unavailable independently from basic checks and official Checker.
- Test actual schema-valid templates and XSD-invalid documents, include resolution, blocked external entities and bounded input.
- Official Checker remains an operator-configured executable; obtain and run only when its actual distribution/license permits this environment.

## Recovery
- Add explicit saved-project capability with an opaque recovery token, bounded lifetime and explicit deletion.
- Persist serialized project data in Durable Object storage through an adapter; preserve session isolation and validate every restored project through the existing engine.
- Do not persist tool sessions or imply indefinite retention. Test fresh-runtime restore, rejected/expired handles, deletion, bounds and failed writes.

## Firmware and LabWired
- Create a firmware source kit from the authored switching-sensor project and its generated mapping header.
- Use the released switching_sensor implementation and actual parameter/process-data contract, pinned source with its license; reject incompatible IODDs rather than silently generate mismatched firmware.
- Include canonical LabWired source layout, explicit target and behavioral oracle covering threshold/hysteresis, validity, parameter readback and process bytes.
- Compile and execute the kit; a mismatched parameter/default or process bit must fail the proof.
- Separate application-level MCU execution from physical PHY, analog cable, official conformity and IAR proof.

## Integration and evidence
- Root integrates tools, adds complete authoring workflow test and agent instructions.
- Prove natural-language tool use in an actual assistant against the hosted endpoint. ChatGPT-specific proof requires the user-connected plugin; another assistant must be labelled accurately.
- Regenerate versioned npm/plugin/source archives and docs, run relevant tests, obtain independent review, merge, deploy Worker/site, then compare public artifacts and run live positive/negative checks.

## Verified implementation

- Hosted recovery uses explicit private-token snapshots in Durable Object storage. Actual local Worker stop/start followed by a fresh session in another shard restored the authored identity; explicit deletion revoked the token.
- Pinned official October 2025 XSD validation runs in the Worker using static libxml2 WASM and local includes. Real SDK calls pass both templates and reject basic-valid/schema-invalid attributes and entities. No official schemas are redistributed.
- Firmware kit uses unchanged released sensor source, generated indexes/defaults and a UART witness. Actual hosted LabWired compile/verify passed original and changed defaults; a wrong default failed execution and a wrong validity bit failed compilation. Exact refs and power/clock approximations are recorded in assets/iodd/firmware-kit/hosted-evidence.json.
- 90 local tests passed, four optional fixture/integration cases skipped; the clean npm integration separately passed both tests. Site/editor/setup/documentation browser checks passed at desktop/mobile sizes. Public source ZIP verified 90 SHA-256 entries and excludes private runtime state. Independent release review found no blocking issue.
- The canonical public endpoint is https://mcp.iolinki.com/mcp. A dedicated Caddy proxy with automatic HTTPS forwards to the Worker; exported download URLs use the configured public origin. DNS changes preserved all six existing website records and email-forwarding settings. Actual canonical-host SDK schema, export download and cross-shard recovery/revocation checks passed.
- Genuine legacy IO-Link Checker 1.1.4 was found in the public Autonics atIOLink installer and run through Mono with an unmodified Microsoft Visual Basic runtime. It exposed missing mandatory standard references, invalid singleton ranges, missing ISDU test configurations and nonconforming generated filenames. The corrected starters pass actual Checker execution; malformed XML, schema-invalid attributes and missing mandatory references fail. The operator executable stays private and is not redistributed.
- The older Checker result is separate from validation against the current October2025 schemas. Checker2025.1 still requires supplier access. Hosted Checker execution is not configured; local CLI/stdio reports the actual configured result. ChatGPT-specific account connection, physical IO-Link/PHY/device test configurations and EWARM remain separate evidence.

- Production idle testing exposed Durable Object memory eviction before advertised export expiry. Export artifacts now use separate transactional 64 KiB storage chunks, SHA-256 integrity, ten-minute TTL, 16 MiB/128 limits per shard and expiry alarms. Recreation, disconnect, corruption, concurrent quota and rollback regressions pass.
