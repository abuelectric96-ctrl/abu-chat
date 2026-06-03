-- To'lov jadvallari migratsiyasi

-- Buyurtmalar jadvali
CREATE TABLE IF NOT EXISTS payment_orders (
  id           SERIAL PRIMARY KEY,
  client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan         VARCHAR(20) NOT NULL,
  amount_uzs   INTEGER NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, paid, cancelled
  click_trans_id VARCHAR(100),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_client ON payment_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);

-- Payme tranzaksiyalari jadvali
CREATE TABLE IF NOT EXISTS payme_transactions (
  id           SERIAL PRIMARY KEY,
  payme_id     VARCHAR(100) NOT NULL UNIQUE,
  order_id     INTEGER NOT NULL REFERENCES payment_orders(id),
  amount       BIGINT NOT NULL,   -- tiyin
  state        SMALLINT NOT NULL, -- 1=created, 2=completed, -1=cancelled, -2=cancelled_after
  create_time  BIGINT NOT NULL,   -- unix ms
  perform_time BIGINT,
  cancel_time  BIGINT,
  reason       SMALLINT
);

CREATE INDEX IF NOT EXISTS idx_payme_trans_payme_id ON payme_transactions(payme_id);
CREATE INDEX IF NOT EXISTS idx_payme_trans_order    ON payme_transactions(order_id);
