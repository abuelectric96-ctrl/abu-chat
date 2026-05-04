// Protects routes — expects "Authorization: Bearer <jwt>" or "abu_token" cookie.
const { verify } = require('../lib/jwt');

module.exports = function authRequired(req, res, next) {
  let token = null;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) token = auth.slice(7);
  else if (req.cookies && req.cookies.abu_token) token = req.cookies.abu_token;

  if (!token) return res.status(401).json({ error: 'unauthenticated' });

  try {
    const payload = verify(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
};
