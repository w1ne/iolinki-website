# iolinki website analytics

Property: `557179831`, account: `250514419`. [Open iolinki reports](https://analytics.google.com/analytics/web/#/a250514419p557179831/reports/intelligenthome).

Measurement ID: `G-J1J05JDQEV`. Web stream: `15993348072`.

Google Analytics 4 collects website visits and explicit outcomes after opt-in. `assets/js/analytics.js` implements basic consent: no Google tag or Google request before consent. The shared script is included on marketing, editor/setup and generated MkDocs pages. No MCP server usage is collected by this script. Published purchase terms remain byte-for-byte immutable and do not load the tracker.

## Collection contract

| Event | Permitted dimensions | Meaning |
| --- | --- | --- |
| `page_view` | canonical public page URL, fixed title, blank referrer | Consented visit |
| `file_download` | enumerated artifact category | Click on a public release/download link; not proof of download completion |
| `iodd_create` | blank/counter/switching-sensor template | Successful local project creation |
| `iodd_import` | XML/ZIP/JSON format | Successful local import, without filename or content |
| `iodd_export` | XML/ZIP/header/JSON/firmware format | Successful local export initiation |
| `mcp_setup_copy` | supported client and fixed copy action | Successful clipboard write; not proof of connector connection |
| `begin_checkout` | single/team tier | Backend returned a valid Stripe Checkout URL |
| `contact_click` | none | Click on a mail contact link; not proof of sending email |

Queries, hashes, private referrers, form contents, IODD XML, project titles, filenames, clipboard text, recovery tokens, prompts and payment identifiers never enter custom events. Only allowed event names and enumerated dimensions pass the shared tracker. GA itself processes browser/device information and pseudonymous cookies after consent. This is not anonymous tracking.

Checkout is currently disabled. There is no `purchase` event: a publicly accessible success page or URL is not payment evidence. Add server-verified payment reporting separately when the real checkout is enabled.

## Preferences and exclusion

The notice offers Accept and Decline with equal controls. Analytics settings stays available for changing the choice. Choices expire after 180 days. Storage failure retains consent only in memory for the current document. Declining disables GA and clears its cookies and queued events; reloading remains declined. DNT, GPC, frames and nonproduction hosts suppress tracking even when a stored grant exists.

For staff visits, open `https://iolinki.com/?analytics_internal=1` once in each browser profile. It persists across pages; `?analytics_internal=0` clears the exclusion. Existing `?lw_internal=1` is accepted too. Do not use internal mode for public acceptance checks. `?analytics_debug=1` marks manually consented verification events for GA DebugView; private query values remain excluded.

## Property configuration and verification

Use a dedicated iolinki property under the existing owner account. Disable enhanced measurement so automatic outbound URLs, form interactions and site-search terms cannot leak content. Google signals and user-provided data collection are off. Ads personalization is disallowed in all 307 regions. User/event retention is two months, with reset on new user activity disabled.

Run `npm run check:analytics`. On this host set `ANALYTICS_CDP_URL` to the existing Chrome websocket; do not launch a new browser. CI uses its standard Chromium. Local tests route iolinki's production origin to local assets, exercise real UI outcomes, and stub Google's loader only. `SITE_URL=https://iolinki.com` reads the deployed site.

A successful Google collection HTTP response proves receipt at the collection endpoint, not final reporting. Inspect the property Realtime or DebugView independently. Standard reports can take longer to populate. Never report estimated customer engagement using test traffic.
