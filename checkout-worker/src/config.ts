import type { Config, Env, Issuer, Terms } from './types';
import { supportsCertificateText } from './certificate-font';
export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
export function email(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}
export async function config(env: Env): Promise<Config> {
  if (env.PURCHASES_ENABLED !== 'true' || !['test', 'live'].includes(env.MODE ?? '')) throw Error('inactive');
  const livemode = env.MODE === 'live';
  if (livemode && (env.LIVE_PURCHASES_ENABLED !== 'true' || env.DELIVERY_ENABLED !== 'true')) throw Error('live inactive');
  if (!env.STRIPE_SECRET_KEY?.startsWith(livemode ? 'sk_live_' : 'sk_test_') || !env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) throw Error('Stripe configuration');
  const origin = new URL(env.SITE_ORIGIN ?? '').origin;
  if (livemode && !origin.startsWith('https://')) throw Error('HTTPS required');
  const terms = JSON.parse(env.TERMS_JSON ?? '{}') as Terms;
  if (terms.scopeModel !== 'indie-company-v4' || terms.approved !== true || !/^[a-zA-Z0-9._-]{1,80}$/.test(terms.version ?? '') ||
      typeof terms.text !== 'string' || !terms.text.trim() || terms.text.length > 30000 ||
      terms.sha256 !== await sha256(terms.text) ||
      terms.url !== `${origin}/terms/${terms.version}.html`) throw Error('unapproved terms');
  const issuer = JSON.parse(env.ISSUER_JSON ?? '{}') as Issuer;
  if (!issuer.name?.trim() || !issuer.address?.trim() || !email(issuer.email) || issuer.name.length > 300 || issuer.address.length > 1000) throw Error('issuer required');
  if (!env.SINGLE_PRICE_ID?.startsWith('price_') || !env.TEAM_PRICE_ID?.startsWith('price_') || env.SINGLE_PRICE_ID === env.TEAM_PRICE_ID) throw Error('prices required');
  if (!['none','automatic-exclusive'].includes(env.TAX_POLICY ?? '')) throw Error('tax policy required');
  if (!env.LICENSED_VERSION?.trim() || env.LICENSED_VERSION.length > 200 || !email(env.OWNER_EMAIL) || !env.EMAIL_FROM || /[\r\n]/.test(env.EMAIL_FROM) || !env.EMAIL_API_KEY) throw Error('delivery configuration');
  if ([terms.text, issuer.name, issuer.address, issuer.email, env.LICENSED_VERSION].some(text => !supportsCertificateText(text))) throw Error('certificate font configuration');
  return { origin, livemode, terms, issuer, taxPolicy: env.TAX_POLICY as Config['taxPolicy'], licensedVersion: env.LICENSED_VERSION,
    ownerEmail: env.OWNER_EMAIL, emailFrom: env.EMAIL_FROM, prices: {single:env.SINGLE_PRICE_ID,team:env.TEAM_PRICE_ID} };
}
