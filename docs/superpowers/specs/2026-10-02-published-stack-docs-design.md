# Published stack documentation

Approved by the root task owner on 2026-10-02 under the user's instruction to
publish iolinki documentation using the LabWired approach.

Use MkDocs Material, matching LabWired's searchable sidebar, section navigation,
table of contents and code-copy controls. Publish at `https://iolinki.com/docs/`,
with device `v2.1.0` and master `v1.0.0` paths. Preserve the existing GitHub Pages
master-branch deployment by committing rendered output; no hosting migration.

`docsite/` owns configuration, curated Markdown and a manifest of imported source
pages. Import from explicit public-document allowlists at device commit
`ad892f43fa7292cb3d4ccf60410f5541a0d0a5ca` and master commit
`d23fd3034c0203ef829bd9734806389f8708fa94`. Record original path and hashes. Never
import agent reports, internal plans, proprietary specifications or PDFs.
Rewrite published crosslinks locally and remaining repository links to immutable
source URLs. Porting/API introductions must point at current context-based
interfaces; legacy device snippets remain explicitly labeled where published.

Each product section covers getting started, porting, architecture, API and
testing. Device examples additionally cover counter/button/LED, STM32G0 TIOL112
and native IAR, ESP32-C3 L6362A, STM32U5 Zephyr, IODD and released simulation
evidence. Separate host software, cross-build, simulator, native-IAR and physical
proof boundaries. Master hardware validation remains an uncompleted matrix.

Licensing pages distinguish immutable release content from the current product
offer. A commercial license for the device does not include the master. Publish
the master offer only after its merged commit is available; do not rewrite device
release archives. Checkout stays disabled. The editor agent owns marketing-site
navigation additions and can link `/docs/`; this task owns docs navigation.

Build into a temporary directory, then synchronize only generated documentation
paths into `docs/`, preserving repository planning documents. Add `.nojekyll` so
Pages serves generated assets. CI verifies deterministic generation, source
provenance, local links/fragments and responsive browser interaction/search.
Desktop and 390/320px pages must have no horizontal page overflow. Commit, push
and open a PR after validation; root reviews, integrates and verifies live URLs.
