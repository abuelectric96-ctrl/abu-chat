// PostgreSQL connection pool — single shared pool for the whole server.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
