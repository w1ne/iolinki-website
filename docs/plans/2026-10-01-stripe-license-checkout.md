# Stripe checkout and software license delivery

Date: 2026-10-01
Status: implementation approved; account configuration and production activation pending.

## Outcome

Customers can buy a Single Developer or Team software license from the existing static iolinki site using hosted Stripe Checkout. After verified payment, the buyer receives a software license certificate PDF and a Stripe receipt link, and the owner receives a purchase notification. The certificate records the software license purchase; it is not IO-Link certification, hardware validation or a conformance report.

Keep the existing GitHub Pages site and theme. Add a Cloudflare Worker API, D1 database and durable delivery outbox. No customer names or private purchase information belong in public pages, source fixtures or documentation. The existing FAQ, reference projects and analog Twin work continue independently.

## Launch configuration and terms gate

Implement and test without requiring production credentials. The live purchase endpoint must return an unavailable response while required configuration is missing; the public site must not offer a functioning live purchase path until the gate passes.

Required configuration:

- Stripe merchant account, API secret, endpoint signing secret, API version and explicit test/live mode.
- Server-controlled EUR Price IDs for Single Developer and Team, validated against the selected account and mode.
- Merchant legal name/address and the issuer details to appear on the certificate and Stripe receipt.
- Tax treatment: whether the advertised prices include or exclude tax, registrations/collection policy and whether automatic tax or invoice creation is enabled. Do not infer this from EUR prices or the merchant's presumed location.
- Verified sender domain/email and supported transactional delivery provider, plus the owner's notification address.
- Approved, immutable purchase terms and their version/hash, certificate wording, licensed-version scope and cancellation/refund treatment.

The current `LICENSE.COMMERCIAL` documents €1,399 for one seat and unlimited commercial deployments; €4,699 for up to five seats and up to eight hours of integration assistance; perpetual rights to the licensed version; one year of updates/bug fixes and optional renewal at the published 20% rate. Preserve these entitlements and the published support scope. The current document describes a quote/signature purchase process: an automated terms-acceptance flow must use owner-approved purchase terms rather than silently treating overview/FAQ text as a replacement agreement. Do not invent source redistribution or support entitlements.

Publish the approved terms at a stable versioned URL, retain their exact bytes and SHA-256 hash, and never overwrite an accepted version. Every order records the version, hash, server acceptance time and the versioned terms presented. Reject absent/false acceptance and a stale or unknown terms version. A changed price, entitlement or terms document requires a new version for future orders; issued licenses retain their original snapshot.

The account and notification questions are pending with the user. Continue reversible implementation and local tests without repeatedly asking the same questions. Do not create live Stripe products/prices, send real emails or enable production buying as part of implementation testing.

## Files and deployment shape

Suggested layout, adjustable to existing repository conventions:

- `purchase.html`: concise tier selection, terms link and required acceptance checkbox; retain the existing navigation/footer.
- `purchase-success.html`: generic payment/delivery explanation. Visiting it does not establish payment or issue a license.
- `purchase-cancelled.html`: retry link, without claiming the payment failed or cancelled definitively.
- `assets/js/purchase.js`: submit the selected tier and terms acceptance to the Worker, then navigate to the returned hosted Checkout URL.
- `checkout-worker/`: TypeScript Worker, package/lockfile, Wrangler configuration, migrations and tests.
- `checkout-worker/src/checkout.ts`, `webhook.ts`, `fulfillment.ts`, `certificate.ts`, `delivery.ts`, `config.ts`: separate responsibilities only where this simplifies review.
- `checkout-worker/migrations/0001_orders_licenses_outbox.sql`.
- `terms/<approved-version>.html` and an exact terms snapshot available to certificate generation.

Use a dedicated Worker hostname, such as `checkout.iolinki.com`, and permit browser CORS only from configured site origins. Stripe's webhook route does not depend on browser CORS. Store credentials as Worker secrets, never site assets. Document deployment/migrations, rollback, outbox inspection and retry procedures. Do not deploy configuration that enables live buying while launch inputs remain unknown.

## Checkout creation

