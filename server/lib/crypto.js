// Symmetric encryption for sensitive fields (Instagram access tokens).
// Uses AES-256-GCM. Key comes from TOKEN_ENC_KEY env var (64-char hex = 32 bytes).
const crypto = require('crypto');

const KEY_HEX = process.env.TOKEN_ENC_KEY || '';
if (KEY_HEX && KEY_HEX.length !== 64) {
  console.warn('[crypto] TOKEN_ENC_KEY should be 64 hex chars (32 bytes). Got', KEY_HEX.length);
}
const KEY = KEY_HEX ? Buffer.from(KEY_HEX, 'hex') : null;

function encrypt(plain) {
  if (!KEY) throw new Error('TOKEN_ENC_KEY not set');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv).base64(tag).base64(ciphertext)
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

function decrypt(payload) {
  if (!KEY) throw new Error('TOKEN_ENC_KEY not set');
  const [ivB64, tagB64, ctB64] = payload.split('.');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
