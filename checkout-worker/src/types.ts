export interface Env {
  DB: D1Database;
  PURCHASES_ENABLED?: string; LIVE_PURCHASES_ENABLED?: string; DELIVERY_ENABLED?: string;
  MODE?: string; SITE_ORIGIN?: string; STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string;
  SINGLE_PRICE_ID?: string; TEAM_PRICE_ID?: string; TERMS_JSON?: string; ISSUER_JSON?: string;
  TAX_POLICY?: string; LICENSED_VERSION?: string; OWNER_EMAIL?: string; EMAIL_FROM?: string; EMAIL_API_KEY?: string;
}
export type Tier = 'single' | 'team';
export interface Terms { scopeModel?: 'product-family-v2' | 'business-family-v3'; approved: true; version: string; sha256: string; text: string; url: string }
export interface Issuer { name: string; address: string; email: string }
export interface Config {
  origin: string; livemode: boolean; terms: Terms; issuer: Issuer;
  taxPolicy: 'none' | 'automatic-exclusive'; licensedVersion: string; ownerEmail: string; emailFrom: string;
  prices: Record<Tier, string>;
}
export type Holder = { kind: 'individual'; name: string } | { kind: 'company' | 'sole-trader'; name: string; contact: string };
export interface Assistance { hours: number; kind: 'onboarding' | 'integration'; scope: string }
export interface ApprovedQuote { id: string; tier: Tier; holder: string; family_name: string; family_scope: string; approved_at: number; expires_at: number; revoked_at: number | null; scope_model: 'product-family-v2' | 'business-family-v3' }
export interface ProductFamily { name: string; scope: string }
export interface Snapshot {
  scopeModel?: 'product-family-v2' | 'business-family-v3'; productFamily?: ProductFamily; quoteReference?: string;
  holder: Holder; assistance: Assistance;
  tier: Tier; label: string; seats?: number; amount: number; currency: 'eur'; priceId: string;
  livemode: boolean; terms: Terms; issuer: Issuer; taxPolicy: Config['taxPolicy'];
  licensedVersion: string; ownerEmail: string; emailFrom: string; acceptedAt: number;
}
export interface Order { id: string; tier: Tier; session_id: string | null; checkout_url: string | null; snapshot: string; state: string; created_at: number }
export interface Payment { sessionId: string; intentId: string; subtotal: number; tax: number; total: number; currency: string; buyerEmail: string; buyerName: string; receiptUrl: string }
export interface License { id: string; order_id: string; snapshot: string; payment: string; issued_at: number }
export interface Job { id: string; license_id: string; role: 'buyer' | 'owner'; recipient: string; attempts: number; first_attempt: number; lease_token: string }
export const TIERS = {
  single: { label: 'Product Family', amount: 139900, assistance: { hours: 2, kind: 'onboarding', scope: 'Build/setup assistance, MCU/PHY wiring and callback review, and a written bring-up checklist. Larger ports quoted separately.' } },
  team: { label: 'Integration', amount: 469900, assistance: { hours: 8, kind: 'integration', scope: 'Up to eight total scoped integration hours, including quarterly reviews during the included first year. Deliverables within this allowance: setup/build configuration review, MCU/PHY callback and wiring review, written integration checklist and findings/report from the agreed build/test review. Agree target, compiler, PHY and tasks before booking. Larger ports quoted separately.' } },
} as const;
