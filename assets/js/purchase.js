/* The page starts closed. Only a fully configured backend can offer checkout. */
(() => {
  const form = document.querySelector('#purchase-form');
  if (!form) return;
  const button = document.querySelector('#purchase-button');
  const accepted = document.querySelector('#accept-terms');
  const status = document.querySelector('#purchase-status');
  const termsLink = document.querySelector('#purchase-terms');
  const endpoint = document.querySelector('meta[name="checkout-api"]')?.content;
  let catalog, busy = false, attempt;
  const holderName = document.querySelector('#holder-name');
  const family = document.querySelector('#product-family');
  const quote = document.querySelector('#quote-reference');
  const contact = document.querySelector('#company-contact');
  const holderLabel = document.querySelector('#holder-label');
  const companyFields = document.querySelector('#company-fields');
  const tier = () => form.querySelector('input[name="tier"]:checked').value;
  const updateHolder = () => {
    const company = tier() === 'team';
    holderLabel.textContent = company ? 'Legal company name (license holder)' : 'Full name of the independent individual license holder';
    companyFields.hidden = !company; contact.required = company;
    attempt = undefined;
  };
  [holderName, contact, family, quote].forEach(input => input.addEventListener('input', () => { attempt = undefined; }));
  const update = () => { button.disabled = busy || !catalog || !accepted.checked; };
  accepted.addEventListener('change', update);
  form.querySelectorAll('input[name="tier"]').forEach(input => input.addEventListener('change', updateHolder));
  updateHolder();
  const unavailable = 'Online checkout is not available yet. Contact us for a quote and the applicable purchase terms.';
  async function initialize() {
    if (!endpoint) return;
    try {
      const api = new URL(endpoint);
      if (api.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(api.hostname)) return;
      const response = await fetch(new URL('/catalog', api), {signal: AbortSignal.timeout(10000)});
      const data = await response.json();
      const terms = new URL(data.terms?.url);
      if (!response.ok || data.available !== true || !['test','live'].includes(data.mode) || terms.origin !== location.origin || !terms.pathname.startsWith('/terms/')) return;
      catalog = data;
      termsLink.href = terms.href;
      termsLink.textContent = `Purchase terms (${catalog.terms.version})`;
      accepted.disabled = false;
      button.hidden = false;
      status.textContent = catalog.mode === 'test' ? 'Test mode: this checkout uses Stripe test payments.' : 'Your certificate and payment receipt will be delivered by email after payment confirmation.';
      button.textContent = catalog.mode === 'test' ? 'Start test checkout' : 'Continue to Stripe';
      document.querySelector('#tax-status').textContent = catalog.taxPolicy === 'automatic-exclusive' ? 'Prices shown exclude applicable tax. Stripe calculates tax in Checkout.' : 'The price shown is the checkout total under the configured merchant tax policy.';
      update();
    } catch { status.textContent = unavailable; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !catalog || !accepted.checked || !form.reportValidity()) return;
    busy = true; update(); status.textContent = 'Opening secure Stripe Checkout…';
    attempt ??= crypto.randomUUID();
    try {
      const response = await fetch(new URL('/checkout', endpoint), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier:tier(),productFamily:family.value.trim(),quoteReference:quote.value.trim(),holder:tier()==='single'?{kind:'individual',name:holderName.value.trim()}:{kind:'company',name:holderName.value.trim(),contact:contact.value.trim()},attemptId:attempt,acceptTerms:true,termsVersion:catalog.terms.version,termsHash:catalog.terms.sha256}),signal:AbortSignal.timeout(20000)});
      const data = await response.json();
      if (!response.ok && [400, 409, 429].includes(response.status) && typeof data.error === 'string') {
        status.textContent = data.error;
        return;
      }
      const url = new URL(data.url ?? '');
      if (!response.ok || url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw Error('unavailable');
      window.iolinkiAnalytics?.track("begin_checkout", { tier: tier() });
      location.assign(url.href);
    } catch { status.textContent = 'Checkout did not open. Retry this attempt, or contact us before paying again if Stripe already confirmed a payment.'; }
    finally { busy = false; update(); }
  });
  initialize();
})();
