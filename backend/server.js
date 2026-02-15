const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const { connect } = require('./db/connection');
const { auth, requireUserType, JWT_SECRET } = require('./middleware/auth');
const dbRoutes = require('./routes/dbRoutes');
const userRoutes = require('./routes/userRoutes');
const roleRoutes = require('./routes/roleRoutes');
const portfolioRoutes = require('./routes/portfolioRoutes');

const app = express();
app.use(bodyParser.json());

const frontendRoot = path.resolve(__dirname, '..');
app.use(express.static(frontendRoot));

connect()
  .then(() => console.log('DB pool connected'))
  .catch((err) => console.error('DB pool error', err));

function sendError(res, code, msg) {
  res.status(code).json({ error: msg });
}

app.post('/api/register', async (req, res) => {
  const { username, password, fullname, email, phone, address } = req.body || {};
  if (!username || !password) return sendError(res, 400, 'username and password required');

  try {
    const pool = await connect();
    const existing = await pool.request().input('username', username).query('SELECT id FROM dbo.users WHERE username = @username');
    if (existing.recordset.length) return sendError(res, 409, 'username exists');

    const passwordHash = await bcrypt.hash(password, 10);
    const insert = await pool
      .request()
      .input('username', username)
      .input('password_hash', passwordHash)
      .input('user_type', 'normal')
      .input('status', 'active')
      .input('full_name', fullname || null)
      .input('email', email || null)
      .input('phone', phone || null)
      .input('address', address || null)
      .query(`
        INSERT INTO dbo.users (username, password_hash, user_type, status, full_name, email, phone, address)
        VALUES (@username, @password_hash, @user_type, @status, @full_name, @email, @phone, @address);
        SELECT SCOPE_IDENTITY() AS id;
      `);

    return res.json({ ok: true, userId: insert.recordset[0].id });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return sendError(res, 400, 'username and password required');

  try {
    const pool = await connect();
    const result = await pool.request().input('username', username).query('SELECT id, username, password_hash, user_type, status FROM dbo.users WHERE username = @username');
    const user = result.recordset[0];
    if (!user) return sendError(res, 401, 'invalid credentials');

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) return sendError(res, 401, 'invalid credentials');
    if ((user.status || '').toLowerCase() !== 'active') return sendError(res, 403, 'inactive user');

    const token = jwt.sign(
      { sub: user.id, username: user.username, user_type: user.user_type },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({ ok: true, token, user_type: user.user_type, username: user.username });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const pool = await connect();
    const result = await pool.request().input('id', req.user.id).query(`
      SELECT u.id, u.username, u.full_name, u.email, u.phone, u.address, u.user_type, u.status, u.role_id, u.created_at,
             r.role_name, r.module_access_json
      FROM dbo.users u
      LEFT JOIN dbo.roles r ON r.id = u.role_id
      WHERE u.id = @id
    `);
    const user = result.recordset[0];
    if (!user) return sendError(res, 404, 'user not found');
    let module_access = {};
    try {
      module_access = JSON.parse(user.module_access_json || '{}');
    } catch (_) {
      module_access = {};
    }
    delete user.module_access_json;
    user.module_access = module_access;
    return res.json({ user });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
});

app.use('/api/db', dbRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/portfolio', portfolioRoutes);

app.get('/api/admin/users', auth, requireUserType('admin', 'superadmin'), async (req, res) => {
  try {
    const pool = await connect();
    const result = await pool.request().query('SELECT id, username, user_type, status, role_id, created_at FROM dbo.users ORDER BY created_at DESC');
    return res.json({ users: result.recordset });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
});

app.get('/api/market/ticker', async (req, res) => {
  return res.json({ tickers: [{ symbol: 'INFY', price: 1650.4, change: +1.8 }, { symbol: 'TCS', price: 3220.0, change: -0.6 }] });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendRoot, 'login.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('SmartTrade backend running on port', PORT));
