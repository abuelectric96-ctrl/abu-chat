-- ABU-chat — initial PostgreSQL schema (v0.1)
-- Run with: psql $DATABASE_URL -f server/db/schema.sql

CREATE TABLE IF NOT EXISTS clients (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(180) NOT NULL UNIQUE,
    password_hash VARCHAR(120) NOT NULL,
    full_name     VARCHAR(120),
    phone         VARCHAR(40),
    plan          VARCHAR(30) NOT NULL DEFAULT 'free',
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);

-- A client can connect multiple Instagram accounts
CREATE TABLE IF NOT EXISTS ig_accounts (
    id                SERIAL PRIMARY KEY,
    client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    ig_user_id        VARCHAR(40)  NOT NULL,
    username          VARCHAR(120) NOT NULL,
    page_id           VARCHAR(40)  NOT NULL,
    access_token_enc  TEXT         NOT NULL,           -- encrypted at rest
    token_expires_at  TIMESTAMPTZ,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    connected_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, ig_user_id)
);
CREATE INDEX IF NOT EXISTS idx_ig_accounts_client ON ig_accounts(client_id);

-- Auto-reply rules
CREATE TABLE IF NOT EXISTS rules (
    id              SERIAL PRIMARY KEY,
    ig_account_id   INTEGER NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
    post_id_filter  VARCHAR(80),                       -- NULL = applies to every post
    keyword         VARCHAR(120) NOT NULL,             -- match is case-insensitive substring
    reply_text      TEXT         NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    priority        INTEGER      NOT NULL DEFAULT 0,   -- higher wins
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rules_account ON rules(ig_account_id);
CREATE INDEX IF NOT EXISTS idx_rules_active ON rules(ig_account_id, is_active);

-- Log of replies posted (audit + dedup)
CREATE TABLE IF NOT EXISTS replies (
    id            SERIAL PRIMARY KEY,
    ig_account_id INTEGER NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
    rule_id       INTEGER REFERENCES rules(id) ON DELETE SET NULL,
    post_id       VARCHAR(80),
    comment_id    VARCHAR(80) NOT NULL,
    comment_text  TEXT,
    reply_text    TEXT,
    status        VARCHAR(30) NOT NULL DEFAULT 'queued', -- queued | sent | failed | skipped
    error_message TEXT,
    sent_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ig_account_id, comment_id)                 -- never reply twice to the same comment
);
CREATE INDEX IF NOT EXISTS idx_replies_account_created ON replies(ig_account_id, created_at DESC);

-- Subscriptions / billing (stub for now)
CREATE TABLE IF NOT EXISTS subscriptions (
    id          SERIAL PRIMARY KEY,
    client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    plan        VARCHAR(30) NOT NULL,
    status      VARCHAR(30) NOT NULL,                  -- active | past_due | cancelled
    provider    VARCHAR(20),                           -- click | payme | stripe
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_subs_client ON subscriptions(client_id);

-- Simple per-account monthly counter (enforces plan quotas)
CREATE TABLE IF NOT EXISTS usage_monthly (
    id            SERIAL PRIMARY KEY,
    client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    yyyymm        CHAR(6) NOT NULL,                    -- e.g. '202605'
    replies_sent  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (client_id, yyyymm)
);
