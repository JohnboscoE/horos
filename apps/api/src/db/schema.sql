-- Horos schema. Postgres is the source of truth; unique constraints enforce idempotency.
-- All money is BIGINT minor units (6 decimals). Timestamps are timestamptz.

CREATE TABLE IF NOT EXISTS freelancers (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  main_wallet_id      TEXT,
  main_wallet_address TEXT,
  is_self_test        BOOLEAN NOT NULL DEFAULT FALSE,
  -- Self-declared cash on hand, the forecast's starting balance. Horos doesn't custody the treasury.
  cash_on_hand_minor  BIGINT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One API token per freelancer (hackathon-grade auth; stored hashed).
CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  freelancer_id TEXT NOT NULL REFERENCES freelancers(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id                 TEXT PRIMARY KEY,
  display_name       TEXT NOT NULL,
  org_slug           TEXT NOT NULL UNIQUE,
  -- Private. Deleting it (set NULL) crypto-shreds the onchain clientIdHash linkage.
  salt               TEXT,
  client_id_hash     TEXT UNIQUE,
  claimed_by_address TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_contacts (
  client_id      TEXT NOT NULL REFERENCES clients(id),
  email          TEXT,
  wallet_address TEXT,
  PRIMARY KEY (client_id, email)
);

CREATE TABLE IF NOT EXISTS policies (
  freelancer_id           TEXT PRIMARY KEY REFERENCES freelancers(id),
  min_terms_days          INTEGER NOT NULL,
  max_terms_days          INTEGER NOT NULL,
  max_discount_bps        INTEGER NOT NULL,
  max_deposit_bps         INTEGER NOT NULL,
  late_fee_bps_cap        INTEGER NOT NULL,
  approval_threshold_minor BIGINT NOT NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_needs (
  id            TEXT PRIMARY KEY,
  freelancer_id TEXT NOT NULL REFERENCES freelancers(id),
  due_date      TIMESTAMPTZ NOT NULL,
  amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
  label         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id                 TEXT PRIMARY KEY,
  freelancer_id      TEXT NOT NULL REFERENCES freelancers(id),
  client_id          TEXT NOT NULL REFERENCES clients(id),
  currency           TEXT NOT NULL CHECK (currency IN ('USDC', 'EURC')),
  amount_minor       BIGINT NOT NULL CHECK (amount_minor > 0),
  description        TEXT NOT NULL DEFAULT '',
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date           TIMESTAMPTZ,
  terms_json         JSONB,
  status             TEXT NOT NULL,
  invoice_hash       TEXT UNIQUE,
  deposit_wallet_id  TEXT,
  deposit_address    TEXT UNIQUE,
  pay_token          TEXT NOT NULL UNIQUE, -- unguessable token for the client link
  ack_signature      TEXT,
  ack_signer         TEXT,
  ack_method         TEXT CHECK (ack_method IN ('EIP712', 'EMAIL')),
  ack_at             TIMESTAMPTZ,
  paid_at            TIMESTAMPTZ,
  paid_minor         BIGINT NOT NULL DEFAULT 0,
  outgoing_minor     BIGINT NOT NULL DEFAULT 0, -- refunds/sweeps + gas we sent out of the deposit wallet
  off_platform       BOOLEAN NOT NULL DEFAULT FALSE,
  is_self_test       BOOLEAN NOT NULL DEFAULT FALSE,
  network            TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_freelancer_idx ON invoices(freelancer_id);
CREATE INDEX IF NOT EXISTS invoices_client_idx ON invoices(client_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);

-- log_index = -1 for balance-derived (unattributed) payments. Never NULL: UNIQUE treats NULLs as distinct.
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id),
  tx_hash       TEXT NOT NULL,
  log_index     INTEGER NOT NULL,
  from_address  TEXT,
  amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
  classification TEXT NOT NULL,
  source_chain  TEXT NOT NULL DEFAULT 'ARC',
  block_number  BIGINT,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS refund_intents (
  id                    TEXT PRIMARY KEY,
  invoice_id            TEXT NOT NULL REFERENCES invoices(id),
  decision_id           TEXT,
  amount_minor          BIGINT NOT NULL CHECK (amount_minor > 0),
  suggested_address     TEXT,  -- sender of the excess payment; NOT used until the payer confirms
  to_address            TEXT,  -- set only by payer confirmation
  confirm_token         TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL CHECK (status IN ('AWAITING_PAYER', 'READY', 'SUBMITTED', 'COMPLETED', 'FAILED', 'CANCELLED')),
  idempotency_key       TEXT NOT NULL UNIQUE,
  confirmed_by_payer_at TIMESTAMPTZ,
  circle_tx_id          TEXT,
  tx_hash               TEXT,
  fee_minor             BIGINT,
  last_error            TEXT,
  attempts              INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- An invoice can have several refunds (e.g. a small overpayment, then a duplicate payment).
-- Safety comes from createRefundIntent re-checking, under the invoice row lock, that the sum of
-- non-failed refunds never exceeds the excess actually received; idempotency_key is per decision.
CREATE INDEX IF NOT EXISTS refund_invoice_idx ON refund_intents(invoice_id);

CREATE TABLE IF NOT EXISTS agent_decisions (
  id                  TEXT PRIMARY KEY,
  freelancer_id       TEXT NOT NULL REFERENCES freelancers(id),
  subject_type        TEXT NOT NULL, -- 'invoice' | 'freelancer'
  subject_id          TEXT NOT NULL,
  decision_type       TEXT NOT NULL,
  trigger_key         TEXT NOT NULL UNIQUE, -- dedupes triggers (e.g. collection step per invoice per day)
  input_snapshot      JSONB NOT NULL,
  input_snapshot_hash TEXT NOT NULL,
  proposal_json       JSONB NOT NULL,
  reasoning           TEXT NOT NULL,
  evidence_refs       JSONB NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('MODEL', 'MOCK', 'FALLBACK', 'MANUAL')),
  model               TEXT,
  policy_result       JSONB NOT NULL,
  final_status        TEXT NOT NULL CHECK (final_status IN ('AUTO_APPLIED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POLICY_REJECTED', 'EXECUTED', 'FAILED')),
  decided_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decisions_subject_idx ON agent_decisions(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS decisions_status_idx ON agent_decisions(final_status);

-- Append-only hash chain. seq is dense from 0.
CREATE TABLE IF NOT EXISTS decision_log (
  seq         INTEGER PRIMARY KEY,
  prev_hash   TEXT NOT NULL,
  entry_hash  TEXT NOT NULL UNIQUE,
  body        JSONB NOT NULL,
  signature   TEXT NOT NULL,
  signer      TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_anchors (
  id          TEXT PRIMARY KEY,
  chain_head  TEXT NOT NULL,
  count       INTEGER NOT NULL UNIQUE,
  tx_hash     TEXT,
  status      TEXT NOT NULL CHECK (status IN ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS record_entries (
  invoice_hash    TEXT PRIMARY KEY,
  invoice_id      TEXT UNIQUE REFERENCES invoices(id), -- NULL for imported (unverified) history
  client_id       TEXT NOT NULL REFERENCES clients(id),
  client_id_hash  TEXT NOT NULL,
  freelancer_id   TEXT NOT NULL REFERENCES freelancers(id),
  due_date        TIMESTAMPTZ NOT NULL,
  paid_at         TIMESTAMPTZ,
  amount_band     SMALLINT NOT NULL,
  verified        BOOLEAN NOT NULL DEFAULT TRUE, -- false = imported history, labelled "unverified"
  disputed        BOOLEAN NOT NULL DEFAULT FALSE,
  response_text   TEXT,
  response_signer TEXT,
  ack_tx          TEXT,
  settle_tx       TEXT,
  dispute_tx      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS record_client_idx ON record_entries(client_id);

-- Durable outbox for onchain attester writes (retried with the same key; contract rejects duplicates).
CREATE TABLE IF NOT EXISTS chain_jobs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('RECORD_ACK', 'RECORD_SETTLED', 'RECORD_DISPUTE', 'RESOLVE_DISPUTE', 'ANCHOR')),
  job_key     TEXT NOT NULL UNIQUE,
  payload     JSONB NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED')),
  tx_hash     TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbound messages to clients (reminders, offers, notices). Delivery is out of scope; the
-- client page shows them and they're exported for email.
CREATE TABLE IF NOT EXISTS client_messages (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id),
  decision_id TEXT NOT NULL,
  audience    TEXT NOT NULL CHECK (audience IN ('CLIENT', 'FREELANCER')),
  kind        TEXT NOT NULL,
  body        TEXT NOT NULL,
  params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (decision_id, invoice_id)
);

CREATE TABLE IF NOT EXISTS client_flags (
  freelancer_id TEXT NOT NULL REFERENCES freelancers(id),
  client_id     TEXT NOT NULL REFERENCES clients(id),
  pause_work    BOOLEAN NOT NULL DEFAULT FALSE,
  decision_id   TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (freelancer_id, client_id)
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
