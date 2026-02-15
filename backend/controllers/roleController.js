const { connect } = require('../db/connection');
const { logAudit } = require('../middleware/audit');

function sendError(res, code, msg) {
  return res.status(code).json({ error: msg });
}

async function createRole(req, res) {
  const { role_name, module_access } = req.body || {};
  if (!role_name || !module_access || typeof module_access !== 'object') {
    return sendError(res, 400, 'role_name and module_access object required');
  }

  try {
    const pool = await connect();
    const result = await pool
      .request()
      .input('role_name', role_name)
      .input('module_access_json', JSON.stringify(module_access))
      .input('created_by', req.user.id)
      .query(`
        INSERT INTO dbo.roles (role_name, module_access_json, created_by)
        VALUES (@role_name, @module_access_json, @created_by);
        SELECT SCOPE_IDENTITY() AS id;
      `);

    const roleId = result.recordset[0].id;
    await logAudit(req, 'ROLE_CREATED', 'roles', String(roleId), { role_name, module_access });
    return res.json({ success: true, id: roleId });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function listRoles(req, res) {
  try {
    const pool = await connect();
    const result = await pool.request().query('SELECT id, role_name, module_access_json, created_at FROM dbo.roles ORDER BY created_at DESC');
    const roles = result.recordset.map((role) => ({
      ...role,
      module_access: JSON.parse(role.module_access_json || '{}')
    }));
    return res.json({ roles });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

module.exports = {
  createRole,
  listRoles
};
