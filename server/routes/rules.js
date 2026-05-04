// CRUD for auto-reply rules and a read-only stats endpoint.
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const authRequired = require('../middleware/authRequired');

const router = express.Router();
router.use(authRequired);

// Helper — guards that the ig_account belongs to the logged-in client.
async function ownsAccount(clientId, igAccountId) {
  const r = await db.query(
    'SELECT 1 FROM ig_accounts WHERE id = $1 AND client_id = $2',
    [igAccountId, clientId]
  );
  return r.rowCount > 0;
}

const ruleSchema = z.object({
  ig_account_id: z.coerce.number().int().positive(),
  keyword: z.string().min(1).max(120),
  reply_text: z.string().min(1).max(2000),
  post_id_filter: z.string().max(80).nullable().optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});

// List my rules
router.get('/', async (req, res) => {
  const r = await db.query(
    `SELECT r.*
       FROM rules r
       JOIN ig_accounts a ON a.id = r.ig_account_id
      WHERE a.client_id = $1
      ORDER BY r.priority DESC, r.id DESC`,
    [req.user.id]
  );
  res.json({ rules: r.rows });
});

// Create
router.post('/', async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const d = parsed.data;
  if (!(await ownsAccount(req.user.id, d.ig_account_id))) return res.status(403).json({ error: 'forbidden' });

  const r = await db.query(
    `INSERT INTO rules (ig_account_id, keyword, reply_text, post_id_filter, is_active, priority)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [d.ig_account_id, d.keyword, d.reply_text, d.post_id_filter || null, d.is_active ?? true, d.priority ?? 0]
  );
  res.status(201).json({ rule: r.rows[0] });
});

// Update
router.put('/:id', async (req, res) => {
  const parsed = ruleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const ruleId = +req.params.id;

  // Verify ownership through join.
  const own = await db.query(
    `SELECT r.id FROM rules r
       JOIN ig_accounts a ON a.id = r.ig_account_id
      WHERE r.id = $1 AND a.client_id = $2`,
    [ruleId, req.user.id]
  );
  if (!own.rowCount) return res.status(404).json({ error: 'not_found' });

  const fields = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k === 'ig_account_id') continue; // not allowed to move rule between accounts
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (!fields.length) return res.json({ ok: true });
  values.push(ruleId);

  const r = await db.query(
    `UPDATE rules SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
    values
  );
  res.json({ rule: r.rows[0] });
});

// Delete
router.delete('/:id', async (req, res) => {
  const r = await db.query(
    `DELETE FROM rules
       WHERE id = $1
         AND ig_account_id IN (SELECT id FROM ig_accounts WHERE client_id = $2)`,
    [req.params.id, req.user.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// Recent reply log (last 100)
router.get('/replies', async (req, res) => {
  const r = await db.query(
    `SELECT r.id, r.comment_text, r.reply_text, r.status, r.error_message, r.sent_at, r.created_at,
            a.username AS ig_username
       FROM replies r
       JOIN ig_accounts a ON a.id = r.ig_account_id
      WHERE a.client_id = $1
      ORDER BY r.created_at DESC
      LIMIT 100`,
    [req.user.id]
  );
  res.json({ replies: r.rows });
});

// Quota / usage for the current month
router.get('/usage', async (req, res) => {
  const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
  const r = await db.query(
    `SELECT yyyymm, replies_sent FROM usage_monthly WHERE client_id = $1 AND yyyymm = $2`,
    [req.user.id, yyyymm]
  );
  res.json({ usage: r.rows[0] || { yyyymm, replies_sent: 0 } });
});

module.exports = router;
