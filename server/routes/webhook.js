// Meta webhook endpoint. Two responsibilities:
//   GET  — verification handshake (Meta sends a challenge once when you set up the webhook).
//   POST — receives comment events; matches against keyword rules and posts replies.
//
// Webhook payload (simplified):
//   {
//     object: 'instagram',
//     entry: [{
//       id: '<ig_user_id or page_id>',
//       changes: [{
//         field: 'comments',
//         value: { id, text, from, media: { id }, ... }
//       }]
//     }]
//   }
const express = require('express');
const db = require('../db');
const meta = require('../lib/meta');
const { decrypt } = require('../lib/crypto');

const router = express.Router();

const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;

// --- Verification handshake ---
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// --- Event ingestion ---
router.post('/', async (req, res) => {
  // ALWAYS 200 quickly — Meta retries on non-200 and we want to dedupe ourselves.
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body || body.object !== 'instagram') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'comments') continue;
        await handleCommentEvent(entry.id, change.value).catch((e) =>
          console.error('[webhook] comment handler failed', e)
        );
      }
    }
  } catch (err) {
    console.error('[webhook] ingest error', err);
  }
});

async function handleCommentEvent(entryId, value) {
  // entryId here is the IG user id (Instagram entries) — we look up our stored account.
  const accountRes = await db.query(
    `SELECT id, client_id, page_id, access_token_enc
       FROM ig_accounts
      WHERE ig_user_id = $1 AND is_active = TRUE
      LIMIT 1`,
    [String(entryId)]
  );
  if (!accountRes.rowCount) {
    console.warn('[webhook] no active account for', entryId);
    return;
  }
  const account = accountRes.rows[0];
  const pageToken = decrypt(account.access_token_enc);

  const commentId = value.id;
  const commentText = (value.text || '').trim();
  const postId = value.media?.id || null;
  const fromUsername = value.from?.username;

  // Don't reply to ourselves (avoid loops).
  if (fromUsername && account.username && fromUsername === account.username) return;
  if (!commentId || !commentText) return;

  // Have we already handled this comment?
  const dup = await db.query(
    `SELECT 1 FROM replies WHERE ig_account_id = $1 AND comment_id = $2`,
    [account.id, commentId]
  );
  if (dup.rowCount) return;

  // Find the highest-priority active rule whose keyword is in the text.
  const rulesRes = await db.query(
    `SELECT id, keyword, reply_text, post_id_filter, priority
       FROM rules
      WHERE ig_account_id = $1 AND is_active = TRUE
        AND (post_id_filter IS NULL OR post_id_filter = $2)
      ORDER BY priority DESC, id ASC`,
    [account.id, postId]
  );

  const lower = commentText.toLowerCase();
  const match = rulesRes.rows.find((r) => lower.includes(String(r.keyword).toLowerCase()));

  if (!match) {
    // Log a "skipped" record for transparency in the dashboard.
    await db.query(
      `INSERT INTO replies (ig_account_id, post_id, comment_id, comment_text, status)
       VALUES ($1, $2, $3, $4, 'skipped')
       ON CONFLICT (ig_account_id, comment_id) DO NOTHING`,
      [account.id, postId, commentId, commentText]
    );
    return;
  }

  // Send the reply.
  try {
    const personalized = personalize(match.reply_text, { username: fromUsername });
    const r = await meta.replyToComment({
      commentId,
      message: personalized,
      pageAccessToken: pageToken,
    });
    await db.query(
      `INSERT INTO replies (ig_account_id, rule_id, post_id, comment_id, comment_text, reply_text, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', NOW())
       ON CONFLICT (ig_account_id, comment_id) DO NOTHING`,
      [account.id, match.id, postId, commentId, commentText, personalized]
    );
    bumpUsage(account.client_id).catch(() => {});
    console.log('[webhook] replied', { commentId, ruleId: match.id, mid: r.id });
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err.message;
    await db.query(
      `INSERT INTO replies (ig_account_id, rule_id, post_id, comment_id, comment_text, reply_text, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7)
       ON CONFLICT (ig_account_id, comment_id) DO NOTHING`,
      [account.id, match.id, postId, commentId, commentText, match.reply_text, msg]
    );
    console.error('[webhook] reply failed', msg);
  }
}

function personalize(template, ctx) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : ''));
}

async function bumpUsage(clientId) {
  const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
  await db.query(
    `INSERT INTO usage_monthly (client_id, yyyymm, replies_sent)
     VALUES ($1, $2, 1)
     ON CONFLICT (client_id, yyyymm) DO UPDATE
       SET replies_sent = usage_monthly.replies_sent + 1`,
    [clientId, yyyymm]
  );
}

module.exports = router;
