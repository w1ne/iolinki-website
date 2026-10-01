-- Existing quotes retain v2 provenance; merchants explicitly approve new v3 quotes.
ALTER TABLE approved_quotes ADD COLUMN scope_model TEXT NOT NULL DEFAULT 'product-family-v2' CHECK (scope_model IN ('product-family-v2','business-family-v3'));
