# IO-Link product website

Approved by the owner on 2026-10-01.

IO-Link website redesign — proposed design, 2026-10-01

Recommended direction: a clean, light engineering product site with blue/teal
accents, generous spacing, readable sentence-case typography, and a compact
navigation. Replace the full-screen photographic template and oversized
letter-spaced headings. Retain the IO-Link identity and the existing guides.

Homepage
Headline: IO-Link stacks. Built for your firmware.
Explain the device stack for sensors/actuators and the master stack for
controllers in one short paragraph. Primary action: Try an example.
Secondary action: Explore the stacks.
Use a small native SVG diagram of a controller and its sensor/actuator ports
to explain the two product roles; identify it as an architecture diagram.
Follow with two product cards, integration targets, a runnable evaluation
path, validation evidence, and clearly scoped commercial licensing.
Show actual source/docs/example links and published EUR license tiers.
Describe GPLv3 and commercial licensing without invented customer logos,
benchmark figures, certification badges, or hardware-validation claims.

Guide and purchasing pages
Give getting started, hardware, validation, FAQ and license pages the same
header, footer, colors and typography. Keep technical commands and content.
Use contained horizontal scrolling for code and wide tables. Make cards,
forms, and action groups stack cleanly on phones. Use accessible native
navigation with a small mobile menu and visible keyboard focus states.
Display unavailable checkout honestly and keep its existing disabled state.
Keep all checkout DOM identifiers and the payment JS behavior intact.

Seller information
Use Andrii Shylenko e.v. and the published Hungarian address/tax/contact
details. Link the existing purchase-terms status. A visual redesign does not
approve or activate executable purchase terms or a live Stripe configuration.

Implementation
Keep a static HTML/CSS/JavaScript site on the existing GitHub Pages deployment.
Use one shared stylesheet and minimal navigation JS, with no framework or
new backend. Preserve existing public URLs, content anchors and guide links.
Keep the existing checkout Worker separate from the visual changes.
Do the redesign from clean current upstream in an isolated checkout because
the other website worktree has an unrelated active PR.

Verification and release
Run the existing local-link/site checks. In real Chrome check desktop and
mobile layouts, every customer-facing page, navigation, keyboard interaction,
FAQ expansion, contained table/code scrolling, and disabled purchase state.
Check for browser errors, missing assets and horizontal page overflow.
Capture screenshots for review. Run the checkout regression suite if markup
changes affect its form. Push a focused PR, pass required checks, merge and
verify the deployed site after GitHub Pages finishes.

Alternative
Repair the existing dark Spectral template with smaller headers and improved
spacing. This has less visual scope but preserves the dated template styling.

Separate known blocker
The published master/device pair currently fails three real-stack integration
cases. Preserve honest validation copy; the site redesign is not evidence
that these protocol failures have been repaired.
