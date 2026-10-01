-- Expand provenance without altering any previously approved quote's scope.
CREATE TABLE approved_quotes_v4 (
  id TEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('single','team')),
  holder TEXT NOT NULL,
  family_name TEXT NOT NULL,
  family_scope TEXT NOT NULL,
  approved_at INTEGER NOT NULL CHECK (approved_at > 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > approved_at),
  revoked_at INTEGER,
  scope_model TEXT NOT NULL DEFAULT 'product-family-v2' CHECK (scope_model IN ('product-family-v2','business-family-v3','indie-company-v4'))
);
INSERT INTO approved_quotes_v4 SELECT id,tier,holder,family_name,family_scope,approved_at,expires_at,revoked_at,scope_model FROM approved_quotes;
DROP TABLE approved_quotes;
ALTER TABLE approved_quotes_v4 RENAME TO approved_quotes;
