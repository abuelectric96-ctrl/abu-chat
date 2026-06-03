/**
 * Token boshqaruv endpointlari
 * POST /api/auth/meta/ig-accounts/:id/refresh-token — manual yangilash
 */

const express = require('express');
const router  = express.Router();
const { authRequired } = require('../middleware/authRequired');
const { refreshById }  = require('../lib/tokenRefresh');
const db = require('../db');

// Manual token yangilash (dashboard tugmasi)
router.post('/ig-accounts/:id/refresh-token', authRequired, async (req, res) => {
  const igAccountId = parseInt(req.params.id);

  // Akkaunt foydalanuvchiga tegishliligini tekshirish
  const { rows } = await db.query(
    `SELECT id FROM ig_accounts WHERE id = $1 AND client_id = $2`,
    [igAccountId, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not_found' });

  try {
    await refreshById(igAccountId);
    res.json({ ok: true, message: 'Token muvaffaqiyatli yangilandi' });
  } catch (e) {
    console.error('[tokenAdmin] refresh error', e.message);
    res.status(500).json({ error: 'refresh_failed', detail: e.message });
  }
});

module.exports = router;