`POST /checkout` validates a small JSON schema containing the allowed tier and terms acceptance/version. The server sets payment mode, quantity one, configured Price ID, fixed return URLs and receipt/customer collection settings. Client input cannot set amount, currency, quantity, coupon, entitlement, owner recipient or redirect URL.

Before calling Stripe, create an internal order containing the expected tier, Price ID, currency, base amount, terms snapshot and requested mode. Generate an order-specific Stripe idempotency key. Include the order ID in Checkout metadata and persist the resulting Session ID. If Stripe succeeds but the database update fails, a retry/reconciliation must recover the same session rather than issue duplicate purchases. Return only a validated hosted Checkout URL. Limit request size and apply a reasonable purchase-creation rate limit.

Pin the official Stripe SDK and configure its Workers-compatible HTTP/WebCrypto behavior. Verify these choices under the actual Worker test/runtime rather than assuming Node-only helpers work at the edge.

## Authoritative payment and fulfillment

`POST /stripe/webhook` reads the raw body once and verifies `Stripe-Signature` using the official SDK's asynchronous signature verifier and the configured signing secret. Do not parse, reserialize or otherwise modify the body before verification. Retain the normal timestamp tolerance. Invalid signatures return an error; unrelated valid event types return success without fulfillment.

Handle `checkout.session.completed` and `checkout.session.async_payment_succeeded`. A completed session with unpaid status does not issue a license; record its pending state and wait for successful payment. Failed/expired sessions do not generate certificates.

Retrieve the authoritative Session and all relevant line items from Stripe before fulfillment. Validate:

1. Expected test/live mode and configured merchant context. A correctly signed test event cannot issue a live license.
2. Session payment mode, paid status, known internal order and matching Session/order linkage.
3. Exactly one permitted line item, quantity one, expected Price ID, EUR currency and the tier's stored base amount: 139900 or 469900 cents.
4. Price/product data consistent with the configured tier. Do not trust user-provided metadata to define entitlements.
5. Subtotal, discount and tax treatment consistent with the approved policy. Do not compare a tax-inclusive total blindly against an untaxed base price; store the actual subtotal/tax/total and Stripe payment references.
6. Required purchaser identity/email and the accepted immutable terms snapshot.

Transient Stripe or database failures return a retryable webhook error before fulfillment is durable. Irreconcilable mismatches enter an auditable rejected/quarantined state and never issue a license. Avoid logging secrets, complete webhook bodies or unnecessary customer information.

## D1 consistency and outbox

Minimum tables:

- `orders`: internal ID; unique Session ID when known; tier/expected Price/currency/amount/mode; accepted terms version/hash/time; payment and purchaser snapshots; status.
- `webhook_events`: unique Stripe event ID, object ID/type, receipt/processing state and limited audit information.
- `licenses`: stable certificate ID; unique paid Checkout Session/order; entitlement, licensed-version and terms snapshots; issuance timestamp.
- `delivery_jobs`: unique `(license_id, recipient_role)`; buyer or configured owner destination; template version; state, attempts, retry time, lease token/expiry and provider message ID.

Atomically record successful fulfillment, the unique license and both delivery jobs using D1 transactional `batch()`. Unique Session/order constraints prevent distinct event IDs from issuing multiple licenses for the same payment. Conflict/replay paths must reference the existing license, not a newly generated unused identifier. Do not mark an event successfully processed separately before the license/outbox transaction commits.

Do not perform email API calls inside the database transaction or depend on a browser redirect for fulfillment. A scheduled Worker claims due jobs with a conditional atomic update and lease token, then generates the certificate and sends delivery. Persist acknowledgment with the matching lease token. Retry temporary failures with bounded backoff; surface exhausted jobs for manual action. Buyer and owner delivery jobs are independent.

Use provider idempotency where available, but do not promise exactly-once email: a provider success followed by a database acknowledgment failure can otherwise produce a duplicate. Stable job identifiers and provider message IDs support reconciliation. Do not hold license issuance hostage to an owner's notification failure.

## PDF, receipt and email

