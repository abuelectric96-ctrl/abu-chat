/**
 * To'lov integratsiyasi: Click va Payme
 * Click: SHOP API (Prepare + Complete)
 * Payme: JSON-RPC 2.0
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const authRequired = require('../middleware/authRequired');

// ─── Rejalar ────────────────────────────────────────────────────────────────
const PLANS = {
  starter:  { name: 'Boshlovchi', price_uzs: 49000,  replies: 2000,  ig_accounts: 1 },
  business: { name: 'Biznes',     price_uzs: 119000, replies: 15000, ig_accounts: 3 },
  pro:      { name: 'Pro',        price_uzs: 299000, replies: null,  ig_accounts: 5 },
};

// ─── Yordamchi: buyurtma yaratish ────────────────────────────────────────────
async function createOrder(clientId, plan) {
  const p = PLANS[plan];
  if (!p) throw new Error('invalid_plan');
  const res = await db.query(
    `INSERT INTO payment_orders (client_id, plan, amount_uzs, status)
     VALUES ($1, $2, $3, 'pending') RETURNING id`,
    [clientId, plan, p.price_uzs]
  );
  return res.rows[0].id;
}

// ─── Yordamchi: obunani faollashtirish ───────────────────────────────────────
async function activateSubscription(orderId) {
  const { rows } = await db.query(
    `SELECT client_id, plan FROM payment_orders WHERE id = $1 AND status = 'pending'`,
    [orderId]
  );
  if (!rows.length) return;
  const { client_id, plan } = rows[0];
  const p = PLANS[plan];

  await db.query('BEGIN');
  try {
    await db.query(
      `UPDATE payment_orders SET status = 'paid', paid_at = NOW() WHERE id = $1`,
      [orderId]
    );
    await db.query(
      `UPDATE clients SET plan = $1 WHERE id = $2`,
      [plan, client_id]
    );
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CLICK integratsiyasi
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/payment/click/redirect?plan=starter
 * Foydalanuvchini Click to'lov sahifasiga yo'naltiradi
 */
