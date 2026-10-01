export interface Env {
  DB: D1Database;
  PURCHASES_ENABLED?: string; LIVE_PURCHASES_ENABLED?: string; DELIVERY_ENABLED?: string;
  MODE?: string; SITE_ORIGIN?: string; STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string;
  SINGLE_PRICE_ID?: string; TEAM_PRICE_ID?: string; TERMS_JSON?: string; ISSUER_JSON?: string;
  TAX_POLICY?: string; LICENSED_VERSION?: string; OWNER_EMAIL?: string; EMAIL_FROM?: string; EMAIL_API_KEY?: string;
}
export type Tier = 'single' | 'team';
export interface Terms { approved: true; version: string; sha256: string; text: string; url: string }
export interface Issuer { name: string; address: string; email: string }
export interface Config {
  origin: string; livemode: boolean; terms: Terms; issuer: Issuer;
  taxPolicy: 'none' | 'automatic-exclusive'; licensedVersion: string; ownerEmail: string; emailFrom: string;
  prices: Record<Tier, string>;
}
export interface Snapshot {
  tier: Tier; label: string; seats: number; amount: number; currency: 'eur'; priceId: string;
  livemode: boolean; terms: Terms; issuer: Issuer; taxPolicy: Config['taxPolicy'];
  licensedVersion: string; ownerEmail: string; emailFrom: string; acceptedAt: number;
}
export interface Order { id: string; tier: Tier; session_id: string | null; checkout_url: string | null; snapshot: string; state: string; created_at: number }
export interface Payment { sessionId: string; intentId: string; subtotal: number; tax: number; total: number; currency: string; buyerEmail: string; buyerName: string; receiptUrl: string }
export interface License { id: string; order_id: string; snapshot: string; payment: string; issued_at: number }
export interface Job { id: string; license_id: string; role: 'buyer' | 'owner'; recipient: string; attempts: number; first_attempt: number; lease_token: string }
export const TIERS = {
  single: { label: 'Single Developer', seats: 1, amount: 139900 },
  team: { label: 'Team', seats: 5, amount: 469900 },
} as const;
