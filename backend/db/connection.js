// Central DB connection file — all DB access should use this module.
// Auth mode selection:
// - DB_INTEGRATED=true|false explicitly selects mode
// - if DB_INTEGRATED is unset and DB_USER/DB_PASS are unset, default to integrated auth

require('dotenv').config();

const integratedEnv = (process.env.DB_INTEGRATED || '').trim().toLowerCase();
const hasSqlCreds = Boolean(process.env.DB_USER && process.env.DB_PASS);
const useIntegrated = integratedEnv
  ? integratedEnv === 'true'
  : !hasSqlCreds;

let sql;
let config;
if (useIntegrated) {
  // Attempt to use msnodesqlv8 (native) for Windows Integrated Auth.
  // This is optional — if the native driver is not installed the connection will fail.
  sql = require('mssql/msnodesqlv8');
  config = {
    server: process.env.DB_SERVER || 'DESKTOP-SNB3ISR',
    database: process.env.DB_NAME || 'trade',
    driver: 'msnodesqlv8',
    options: {
      trustedConnection: true
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
  };
} else {
  sql = require('mssql');
  config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER || 'DESKTOP-SNB3ISR',
    database: process.env.DB_NAME || 'trade',
    options: {
      encrypt: false,
      trustServerCertificate: true
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
  };
}

const pool = new sql.ConnectionPool(config);

let poolConnect = null;
async function connect() {
  if (!poolConnect) {
    poolConnect = pool.connect();
    await poolConnect;
  }
  return pool;
}

module.exports = { sql, pool, connect, config, useIntegrated };
