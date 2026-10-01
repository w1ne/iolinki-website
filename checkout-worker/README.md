# License checkout Worker

Reviewable implementation; purchasing and delivery are disabled in the checked-in configuration. No live Stripe objects, emails, or deployment have been created. The website's `checkout-api` meta value is blank, so it makes no API request and keeps acceptance and checkout disabled.

## Local verification

Use Node 22 or newer:

```sh
npm ci
npm run check
npm run deploy
```

`deploy` deliberately performs **only a Wrangler dry run**. Tests run the bundled Worker inside native workerd/Miniflare with real local D1 transactions. Outbound Stripe and Resend requests are intercepted by synthetic fixtures. A test-only subclass calls the scheduled handler from an HTTP request context; the production Worker has no delivery/admin HTTP endpoint. The fixture PDF is saved to `/tmp/iolinki-license-test.pdf` and uses a fictional merchant and purchaser.

## Configuration and launch gates

The merchant account, issuer, tax policy, notification address, sender domain and executable purchase terms need owner approval before activation. `LICENSE.COMMERCIAL` remains the public commercial overview; the placeholder terms page is not an accepted contract.

1. Select the Stripe account and test mode. Create account-owned, active, nonrecurring EUR Prices for Product Family (139900 cents) and Integration (469900 cents), quantity one. The server verifies price currency, amount and account mode. Stripe SDK 23.0.0 pins its default API version to `2026-09-30.endive`; validate this version with the selected account before launch.
2. Approve a complete immutable terms snapshot. Copy `terms.template.json`, set its version, exact plain-text terms, SHA-256 of that UTF-8 text, and `approved: true`. Publish that same text at `SITE_ORIGIN/terms/VERSION.html`; never edit a published accepted version. Provision its JSON as `TERMS_JSON`. Publishing/approving matching content is an operator launch gate, not inferred from a hash alone.
3. Set `ISSUER_JSON` to an approved `{name,address,email}` object, `LICENSED_VERSION` to the licensed release scope, `OWNER_EMAIL`, and `EMAIL_FROM` to an authorized sender. Configure Resend with a verified sender domain. Set `TAX_POLICY` explicitly to `none` or `automatic-exclusive`; the latter requires exclusive Stripe Prices and complete automatic-tax calculation. Inclusive prices and invoices are not implemented. Confirm applicable tax treatment before using either option.
4. Create the D1 database in the intended Cloudflare account, replace the placeholder database ID, and apply `migrations/0001_checkout.sql`. Configure a Worker hostname/routing; workers.dev and previews are disabled. Provision secrets using `wrangler secret put`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TERMS_JSON`, `ISSUER_JSON`, `EMAIL_API_KEY`. Set remaining nonsecret variables in a reviewed environment configuration.
5. Register `/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded` in the same Stripe mode/account. The official SDK verifies the untouched raw body and timestamp. Configure Stripe receipt settings and issuer information. Buyer email contains the charge's Stripe receipt URL; automatic test-mode receipt email is not assumed.
6. In a private test environment set `MODE=test`, `PURCHASES_ENABLED=true`, `DELIVERY_ENABLED=true`, and point the page meta value to the test Worker origin. Test the complete flow using Stripe test cards: hosted Checkout, signed webhook, one D1 license, buyer PDF/receipt, and separate owner notification. Confirm declined payment issues nothing; replay webhook and retry delivery without duplicates; inspect receipt and Unicode PDF.
7. Only after these checks and explicit production approval, use live-mode credentials/Prices/signing secret, `MODE=live`, `LIVE_PURCHASES_ENABLED=true`, and enabled delivery. Review the production frontend origin, terms and issuer again. The live endpoint rejects incomplete configuration. No credentials belong in Git or the browser.

## Fulfillment and operation

The browser controls only tier and acceptance; the server controls prices, quantity, redirects and accepted terms. Checkout attempts use UUIDs and Stripe idempotency keys. Recorded sessions are retrieved instead of creating another session; paid/quarantined orders reject retries. Unresolved attempts stop before Stripe's 24-hour idempotency window expires and require reconciliation. New attempts are limited to ten requests per minute per hashed Cloudflare client IP; this is a basic expense guard, not a fraud system.

Paid-session retrieval checks the exact line item, quantity, mode, subtotal, tax, payment intent and receipt. A D1 transaction records the immutable license, separate buyer/owner jobs and webhook event. Unique constraints make concurrent webhook delivery safe. A success-page visit does not issue a license.

Cron claims jobs using fresh two-minute leases. Failed buyer delivery does not block the owner's independent job. Resend idempotency keys are stable job IDs; retries use byte-identical PDFs and snapshotted recipients/terms. Transient failure uses exponential retry; eight attempts, unsupported font characters or an ambiguous send older than 23 hours stop for manual review. No claim of exactly-once external email delivery is made after the provider's deduplication window.

The bundled licensed DejaVu font covers Latin, Greek and Cyrillic. Holder/contact names and merchant certificate configuration are checked before checkout opens. If Stripe's separate billing name uses an unsupported script, the certificate refers to the original payment receipt for that payer name; the unchanged name remains in the payment record. Legacy unrenderable holder records require manual review. A software license certificate is not IO-Link certification. PDF creation/modification dates are fixed to the stored issuance time.

Monitor `delivery_jobs` for `failed`/expired leases and `orders` for `quarantined` or unresolved sessions. Restrict Cloudflare database access, enable appropriate backups, and agree a personal-data retention policy. For ambiguous sends, inspect the provider record using `provider_id`/job idempotency key and Stripe session/payment IDs before manually requeueing. Do not blindly reset old jobs: that can send duplicate email. Never create a second chargeable session merely to fix delivery.

Rollback: set `PURCHASES_ENABLED=false` and blank the site's API meta value. Keep existing webhooks and cron/delivery operating while reconciling already-paid orders. Disabling new purchases does not invalidate or replace stored licenses. Set `DELIVERY_ENABLED=false` only when intentionally pausing the outbox.

## Primary references

- [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment) and [raw webhook verification/retries](https://docs.stripe.com/webhooks)
- [Stripe receipts](https://docs.stripe.com/receipts) and [official SDK](https://github.com/stripe/stripe-node)
- [Cloudflare D1 transactional batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Resend email API and attachments](https://resend.com/docs/api-reference/emails/send-email) and [24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys)

## Business holders and package records (v3)

Both packages require a legal company or a sole trader acting for their business,
with a named technical contact. Requests use holder kind "company" or "sole-trader".
Product Family is EUR1,399 with two onboarding hours; Integration is EUR4,699
with eight total scoped hours. Both grant the same one-family rights, usable source,
documentation and reference release, with unlimited authorized employees and
contractors working on that family. New snapshots do not record developer seats.
Legacy individual and five-seat snapshots retain their original accepted terms.

Integration includes setup/build configuration review, MCU/PHY callback and wiring
review, a written integration checklist and findings/report from the agreed build/
test review. Quarterly reviews during the included first year count within the eight
total hours. Agree target, compiler, PHY and tasks before booking.

## Approved quote provenance

Apply migration 0003 after migrations 0001/0002. Existing approved quotes retain
product-family-v2 provenance; only explicitly approved business-family-v3 quotes
bound to holder, contact, tier and family can create new orders. New checkout requires
terms scopeModel=business-family-v3. The internal SKU keys single/team and configured
Stripe Price IDs are retained; their public labels are Product Family/Integration.

One quote creates one order; accepted scope is frozen in the order/certificate/owner
record and Stripe metadata. Expiry/revocation blocks new checkout creation/recovery
but does not cancel existing Stripe sessions, change accepted payments or revoke
historical licenses. There is no public approval endpoint.

Holder, contact and family names use the certificate font's Unicode coverage before
order creation. Supported Latin/Cyrillic are retained. Unsupported names require a
privately handled quote.

The current terms template uses 2026-10-01-business-family-v3 with approved=false.
The v1 and v2 JSON/HTML archives are unchanged. Purchases, live purchases and delivery
remain disabled until actual merchant account/payment/certificate/receipt/owner
notification verification is complete. Fixture tests mock payment and email.