router.get('/click/redirect', authRequired, async (req, res) => {
  try {
    const { plan } = req.query;
    if (!PLANS[plan]) return res.status(400).json({ error: 'invalid_plan' });

    const orderId = await createOrder(req.user.id, plan);
    const amount  = PLANS[plan].price_uzs * 100; // tiyin

    const serviceId  = process.env.CLICK_SERVICE_ID;
    const merchantId = process.env.CLICK_MERCHANT_ID;
    const returnUrl  = `${process.env.BASE_URL}/payment.html?status=success`;

    const url =
      `https://my.click.uz/services/pay?service_id=${serviceId}` +
      `&merchant_id=${merchantId}` +
      `&amount=${amount}` +
      `&transaction_param=${orderId}` +
      `&return_url=${encodeURIComponent(returnUrl)}`;

    res.json({ redirect_url: url, order_id: orderId });
  } catch (e) {
    console.error('click redirect error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /api/payment/click/prepare
 * Click bu endpointni to'lov boshlanishida chaqiradi
 */
router.post('/click/prepare', async (req, res) => {
  const {
    click_trans_id, service_id, click_paydoc_id,
    merchant_trans_id, amount, action, sign_time, sign_string,
  } = req.body;

  // Imzo tekshirish
  const expectedSign = crypto
    .createHash('md5')
    .update(
      `${click_trans_id}${service_id}${process.env.CLICK_SECRET_KEY}` +
      `${merchant_trans_id}${amount}${action}${sign_time}`
    )
    .digest('hex');

  if (expectedSign !== sign_string) {
    return res.json({ error: -1, error_note: 'SIGN CHECK FAILED' });
  }

  // Buyurtma mavjudligini tekshirish
  const { rows } = await db.query(
    `SELECT id, amount_uzs, status FROM payment_orders WHERE id = $1`,
    [merchant_trans_id]
  );

  if (!rows.length) {
    return res.json({ error: -5, error_note: 'Order not found' });
  }

  const order = rows[0];

  if (order.status === 'paid') {
    return res.json({ error: -4, error_note: 'Already paid' });
  }

  const expectedAmount = order.amount_uzs * 100; // tiyin
  if (Math.abs(parseFloat(amount) - expectedAmount) > 1) {
    return res.json({ error: -2, error_note: 'Incorrect amount' });
  }

  // Click trans_id ni saqlash
  await db.query(
    `UPDATE payment_orders SET click_trans_id = $1 WHERE id = $2`,
    [click_trans_id, merchant_trans_id]
  );

  res.json({
    click_trans_id,
    merchant_trans_id: String(merchant_trans_id),
    error: 0,
    error_note: 'Success',
  });
});

/**
 * POST /api/payment/click/complete
 * Click to'lov tasdiqlanganda chaqiradi
 */
router.post('/click/complete', async (req, res) => {
  const {
    click_trans_id, service_id, click_paydoc_id,
    merchant_trans_id, merchant_prepare_id, amount,
    action, error: clickError, sign_time, sign_string,
  } = req.body;

  // Imzo tekshirish
  const expectedSign = crypto
    .createHash('md5')
    .update(
      `${click_trans_id}${service_id}${process.env.CLICK_SECRET_KEY}` +
      `${merchant_trans_id}${merchant_prepare_id}${amount}${action}${sign_time}`
    )
    .digest('hex');

  if (expectedSign !== sign_string) {
    return res.json({ error: -1, error_note: 'SIGN CHECK FAILED' });
  }

  if (parseInt(clickError) < 0) {
    await db.query(
      `UPDATE payment_orders SET status = 'cancelled' WHERE id = $1`,
      [merchant_trans_id]
    );
    return res.json({ error: 0, error_note: 'Cancelled' });
  }

  try {
    await activateSubscription(parseInt(merchant_trans_id));
    res.json({
      click_trans_id,
      merchant_trans_id: String(merchant_trans_id),
      error: 0,
      error_note: 'Success',
    });
  } catch (e) {
    console.error('click complete error', e);
    res.json({ error: -9, error_note: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PAYME integratsiyasi
// ═══════════════════════════════════════════════════════════════════════════

// Payme transaction holatlari
const PAYME_STATE = { CREATED: 1, COMPLETED: 2, CANCELLED: -1, CANCELLED_AFTER: -2 };

function paymeError(id, code, message, data = null) {
  return {
    jsonrpc: '2.0', id,
    error: { code, message: { ru: message, uz: message, en: message }, data },
  };
}

function paymeResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * POST /api/payment/payme
 * Payme barcha so'rovlarni shu endpointga yuboradi (JSON-RPC 2.0)
 */
router.post('/payme', async (req, res) => {
  // Basic Auth tekshirish
  const authHeader = req.headers.authorization || '';
  const base64 = authHeader.replace('Basic ', '');
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  const [, password] = decoded.split(':');

  if (password !== process.env.PAYME_KEY) {
    return res.status(401).json(paymeError(null, -32504, 'Insufficient privilege'));
  }

  const { method, params, id } = req.body;

  try {
    switch (method) {

      // ── To'lovni amalga oshirish mumkinligini tekshirish ──────────────────
      case 'CheckPerformTransaction': {
        const orderId = params.account?.order_id;
        if (!orderId) return res.json(paymeError(id, -31050, 'Order not found'));

        const { rows } = await db.query(
          `SELECT id, amount_uzs, status FROM payment_orders WHERE id = $1`,
          [orderId]
        );

        if (!rows.length) return res.json(paymeError(id, -31050, 'Order not found'));
        if (rows[0].status === 'paid') return res.json(paymeError(id, -31051, 'Already paid'));

        const expected = rows[0].amount_uzs * 100; // tiyin
        if (params.amount !== expected) {
          return res.json(paymeError(id, -31001, 'Incorrect amount'));
        }

        return res.json(paymeResult(id, { allow: true }));
      }

      // ── Tranzaksiya yaratish ──────────────────────────────────────────────
      case 'CreateTransaction': {
        const orderId = params.account?.order_id;
        const paymeId = params.id;
        const now     = Date.now();

        // Mavjud tranzaksiyani tekshirish
        const existing = await db.query(
          `SELECT * FROM payme_transactions WHERE payme_id = $1`,
          [paymeId]
        );

        if (existing.rows.length) {
          const t = existing.rows[0];
          if (t.state !== PAYME_STATE.CREATED) {
            return res.json(paymeError(id, -31008, 'Transaction not allowed'));
          }
          return res.json(paymeResult(id, {
            create_time: Number(t.create_time),
            transaction: String(t.id),
            state: t.state,
          }));
        }

        // Buyurtmani tekshirish
        const { rows } = await db.query(
          `SELECT id, amount_uzs, status FROM payment_orders WHERE id = $1`,
          [orderId]
        );
        if (!rows.length) return res.json(paymeError(id, -31050, 'Order not found'));
        if (rows[0].status === 'paid') return res.json(paymeError(id, -31051, 'Already paid'));

        const ins = await db.query(
          `INSERT INTO payme_transactions (payme_id, order_id, amount, state, create_time)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [paymeId, orderId, params.amount, PAYME_STATE.CREATED, now]
        );

        return res.json(paymeResult(id, {
          create_time: now,
          transaction: String(ins.rows[0].id),
          state: PAYME_STATE.CREATED,
        }));
      }

      // ── To'lovni tasdiqlash ───────────────────────────────────────────────
      case 'PerformTransaction': {
        const { rows } = await db.query(
          `SELECT * FROM payme_transactions WHERE payme_id = $1`,
          [params.id]
        );

        if (!rows.length) return res.json(paymeError(id, -31003, 'Transaction not found'));
        const t = rows[0];

        if (t.state === PAYME_STATE.COMPLETED) {
          return res.json(paymeResult(id, {
            transaction: String(t.id),
            perform_time: Number(t.perform_time),
            state: PAYME_STATE.COMPLETED,
          }));
        }

        if (t.state !== PAYME_STATE.CREATED) {
          return res.json(paymeError(id, -31008, 'Transaction not allowed'));
        }

        const performTime = Date.now();
        await db.query(
          `UPDATE payme_transactions SET state = $1, perform_time = $2 WHERE id = $3`,
          [PAYME_STATE.COMPLETED, performTime, t.id]
        );

        await activateSubscription(t.order_id);

        return res.json(paymeResult(id, {
          transaction: String(t.id),
          perform_time: performTime,
          state: PAYME_STATE.COMPLETED,
        }));
      }

      // ── Tranzaksiyani bekor qilish ────────────────────────────────────────
      case 'CancelTransaction': {
        const { rows } = await db.query(
          `SELECT * FROM payme_transactions WHERE payme_id = $1`,
          [params.id]
        );

        if (!rows.length) return res.json(paymeError(id, -31003, 'Transaction not found'));
        const t = rows[0];

        const cancelTime = Date.now();
        const newState = t.state === PAYME_STATE.COMPLETED
          ? PAYME_STATE.CANCELLED_AFTER
          : PAYME_STATE.CANCELLED;

        await db.query(
          `UPDATE payme_transactions SET state = $1, cancel_time = $2, reason = $3 WHERE id = $4`,
          [newState, cancelTime, params.reason, t.id]
        );

        if (newState === PAYME_STATE.CANCELLED) {
          await db.query(
            `UPDATE payment_orders SET status = 'cancelled' WHERE id = $1`,
            [t.order_id]
          );
        }

        return res.json(paymeResult(id, {
          transaction: String(t.id),
          cancel_time: cancelTime,
          state: newState,
        }));
      }

      // ── Tranzaksiya holatini tekshirish ───────────────────────────────────
      case 'CheckTransaction': {
        const { rows } = await db.query(
          `SELECT * FROM payme_transactions WHERE payme_id = $1`,
          [params.id]
        );

        if (!rows.length) return res.json(paymeError(id, -31003, 'Transaction not found'));
        const t = rows[0];

        return res.json(paymeResult(id, {
          create_time:  Number(t.create_time),
          perform_time: t.perform_time ? Number(t.perform_time) : 0,
          cancel_time:  t.cancel_time  ? Number(t.cancel_time)  : 0,
          transaction:  String(t.id),
          state:        t.state,
          reason:       t.reason || null,
        }));
      }

      // ── Tranzaksiyalar ro'yxati ───────────────────────────────────────────
      case 'GetStatement': {
        const { rows } = await db.query(
          `SELECT pt.*, po.plan FROM payme_transactions pt
           JOIN payment_orders po ON po.id = pt.order_id
           WHERE pt.create_time BETWEEN $1 AND $2`,
          [params.from, params.to]
        );

        return res.json(paymeResult(id, {
          transactions: rows.map(t => ({
            id:           t.payme_id,
            time:         Number(t.create_time),
            amount:       t.amount,
            account:      { order_id: t.order_id },
            create_time:  Number(t.create_time),
            perform_time: t.perform_time ? Number(t.perform_time) : 0,
            cancel_time:  t.cancel_time  ? Number(t.cancel_time)  : 0,
            transaction:  String(t.id),
            state:        t.state,
            reason:       t.reason || null,
          })),
        }));
      }

      default:
        return res.json(paymeError(id, -32601, 'Method not found'));
    }
  } catch (e) {
    console.error('payme error', e);
    return res.json(paymeError(id, -31008, 'Server error'));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Umumiy endpointlar
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/payment/payme/redirect?plan=starter
 * Foydalanuvchini Payme to'lov sahifasiga yo'naltiradi
 */
router.get('/payme/redirect', authRequired, async (req, res) => {
  try {
    const { plan } = req.query;
    if (!PLANS[plan]) return res.status(400).json({ error: 'invalid_plan' });

    const orderId = await createOrder(req.user.id, plan);
    const amount  = PLANS[plan].price_uzs * 100; // tiyin

    const merchantId = process.env.PAYME_MERCHANT_ID;
    const account    = Buffer.from(JSON.stringify({ order_id: orderId })).toString('base64');

    const url = `https://checkout.paycom.uz/${merchantId}?amount=${amount}&account=${account}`;
    res.json({ redirect_url: url, order_id: orderId });
  } catch (e) {
    console.error('payme redirect error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * GET /api/payment/status/:orderId
 * Frontend to'lov holatini so'raydi
 */
router.get('/status/:orderId', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, plan, status, amount_uzs, created_at, paid_at
     FROM payment_orders WHERE id = $1 AND client_id = $2`,
    [req.params.orderId, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

/**
 * GET /api/payment/subscription
 * Joriy foydalanuvchi obuna ma'lumoti
 */
router.get('/subscription', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.plan,
            po.amount_uzs, po.paid_at,
            um.replies_sent,
            CASE c.plan
              WHEN 'starter'  THEN 2000
              WHEN 'business' THEN 15000
              WHEN 'pro'      THEN NULL
              ELSE 50
            END AS replies_limit
     FROM clients c
     LEFT JOIN payment_orders po ON po.client_id = c.id AND po.status = 'paid'
     LEFT JOIN usage_monthly um  ON um.client_id = c.id
       AND um.month = TO_CHAR(NOW(), 'YYYYMM')
     WHERE c.id = $1
     ORDER BY po.paid_at DESC NULLS LAST
     LIMIT 1`,
    [req.user.id]
  );
  res.json(rows[0] || { plan: 'free', replies_sent: 0, replies_limit: 50 });
});

module.exports = router;
