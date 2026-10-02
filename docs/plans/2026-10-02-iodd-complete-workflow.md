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
- 76 local tests passed, four optional fixture/integration cases skipped; the clean npm integration separately passed both tests. Site/editor/setup/documentation browser checks passed at desktop/mobile sizes. Public source ZIP verified 90 SHA-256 entries and excludes private runtime state. Independent release review found no blocking issue.
- Official IODD Checker 2025.1 distribution is behind registration and emailed access at https://io-link.com/downloads. No registration or identity submission was made, and no Checker executable was obtained. Its hosted status remains unavailable. ChatGPT-specific account connection and physical IO-Link/PHY testing remain separate evidence.