Generate the certificate from the committed immutable license snapshot, with issuer, purchaser, license ID, tier/seats, applicable rights, licensed-version scope, terms version/hash, payment reference and issuance date. Derive all values from the validated order/license, not URL parameters. Keep certificate metadata stable across retries.

Buyer names and company names may contain accented or non-Latin characters. Embed a legally redistributable Unicode font supported by the chosen PDF library and test the supported scripts. Do not use standard PDF fonts that silently drop Unicode or throw for characters outside their encoding. Check glyph coverage and text wrapping; reject or visibly flag unsupported text for resolution rather than silently substituting a different purchaser. Include font licensing and avoid fetching arbitrary remote fonts during fulfillment.

The PDF must remain clearly a software-license record. Do not add IO-Link certification badges, validated hardware claims, customer references, or a fabricated legally signed agreement.

Use Stripe's actual receipt URL from the successful payment. Configure Stripe's receipt-email settings; account issuer/branding information must be correct. Enable one-time invoice creation only if the approved account/tax configuration calls for it. The software certificate is not a substitute tax invoice. Stripe does not automatically email test-mode receipts, so test delivery assertions must distinguish provider fixtures from real receipts.

Prefer current Cloudflare Email Service's Workers API if the sender domain/account is onboarded and supports this use; otherwise use an approved transactional provider. Use a provider abstraction for deterministic tests. Attach the certificate and include the actual Stripe receipt link in the buyer message. Notify the configured owner with the order/license/tier/payment information needed to reconcile the purchase. Do not expose purchaser information through an unauthenticated success-page lookup.

Refunds and disputes should be recorded and routed for owner handling according to approved terms. Do not invent an automatic revocation policy for perpetual licenses.

## Tests and acceptance evidence

Automated tests must exercise real Worker handlers and database constraints, with deterministic Stripe/email fixtures where external calls are inappropriate:

- Allowed tiers and missing/stale terms acceptance; attempted price, currency, quantity, redirect and recipient tampering.
- Raw-body valid/invalid signatures, modified payloads, stale signatures and mode mismatches.
- Unpaid completed session, delayed successful payment, failed payment, unknown order, wrong Price/quantity/currency/amount and unexpected discount/tax policy.
- Same-event retries, distinct events for the same Session, concurrent delivery, and failure before/after each database transaction boundary: one license and one buyer/owner job per paid order.
- Stripe create-session success followed by local persistence failure and idempotent recovery.
- Email transient failure, duplicate scheduled execution, expired leases, provider success followed by failed acknowledgment, exhausted attempts, and independent buyer/owner progress.
- Certificate snapshot immutability, seat counts and entitlement text; Unicode names, long company names and layout. Parse/render the PDF to check text and readability, not merely that bytes exist.
- Receipt link from the verified payment; no fabricated receipt or certificate from a success-page visit.
- Missing production configuration leaves buying disabled. No frontend bundle or logs contain secrets.
- Existing site link/fragment/asset checks and desktop/mobile purchase navigation.

Before live activation, perform an owner-authorized Stripe test-mode purchase with the configured account, verify signed webhook processing, D1 uniqueness, certificate contents and delivery to authorized test recipients, and replay the event to confirm no second license. Record test-mode evidence explicitly. Confirm merchant identity, tax policy, immutable terms, receipt settings, sender authentication and owner recipient before switching mode. Live purchase proof requires a separate authorized live transaction; never describe fixtures or test-mode checkout as real customer revenue.

## Primary references

- [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment): authoritative retrieval, paid-state gating and delayed payments.
- [Stripe webhooks](https://docs.stripe.com/webhooks): raw-body signatures, duplicate events and retry behavior.
- [Stripe receipts](https://docs.stripe.com/receipts): actual receipt URLs, receipt emails and one-time invoice settings.
- [Official Stripe Node SDK](https://github.com/stripe/stripe-node): pin and verify SDK/runtime integration.
- [Cloudflare D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/): transactional batch semantics.
- [Cloudflare Email Service Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/): sender onboarding, native sending, PDF attachments and delivery errors.
- [Current commercial license](https://github.com/w1ne/iolinki/blob/main/LICENSE.COMMERCIAL): current published entitlements; use the approved immutable snapshot at purchase time.
