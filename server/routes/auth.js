// Auth routes — local email + password.
// Endpoints:
//   POST /api/auth/register  { email, password, full_name? }
//   POST /api/auth/login     { email, password }
//   GET  /api/auth/me        (auth required)
//   POST /api/auth/logout
const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const db = require('../db');
const { sign } = require('../lib/jwt');
const authRequired = require('../middleware/authRequired');

const router = express.Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(120),
  full_name: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }
  const { email, password, full_name, phone } = parsed.data;

  try {
    const exists = await db.query('SELECT 1 FROM clients WHERE email = $1', [email.toLowerCase()]);
    if (exists.rowCount) return res.status(409).json({ error: 'email_taken' });

    const hash = await bcrypt.hash(password, 12);
    const r = await db.query(
      `INSERT INTO clients (email, password_hash, full_name, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, plan, created_at`,
      [email.toLowerCase(), hash, full_name || null, phone || null]
    );
    const client = r.rows[0];
    const token = sign({ sub: client.id, email: client.email });
    setAuthCookie(res, token);
    return res.status(201).json({ client, token });
  } catch (err) {
    console.error('[auth.register]', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { email, password } = parsed.data;

  try {
    const r = await db.query(
      `SELECT id, email, password_hash, full_name, plan, is_active
       FROM clients WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (!r.rowCount) return res.status(401).json({ error: 'invalid_credentials' });
    const c = r.rows[0];
    if (!c.is_active) return res.status(403).json({ error: 'account_disabled' });

    const ok = await bcrypt.compare(password, c.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const token = sign({ sub: c.id, email: c.email });
    setAuthCookie(res, token);
    return res.json({
      client: { id: c.id, email: c.email, full_name: c.full_name, plan: c.plan },
      token,
    });
  } catch (err) {
    console.error('[auth.login]', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.get('/me', authRequired, async (req, res) => {
  const r = await db.query(
    'SELECT id, email, full_name, phone, plan, created_at FROM clients WHERE id = $1',
    [req.user.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
  res.json({ client: r.rows[0] });
});

router.post('/logout', (req, res) => {
  res.clearCookie('abu_token');
  res.json({ ok: true });
});

function setAuthCookie(res, token) {
  res.cookie('abu_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

module.exports = router;
