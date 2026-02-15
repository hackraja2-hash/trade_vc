const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');
const { sql, connect } = require('../db/connection');
const { logAudit } = require('../middleware/audit');

function sendError(res, code, msg) {
  return res.status(code).json({ error: msg });
}

function getErrorMessage(error) {
  if (!error) return 'connection failed';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message && error.message !== '[object Object]') return error.message;
  if (error.originalError) {
    if (typeof error.originalError === 'string') return error.originalError;
    if (typeof error.originalError.message === 'string' && error.originalError.message) return error.originalError.message;
  }
  if (Array.isArray(error.precedingErrors) && error.precedingErrors.length) {
    const first = error.precedingErrors[0];
    if (first && typeof first.message === 'string' && first.message) return first.message;
  }
  try {
    return JSON.stringify(error.originalError || error);
  } catch (_) {
    return 'connection failed';
  }
}

function getEncryptionKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY || '';
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length === 32) return key;
  }
  const fallbackSeed = process.env.JWT_SECRET || 'change_this_secret_in_prod';
  return crypto.createHash('sha256').update(fallbackSeed).digest();
}

function encryptSecret(secret) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`;
}

async function listConnections(req, res) {
  try {
    const pool = await connect();
    const result = await pool.request().query(`
      SELECT id, connection_name, db_type, host, port, database_name, username, auth_type, encrypt_connection, is_active, status, created_at, updated_at
      FROM dbo.connection_configs
      ORDER BY created_at DESC
    `);
    return res.json({ connections: result.recordset });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

function getCurrentMachineSettings(req) {
  const auth_type = (process.env.DB_INTEGRATED || '').toLowerCase() === 'true' ? 'windows' : 'sql';
  return {
    connection_name: 'local_raja_laptop',
    db_type: 'local',
    host: process.env.DB_SERVER || os.hostname(),
    port: Number(process.env.DB_PORT || 1433),
    database_name: process.env.DB_NAME || 'trade',
    auth_type,
    username: auth_type === 'windows' ? (process.env.USERNAME || req.user.username || 'windows-user') : (process.env.DB_USER || 'sa')
  };
}

async function ensureDefaultConnection(req, res) {
  try {
    const pool = await connect();
    const current = getCurrentMachineSettings(req);
    const encryptedPassword = encryptSecret('');

    await pool
      .request()
      .input('connection_name', current.connection_name)
      .input('db_type', current.db_type)
      .input('host', current.host)
      .input('port', Number(current.port) || 1433)
      .input('database_name', current.database_name)
      .input('username', current.username)
      .input('auth_type', current.auth_type)
      .input('encrypted_password', encryptedPassword)
      .input('created_by', req.user.id)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.connection_configs WHERE connection_name = @connection_name)
        BEGIN
          UPDATE dbo.connection_configs
          SET db_type = @db_type,
              host = @host,
              port = @port,
              database_name = @database_name,
              username = @username,
              auth_type = @auth_type,
              is_active = 1,
              status = 'active',
              updated_at = SYSUTCDATETIME()
          WHERE connection_name = @connection_name;
        END
        ELSE
        BEGIN
          INSERT INTO dbo.connection_configs (
            connection_name, db_type, host, port, database_name, username, auth_type, encrypted_password, encrypt_connection, is_active, status, created_by
          )
          VALUES (
            @connection_name, @db_type, @host, @port, @database_name, @username, @auth_type, @encrypted_password, 0, 1, 'active', @created_by
          );
        END

        UPDATE dbo.connection_configs
        SET is_active = CASE WHEN connection_name = @connection_name THEN 1 ELSE 0 END,
            updated_at = SYSUTCDATETIME();

        SELECT TOP 1 id, connection_name, db_type, host, port, database_name, username, auth_type, encrypt_connection, is_active, status, created_at, updated_at
        FROM dbo.connection_configs
        WHERE connection_name = @connection_name;
      `);

    return res.json({ success: true, current });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function listOpenConnections(req, res) {
  try {
    const pool = await connect();
    const result = await pool.request().query(`
      SELECT id, connection_name, host, database_name, status, is_active, updated_at
      FROM dbo.connection_configs
      ORDER BY CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at DESC
    `);

    const rows = result.recordset || [];
    const openConnections = rows.filter((row) => String(row.status || '').toLowerCase() === 'active');
    return res.json({
      open_count: openConnections.length,
      active_count: rows.filter((row) => row.is_active).length,
      connections: rows
    });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

function discoverHosts(req, res) {
  const discovered = new Set();
  const localHost = process.env.DB_SERVER || os.hostname();
  discovered.add(localHost);
  discovered.add('.');
  discovered.add('localhost');

  exec('sqlcmd -L', { timeout: 7000 }, (error, stdout) => {
    if (!error && stdout) {
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('Servers:'))
        .forEach((line) => discovered.add(line));
    }

    return res.json({ hosts: Array.from(discovered) });
  });
}

async function testConnection(req, res) {
  const { db_type, host, port, database_name, username, password, encrypt_connection, auth_type } = req.body || {};
  if (!db_type || !host || !database_name) {
    return sendError(res, 400, 'missing required fields');
  }

  const normalizedAuth = String(auth_type || 'windows').toLowerCase();
  if (!['windows', 'sql'].includes(normalizedAuth)) return sendError(res, 400, 'invalid auth_type');

  if (normalizedAuth === 'sql' && (!username || !password)) {
    return sendError(res, 400, 'username and password required for SQL authentication');
  }

  const parsedPort = Number(port);
  const hasPort = Number.isFinite(parsedPort) && parsedPort > 0;

  const createPool = () => {
    if (normalizedAuth === 'windows') {
      const sqlIntegrated = require('mssql/msnodesqlv8');
      const cfg = {
        server: host,
        database: database_name,
        driver: 'msnodesqlv8',
        options: {
          trustedConnection: true,
          encrypt: !!encrypt_connection || String(db_type).toLowerCase() === 'azure',
          trustServerCertificate: true
        },
        pool: { max: 2, min: 0, idleTimeoutMillis: 5000 }
      };
      if (hasPort) cfg.port = parsedPort;
      return new sqlIntegrated.ConnectionPool(cfg);
    }

    const sqlStandard = require('mssql');
    const cfg = {
      user: username,
      password,
      server: host,
      database: database_name,
      options: {
        encrypt: !!encrypt_connection || String(db_type).toLowerCase() === 'azure',
        trustServerCertificate: String(db_type).toLowerCase() === 'local'
      },
      pool: { max: 2, min: 0, idleTimeoutMillis: 5000 }
    };
    if (hasPort) cfg.port = parsedPort;
    return new sqlStandard.ConnectionPool(cfg);
  };

  const tempPool = createPool();

  try {
    await tempPool.connect();
    await tempPool.request().query('SELECT 1 AS ok');
    await tempPool.close();
    return res.json({ success: true, message: 'Success' });
  } catch (error) {
    try { await tempPool.close(); } catch (_) {}
    return res.status(400).json({ success: false, message: 'Failed', error: getErrorMessage(error) });
  }
}

async function saveConnection(req, res) {
  const { connection_name, db_type, host, port, database_name, username, password, encrypt_connection, auth_type } = req.body || {};
  if (!connection_name || !db_type || !host || !database_name) {
    return sendError(res, 400, 'missing required fields');
  }

  const normalizedType = String(db_type).toLowerCase();
  const normalizedAuth = String(auth_type || 'windows').toLowerCase();
  if (!['local', 'azure'].includes(normalizedType)) return sendError(res, 400, 'invalid db_type');
  if (!['windows', 'sql'].includes(normalizedAuth)) return sendError(res, 400, 'invalid auth_type');
  if (normalizedAuth === 'sql' && (!username || !password)) return sendError(res, 400, 'username and password required for SQL authentication');

  try {
    const effectiveUsername = normalizedAuth === 'windows' ? (process.env.USERNAME || req.user.username || 'windows-user') : username;
    const encryptedPassword = encryptSecret(normalizedAuth === 'windows' ? '' : password);
    const pool = await connect();
    const result = await pool
      .request()
      .input('connection_name', connection_name)
      .input('db_type', normalizedType)
      .input('host', host)
      .input('port', Number(port) || 1433)
      .input('database_name', database_name)
      .input('username', effectiveUsername)
      .input('auth_type', normalizedAuth)
      .input('encrypted_password', encryptedPassword)
      .input('encrypt_connection', !!encrypt_connection)
      .input('created_by', req.user.id)
      .query(`
        INSERT INTO dbo.connection_configs (
          connection_name, db_type, host, port, database_name, username, auth_type, encrypted_password, encrypt_connection, created_by
        )
        VALUES (
          @connection_name, @db_type, @host, @port, @database_name, @username, @auth_type, @encrypted_password, @encrypt_connection, @created_by
        );
        SELECT SCOPE_IDENTITY() AS id;
      `);

    const id = result.recordset[0].id;
    await logAudit(req, 'DB_CONNECTION_SAVED', 'connection_configs', String(id), {
      connection_name,
      db_type: normalizedType,
      host,
      port: Number(port) || 1433,
      database_name,
      username: effectiveUsername,
      auth_type: normalizedAuth
    });

    return res.json({ success: true, id });
  } catch (error) {
    console.error(error);
    return sendError(res, 400, getErrorMessage(error));
  }
}

async function updateConnection(req, res) {
  const { id, connection_name, db_type, host, port, database_name, username, password, encrypt_connection, auth_type } = req.body || {};
  if (!id || !connection_name || !db_type || !host || !database_name) {
    return sendError(res, 400, 'missing required fields');
  }

  const normalizedType = String(db_type).toLowerCase();
  const normalizedAuth = String(auth_type || 'windows').toLowerCase();
  if (!['local', 'azure'].includes(normalizedType)) return sendError(res, 400, 'invalid db_type');
  if (!['windows', 'sql'].includes(normalizedAuth)) return sendError(res, 400, 'invalid auth_type');
  if (normalizedAuth === 'sql' && !username) return sendError(res, 400, 'username required for SQL authentication');

  try {
    const pool = await connect();
    const existing = await pool.request().input('id', Number(id)).query('SELECT id, encrypted_password FROM dbo.connection_configs WHERE id = @id');
    const row = existing.recordset[0];
    if (!row) return sendError(res, 404, 'connection not found');

    const duplicate = await pool
      .request()
      .input('id', Number(id))
      .input('connection_name', connection_name)
      .query('SELECT id FROM dbo.connection_configs WHERE connection_name = @connection_name AND id <> @id');
    if (duplicate.recordset.length) return sendError(res, 409, 'connection name exists');

    const effectiveUsername = normalizedAuth === 'windows' ? (process.env.USERNAME || req.user.username || 'windows-user') : username;
    const encryptedPassword = normalizedAuth === 'windows'
      ? encryptSecret('')
      : (password ? encryptSecret(password) : row.encrypted_password);

    await pool
      .request()
      .input('id', Number(id))
      .input('connection_name', connection_name)
      .input('db_type', normalizedType)
      .input('host', host)
      .input('port', Number(port) || 1433)
      .input('database_name', database_name)
      .input('username', effectiveUsername)
      .input('auth_type', normalizedAuth)
      .input('encrypted_password', encryptedPassword)
      .input('encrypt_connection', !!encrypt_connection)
      .query(`
        UPDATE dbo.connection_configs
        SET connection_name = @connection_name,
            db_type = @db_type,
            host = @host,
            port = @port,
            database_name = @database_name,
            username = @username,
            auth_type = @auth_type,
            encrypted_password = @encrypted_password,
            encrypt_connection = @encrypt_connection,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id;
      `);

    await logAudit(req, 'DB_CONNECTION_UPDATED', 'connection_configs', String(id), {
      connection_name,
      db_type: normalizedType,
      host,
      port: Number(port) || 1433,
      database_name,
      username: effectiveUsername,
      auth_type: normalizedAuth
    });

    return res.json({ success: true, id: Number(id) });
  } catch (error) {
    console.error(error);
    return sendError(res, 400, getErrorMessage(error));
  }
}

async function startConnection(req, res) {
  const { id } = req.body || {};
  if (!id) return sendError(res, 400, 'id required');
  try {
    const pool = await connect();
    await pool.request().input('id', Number(id)).query(`
      UPDATE dbo.connection_configs
      SET status = 'active', updated_at = SYSUTCDATETIME()
      WHERE id = @id
    `);
    await logAudit(req, 'DB_CONNECTION_STARTED', 'connection_configs', String(id));
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function stopConnection(req, res) {
  const { id } = req.body || {};
  if (!id) return sendError(res, 400, 'id required');
  try {
    const pool = await connect();
    await pool.request().input('id', Number(id)).query(`
      UPDATE dbo.connection_configs
      SET status = 'stopped', updated_at = SYSUTCDATETIME()
      WHERE id = @id
    `);
    await logAudit(req, 'DB_CONNECTION_STOPPED', 'connection_configs', String(id));
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function activateConnection(req, res) {
  const { id } = req.body || {};
  if (!id) return sendError(res, 400, 'id required');
  try {
    const pool = await connect();
    const tx = pool.transaction();
    await tx.begin();
    await tx.request().query('UPDATE dbo.connection_configs SET is_active = 0, updated_at = SYSUTCDATETIME()');
    await tx.request().input('id', Number(id)).query(`
      UPDATE dbo.connection_configs
      SET is_active = 1, status = 'active', updated_at = SYSUTCDATETIME()
      WHERE id = @id
    `);
    await tx.commit();

    await logAudit(req, 'DB_CONNECTION_ACTIVATED', 'connection_configs', String(id));
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, 'server error');
  }
}

async function deleteConnection(req, res) {
  const { id } = req.body || {};
  if (!id) return sendError(res, 400, 'id required');
  try {
    const pool = await connect();
    const existing = await pool.request().input('id', Number(id)).query('SELECT id, connection_name, is_active FROM dbo.connection_configs WHERE id = @id');
    const row = existing.recordset[0];
    if (!row) return sendError(res, 404, 'connection not found');
    if (String(row.connection_name || '').toLowerCase() === 'local_raja_laptop') {
      return sendError(res, 400, 'default local_raja_laptop cannot be deleted');
    }

    await pool.request().input('id', Number(id)).query('DELETE FROM dbo.connection_configs WHERE id = @id');

    if (row.is_active) {
      await pool.request().query(`
        UPDATE TOP (1) dbo.connection_configs
        SET is_active = 1, status = 'active', updated_at = SYSUTCDATETIME()
        ORDER BY updated_at DESC
      `);
    }

    await logAudit(req, 'DB_CONNECTION_DELETED', 'connection_configs', String(id), { connection_name: row.connection_name });
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendError(res, 400, getErrorMessage(error));
  }
}

module.exports = {
  listConnections,
  listOpenConnections,
  ensureDefaultConnection,
  discoverHosts,
  testConnection,
  saveConnection,
  updateConnection,
  startConnection,
  stopConnection,
  activateConnection,
  deleteConnection
};
