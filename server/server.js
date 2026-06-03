// ABU-chat — main HTTP server entrypoint.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const metaOAuthRoutes = require('./routes/metaOAuth');
const webhookRoutes = require('./routes/webhook');
const rulesRoutes = require('./routes/rules');
const paymentRoutes = require('./routes/payment');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// --- Core middleware ---
app.use(helmet({ contentSecurityPolicy: false })); // CSP relaxed for the inline-styled landing
app.use(cors({
  origin: process.env.APP_URL || true,
  credentials: true,
}));
app.use(morgan('tiny'));
app.use(cookieParser());

// IMPORTANT: webhook must be parsed BEFORE the auth-protected JSON routes, but
// Meta sends application/json so the global json parser is fine here.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Public static files (landing, auth pages, etc.) ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Health check ---
app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// --- Rate limit auth endpoints (a little defense in depth) ---
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/auth/meta', metaOAuthRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/webhook/meta', webhookRoutes);

// --- 404 + error handler ---
app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(PORT, () => {
  console.log(`ABU-chat server listening on :${PORT}`);
});
