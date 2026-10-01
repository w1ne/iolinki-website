CREATE TABLE orders (
 id TEXT PRIMARY KEY, tier TEXT NOT NULL CHECK(tier IN ('single','team')),
 session_id TEXT UNIQUE, checkout_url TEXT, snapshot TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, payment TEXT
);
CREATE TABLE licenses (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
 session_id TEXT NOT NULL UNIQUE, snapshot TEXT NOT NULL, payment TEXT NOT NULL,
 issued_at INTEGER NOT NULL
);
CREATE TABLE webhook_events (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL, processed_at INTEGER NOT NULL
);
CREATE TABLE delivery_jobs (
 id TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES licenses(id),
 role TEXT NOT NULL CHECK(role IN ('buyer','owner')), recipient TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL,
 lease_token TEXT, lease_until INTEGER, first_attempt INTEGER,
 provider_id TEXT, last_error TEXT,
 UNIQUE(license_id, role)
);
CREATE INDEX delivery_due ON delivery_jobs(state, next_attempt, lease_until);

CREATE TABLE purchase_limits (key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE INDEX purchase_limit_expiry ON purchase_limits(bucket);
