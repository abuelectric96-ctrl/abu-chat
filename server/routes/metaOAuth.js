// Meta (Facebook) OAuth — connect a client's Instagram Business account.
// Endpoints:
//   GET  /api/auth/meta/start       (redirects to Facebook login)
//   GET  /api/auth/meta/callback    (handles ?code=... from Facebook)
//   GET  /api/ig-accounts           (list connected IG accounts)
//   POST /api/ig-accounts/:id/disconnect
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const meta = require('../lib/meta');
const { encrypt } = require('../lib/crypto');
const authRequired = require('../middleware/authRequired');

const router = express.Router();

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT = process.env.META_REDIRECT_URI;
const SCOPES = (process.env.META_SCOPES || '').split(',').map((s) => s.trim()).filter(Boolean);

// Step 1 — kick off OAuth. We tuck the client id into a signed `state` param
// so the callback can match the redirect back to the right user.
router.get('/start', authRequired, (req, res) => {
  if (!APP_ID || !REDIRECT) return res.status(500).send('Meta OAuth not configured');
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = Buffer.from(JSON.stringify({ uid: req.user.id, n: nonce })).toString('base64url');

  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  url.searchParams.set('client_id', APP_ID);
  url.searchParams.set('redirect_uri', REDIRECT);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  res.redirect(url.toString());
});

// Step 2 — Facebook sends ?code=... here.
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).send(`Meta error: ${error_description || error}`);
  if (!code || !state) return res.status(400).send('Missing code/state');

  let uid;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    uid = decoded.uid;
  } catch {
    return res.status(400).send('Invalid state');
  }

  try {
    // Exchange code -> short token -> long-lived token (~60 days).
    const short = await meta.exchangeCodeForToken({
      code, appId: APP_ID, appSecret: APP_SECRET, redirectUri: REDIRECT,
    });
    const longLived = await meta.getLongLivedUserToken({
      shortToken: short.access_token, appId: APP_ID, appSecret: APP_SECRET,
    });

    // Fetch the pages the user manages and their attached IG accounts.
    const pages = await meta.getUserPages(longLived.access_token);
    const igPages = pages.filter((p) => p.instagram_business_account);

    if (!igPages.length) {
      return res.redirect('/dashboard.html?ig=none');
    }

    // For each IG account, save (or update) the connection.
    for (const p of igPages) {
      const ig = p.instagram_business_account;
      // Subscribe the page so we receive webhooks.
      try { await meta.subscribePageToWebhook(p.id, p.access_token); }
      catch (e) { console.warn('[meta.subscribe] failed for page', p.id, e?.response?.data); }

      const expiresAt = longLived.expires_in
        ? new Date(Date.now() + longLived.expires_in * 1000)
        : null;

      await db.query(
        `INSERT INTO ig_accounts (client_id, ig_user_id, username, page_id, access_token_enc, token_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (client_id, ig_user_id) DO UPDATE
           SET username = EXCLUDED.username,
               page_id = EXCLUDED.page_id,
               access_token_enc = EXCLUDED.access_token_enc,
               token_expires_at = EXCLUDED.token_expires_at,
               is_active = TRUE`,
        [uid, ig.id, ig.username, p.id, encrypt(p.access_token), expiresAt]
      );
    }

    res.redirect('/dashboard.html?ig=connected');
  } catch (err) {
    console.error('[meta.callback]', err?.response?.data || err);
    res.status(500).send('Failed to connect Instagram. Please try again.');
  }
});

router.get('/ig-accounts', authRequired, async (req, res) => {
  const r = await db.query(
    `SELECT id, ig_user_id, username, page_id, is_active, connected_at, token_expires_at
     FROM ig_accounts WHERE client_id = $1 ORDER BY connected_at DESC`,
    [req.user.id]
  );
  res.json({ accounts: r.rows });
});

router.post('/ig-accounts/:id/disconnect', authRequired, async (req, res) => {
  await db.query(
    `UPDATE ig_accounts SET is_active = FALSE WHERE id = $1 AND client_id = $2`,
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

module.exports = router;
