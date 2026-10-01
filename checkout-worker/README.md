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

1. Select the Stripe account and test mode. Create account-owned, active, nonrecurring EUR Prices for Single Developer (139900 cents) and Team (469900 cents), quantity one. The server verifies price currency, amount and account mode. Stripe SDK 23.0.0 pins its default API version to `2026-09-30.endive`; validate this version with the selected account before launch.
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

## Holder and accepted package record

Single checkout requires holder kind "individual" and full name. Team requires
holder kind "company", legal company name and contact person. The payer's Stripe
billing identity does not replace the license holder. Each order snapshots the
normalized holder, accepted terms text/version/hash, licensed release and total
assistance allowance (Single two onboarding hours; Team eight integration hours).
A different holder requires a new attempt. Certificates use this snapshot.

terms.template.json contains prepared offering text and its version/hash;
approved remains false. Purchases, live purchases and delivery remain disabled.
Do not enable them before configured account and actual test-mode payment, buyer
certificate/receipt and owner notification checks pass. Fixture tests do not prove
that real account flow. Physical-master and complete analog Twins validation
remain separate evidence.

Holder and company contact names are checked against the same Unicode font glyph
coverage used by the PDF before an order or Stripe session is created. Supported
Latin and Cyrillic names are retained; names outside that font coverage require
a separately handled quote rather than a payable order that cannot be rendered.

## Product-family quotes (v2)

Apply migration 0002 before configuring a future checkout. Approved quotes are
entered through private merchant operations; there is no public approval endpoint.
Each approved record binds the holder, tier, named commercial range and description
to a unique quote reference, approval time and expiry; revoked records block new
checkout. Buyer requests must contain both the quote reference and matching family
name. The certificate range comes only from the approved record.

One quote can create one order. Same-attempt retries reuse its frozen snapshot; a
changed quote or scope requires merchant review and a new quote. Expiry/revocation
blocks checkout creation/recovery but does not cancel already-created Stripe
sessions or retroactively change accepted payments or issued rights. Family scope
is frozen in the order/certificate/owner notification, with quote reference recorded
in Stripe metadata. Legacy accepted snapshots deliver with their original scope.

The current template uses 2026-10-01-product-family-v2, approved=false.
New checkout requires terms scopeModel=product-family-v2; old terms cannot open
a new restricted-family purchase. Historical delivery uses accepted snapshots. Previous
version text is archived unchanged under terms/2026-10-01-offering-v1.json and
the previous public terms HTML remains unchanged. Checkout activation and actual
account/payment/delivery verification remain separate required work.
