const bcrypt = require('bcrypt');
const { connect } = require('../db/connection');
const { logAudit } = require('../middleware/audit');

function sendError(res, code, msg) {
  return res.status(code).json({ error: msg });
}

function canCreateType(actorType, requestedType) {
  if (actorType === 'superadmin') return ['normal', 'admin', 'superadmin'].includes(requestedType);
  if (actorType === 'admin') return requestedType === 'normal';
  return false;
}

function canManageTarget(actorType, targetType) {
  if (actorType === 'superadmin') return true;
  if (actorType === 'admin') return String(targetType || '').toLowerCase() === 'normal';
  return false;
}

async function createUser(req, res) {
  const { username, password, user_type, status, role_id, full_name, email, phone, address, pancard_no } = req.body || {};
  if (!username || !password || !user_type || !status || !full_name || !email || !phone) {
    return sendError(res, 400, 'username, password, user_type, status, full_name, email, phone required');
  }

  const actorType = req.user.user_type;
  const normalizedType = String(user_type).toLowerCase();
  const normalizedStatus = String(status).toLowerCase();

  if (!['normal', 'admin', 'superadmin'].includes(normalizedType)) return sendError(res, 400, 'invalid user_type');
  if (!['active', 'inactive'].includes(normalizedStatus)) return sendError(res, 400, 'invalid status');
  if (!canCreateType(actorType, normalizedType)) return sendError(res, 403, 'forbidden to create this user_type');

  if (normalizedType !== 'normal' && role_id) return sendError(res, 400, 'role assignment is only allowed for normal user');

  try {
    const pool = await connect();
    const existing = await pool.request().input('username', username).query('SELECT id FROM dbo.users WHERE username = @username');
    if (existing.recordset.length) return sendError(res, 409, 'username exists');

    const passwordHash = await bcrypt.hash(password, 10);
    const insert = await pool
      .request()
      .input('username', username)
      .input('password_hash', passwordHash)
      .input('user_type', normalizedType)
      .input('status', normalizedStatus)
      .input('role_id', normalizedType === 'normal' ? role_id || null : null)
      .input('full_name', full_name)
      .input('email', email)
      .input('phone', phone)
      .input('address', address || null)
      .input('pancard_no', pancard_no || null)
      .query(`
        IF COL_LENGTH('dbo.users', 'PasswordHash') IS NOT NULL
        BEGIN
          INSERT INTO dbo.users (username, password_hash, [PasswordHash], user_type, status, role_id, full_name, email, phone, address, pancard_no)
          VALUES (@username, @password_hash, @password_hash, @user_type, @status, @role_id, @full_name, @email, @phone, @address, @pancard_no);
        END
        ELSE
        BEGIN
          INSERT INTO dbo.users (username, password_hash, user_type, status, role_id, full_name, email, phone, address, pancard_no)
          VALUES (@username, @password_hash, @user_type, @status, @role_id, @full_name, @email, @phone, @address, @pancard_no);
        END
        SELECT SCOPE_IDENTITY() AS id;
      `);

    const userId = insert.recordset[0].id;
    await logAudit(req, 'USER_CREATED', 'users', String(userId), {
      username,
      user_type: normalizedType,
      status: normalizedStatus,
      role_id: normalizedType === 'normal' ? role_id || null : null,
      full_name,
      email,
      phone,
      address: address || null,
      pancard_no: pancard_no || null
    });

    return res.json({ success: true, id: userId });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function listUsers(req, res) {
  try {
    const pool = await connect();
    const result = await pool.request().query(`
      SELECT u.id, u.username, u.user_type, u.status, u.role_id, u.full_name, u.email, u.phone, u.address, u.pancard_no, r.role_name, u.created_at
      FROM dbo.users u
      LEFT JOIN dbo.roles r ON r.id = u.role_id
      ORDER BY u.created_at DESC
    `);
    return res.json({ users: result.recordset });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function updateUser(req, res) {
  const { user_id, username, full_name, email, phone, address, pancard_no, status } = req.body || {};
  if (!user_id || !username || !full_name || !email || !phone || !status) {
    return sendError(res, 400, 'user_id, username, full_name, email, phone, status required');
  }

  try {
    const pool = await connect();
    const result = await pool.request().input('id', Number(user_id)).query('SELECT id, username, user_type FROM dbo.users WHERE id = @id');
    const target = result.recordset[0];
    if (!target) return sendError(res, 404, 'user not found');
    if (!canManageTarget(req.user.user_type, target.user_type)) return sendError(res, 403, 'forbidden');

    const duplicate = await pool
      .request()
      .input('id', Number(user_id))
      .input('username', username)
      .query('SELECT id FROM dbo.users WHERE username = @username AND id <> @id');
    if (duplicate.recordset.length) return sendError(res, 409, 'username exists');

    await pool
      .request()
      .input('id', Number(user_id))
      .input('username', username)
      .input('full_name', full_name)
      .input('email', email)
      .input('phone', phone)
      .input('address', address || null)
      .input('pancard_no', pancard_no || null)
      .input('status', status)
      .query(`
        UPDATE dbo.users
        SET username = @username,
            full_name = @full_name,
            email = @email,
            phone = @phone,
            address = @address,
            pancard_no = @pancard_no,
            status = @status,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    await logAudit(req, 'USER_UPDATED', 'users', String(user_id), { username, full_name, email, phone, address: address || null, pancard_no: pancard_no || null, status });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function deleteUser(req, res) {
  const { user_id } = req.body || {};
  if (!user_id) return sendError(res, 400, 'user_id required');
  if (Number(user_id) === Number(req.user.id)) return sendError(res, 400, 'cannot delete current user');

  try {
    const pool = await connect();
    const result = await pool.request().input('id', Number(user_id)).query('SELECT id, username, user_type FROM dbo.users WHERE id = @id');
    const target = result.recordset[0];
    if (!target) return sendError(res, 404, 'user not found');
    if (!canManageTarget(req.user.user_type, target.user_type)) return sendError(res, 403, 'forbidden');

    await pool.request().input('id', Number(user_id)).query('DELETE FROM dbo.users WHERE id = @id');
    await logAudit(req, 'USER_DELETED', 'users', String(user_id), { username: target.username });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function resetPassword(req, res) {
  const { user_id, new_password } = req.body || {};
  if (!user_id || !new_password) return sendError(res, 400, 'user_id and new_password required');

  try {
    const pool = await connect();
    const result = await pool.request().input('id', Number(user_id)).query('SELECT id, user_type FROM dbo.users WHERE id = @id');
    const target = result.recordset[0];
    if (!target) return sendError(res, 404, 'user not found');

    const actorType = req.user.user_type;
    const targetType = (target.user_type || '').toLowerCase();
    if (actorType === 'admin' && targetType !== 'normal') return sendError(res, 403, 'admin can reset only normal user password');

    const hash = await bcrypt.hash(new_password, 10);
    await pool.request().input('id', Number(user_id)).input('password_hash', hash).query(`
      UPDATE dbo.users SET password_hash = @password_hash, updated_at = SYSUTCDATETIME() WHERE id = @id;
      IF COL_LENGTH('dbo.users', 'PasswordHash') IS NOT NULL
      BEGIN
        UPDATE dbo.users SET [PasswordHash] = @password_hash WHERE id = @id;
      END
    `);

    await logAudit(req, 'USER_PASSWORD_RESET', 'users', String(user_id));
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function overrideUserType(req, res) {
  const { user_id, user_type } = req.body || {};
  if (!user_id || !user_type) return sendError(res, 400, 'user_id and user_type required');

  const normalizedType = String(user_type).toLowerCase();
  if (!['normal', 'admin', 'superadmin'].includes(normalizedType)) return sendError(res, 400, 'invalid user_type');

  try {
    const pool = await connect();
    await pool.request().input('id', Number(user_id)).input('user_type', normalizedType).query(`
      UPDATE dbo.users SET user_type = @user_type, updated_at = SYSUTCDATETIME() WHERE id = @id
    `);

    await logAudit(req, 'USER_TYPE_OVERRIDDEN', 'users', String(user_id), { user_type: normalizedType });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function assignRole(req, res) {
  const { user_id, role_id } = req.body || {};
  if (!user_id) return sendError(res, 400, 'user_id required');

  const normalizedRoleId = role_id ? Number(role_id) : null;
  if (role_id && (!Number.isInteger(normalizedRoleId) || normalizedRoleId <= 0)) {
    return sendError(res, 400, 'invalid role_id');
  }

  try {
    const pool = await connect();
    const userResult = await pool.request().input('id', Number(user_id)).query('SELECT id, user_type FROM dbo.users WHERE id = @id');
    const target = userResult.recordset[0];
    if (!target) return sendError(res, 404, 'user not found');
    if ((target.user_type || '').toLowerCase() !== 'normal') return sendError(res, 400, 'role assignment allowed only for normal user');

    if (normalizedRoleId) {
      const roleResult = await pool.request().input('role_id', normalizedRoleId).query('SELECT id FROM dbo.roles WHERE id = @role_id');
      if (!roleResult.recordset[0]) return sendError(res, 404, 'role not found');
    }

    await pool
      .request()
      .input('id', Number(user_id))
      .input('role_id', normalizedRoleId)
      .query('UPDATE dbo.users SET role_id = @role_id, updated_at = SYSUTCDATETIME() WHERE id = @id');

    await logAudit(req, 'USER_ROLE_ASSIGNED', 'users', String(user_id), { role_id: normalizedRoleId });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

module.exports = {
  createUser,
  listUsers,
  updateUser,
  deleteUser,
  resetPassword,
  overrideUserType,
  assignRole
};
