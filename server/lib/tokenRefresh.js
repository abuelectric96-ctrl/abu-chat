/**
 * Instagram access token avtomatik yangilash
 *
 * Meta long-lived token ~60 kun amal qiladi.
 * Muddati tugashiga 10 kun qolganda yangilaymiz.
 *
 * Qo'lda ishga tushirish:  node -e "require('./server/lib/tokenRefresh').refreshAll()"
 * Avtomatik: server.js startup + har 24 soatda
 */

const axios  = require('axios');
const db     = require('../db');
const { encrypt, decrypt } = require('./crypto');

const GRAPH = 'https://graph.facebook.com/v19.0';

// Muddati tugashiga necha kun qolganida yangilash
const REFRESH_THRESHOLD_DAYS = 10;

/**
 * Muddati yaqinlashgan barcha tokenlarni yangilaydi.
 * Server startup'da va har 24 soatda chaqiriladi.
 */
async function refreshAll() {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + REFRESH_THRESHOLD_DAYS);

  // Muddati tugayotgan yoki allaqachon tugagan tokenlar
  const { rows: accounts } = await db.query(
    `SELECT id, ig_user_id, username, access_token_enc, token_expires_at
     FROM ig_accounts
     WHERE is_active = TRUE
       AND (
         token_expires_at IS NULL
         OR token_expires_at < $1
       )`,
    [threshold]
  );

  if (!accounts.length) {
    console.log('[tokenRefresh] Yangilanishi kerak bo\'lgan token topilmadi.');
    return;
  }

  console.log(`[tokenRefresh] ${accounts.length} ta token yangilanmoqda...`);

  for (const acc of accounts) {
    try {
      await refreshOne(acc);
      console.log(`[tokenRefresh] ✓ @${acc.username} (id=${acc.id}) yangilandi`);
    } catch (err) {
      console.error(`[tokenRefresh] ✗ @${acc.username} (id=${acc.id}) xato:`, err.message);
      // Xato bo'lsa ham davom etamiz — boshqa akkauntlar yangilansin
    }
  }
}

/**
 * Bitta akkaunt tokenini yangilaydi.
 */
async function refreshOne(acc) {
  // Tokenni shifrlashdan chiqarish
  const currentToken = decrypt(acc.access_token_enc);

  // Meta API ga yangilash so'rovi
  const { data } = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: {
      grant_type:        'fb_exchange_token',
      client_id:         process.env.META_APP_ID,
      client_secret:     process.env.META_APP_SECRET,
      fb_exchange_token: currentToken,
    },
  });

  // Yangi token va muddati
  const newToken      = data.access_token;
  const expiresInSec  = data.expires_in || 5183944; // ~60 kun default
  const newExpiry     = new Date(Date.now() + expiresInSec * 1000);
  const encryptedNew  = encrypt(newToken);

  // DB ga saqlash
  await db.query(
    `UPDATE ig_accounts
     SET access_token_enc = $1,
         token_expires_at = $2
     WHERE id = $3`,
    [encryptedNew, newExpiry, acc.id]
  );
}

/**
 * Bitta akkauntni ID orqali yangilash (manual/dashboard uchun).
 */
async function refreshById(igAccountId) {
  const { rows } = await db.query(
    `SELECT id, ig_user_id, username, access_token_enc, token_expires_at
     FROM ig_accounts WHERE id = $1 AND is_active = TRUE`,
    [igAccountId]
  );
  if (!rows.length) throw new Error('account_not_found');
  await refreshOne(rows[0]);
}

/**
 * Server.js da chaqirish uchun — startup + interval.
 * 24 soatda bir marta ishlaydi.
 */
function startAutoRefresh() {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 soat

  // Bir marta darhol ishga tushir (startup tekshiruvi)
  refreshAll().catch(err =>
    console.error('[tokenRefresh] Startup refresh xato:', err.message)
  );

  // Har 24 soatda qayta tekshir
  setInterval(() => {
    refreshAll().catch(err =>
      console.error('[tokenRefresh] Interval refresh xato:', err.message)
    );
  }, INTERVAL_MS);

  console.log('[tokenRefresh] Avtomatik yangilash yoqildi (har 24 soatda)');
}

module.exports = { refreshAll, refreshById, startAutoRefresh };
