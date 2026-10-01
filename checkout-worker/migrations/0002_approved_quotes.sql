-- Quotes are entered through the merchant's private operations process.
-- There is no public quote-approval endpoint.
CREATE TABLE approved_quotes (
  id TEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('single','team')),
  holder TEXT NOT NULL,
  family_name TEXT NOT NULL,
  family_scope TEXT NOT NULL,
  approved_at INTEGER NOT NULL CHECK (approved_at > 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > approved_at),
  revoked_at INTEGER
);
ALTER TABLE orders ADD COLUMN quote_id TEXT;
CREATE UNIQUE INDEX one_order_per_quote ON orders(quote_id) WHERE quote_id IS NOT NULL;
