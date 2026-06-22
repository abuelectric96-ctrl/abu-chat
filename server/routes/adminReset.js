// TEMPORARY PASSWORD RESET ROUTE — DELETE AFTER USE
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const RESET_TOKEN = 'abu-reset-2024-secret';

router.get('/admin-reset-passwords', async (req, res) => {
  if (req.query.token !== RESET_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const hash = await bcrypt.hash('Men1996m', 12);
    const emails = ['abuelectric96@gmail.com', 'abuelectric.ukasi@gmail.com'];
    const result = await pool.query(
      'UPDATE clients SET password_hash = $1 WHERE email = ANY($2) RETURNING email',
      [hash, emails]
    );
    res.json({ ok: true, updated: result.rows.map(r => r.email), message: 'Passwords set to Men1996m' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
