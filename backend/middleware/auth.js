const jwt = require('jsonwebtoken');
const { connect } = require('../db/connection');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_prod';

function sendError(res, code, msg) {
  return res.status(code).json({ error: msg });
}

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return sendError(res, 401, 'missing token');

  let payload;
  try {
    payload = jwt.verify(match[1], JWT_SECRET);
  } catch (error) {
    return sendError(res, 401, 'invalid token');
  }

  try {
    const pool = await connect();
    const result = await pool
      .request()
      .input('id', payload.sub)
      .query('SELECT id, username, user_type, status FROM dbo.users WHERE id = @id');

    const user = result.recordset[0];
    if (!user) return sendError(res, 401, 'user not found');
    if ((user.status || '').toLowerCase() !== 'active') return sendError(res, 403, 'inactive user');

    req.user = {
      id: user.id,
      username: user.username,
      user_type: (user.user_type || '').toLowerCase()
    };
    return next();
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

function requireUserType(...allowedTypes) {
  const allowed = allowedTypes.map((v) => String(v || '').toLowerCase());
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'missing authenticated user');
    const userType = (req.user.user_type || '').toLowerCase();
    if (!allowed.includes(userType)) return sendError(res, 403, 'forbidden');
    return next();
  };
}

module.exports = {
  auth,
  requireUserType,
  JWT_SECRET
};
