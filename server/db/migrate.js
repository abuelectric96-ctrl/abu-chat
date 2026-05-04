// Tiny migration helper: applies server/db/schema.sql to the configured database.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('[migrate] schema applied');
  } catch (err) {
    console.error('[migrate] failed', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
