// Initialize required tables in `trade` database.
// Usage: from backend folder run: `node db/init.js` (or `npm run init-db`)

const fs = require('fs');
const path = require('path');
const { connect } = require('./connection');

async function init() {
  try {
    const pool = await connect();

    const schemaPath = path.join(__dirname, 'create_tables.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await pool.request().query(schemaSql);

    console.log('DB init complete — schema and seed data ensured.');
    process.exit(0);
  } catch (err) {
    console.error('DB init failed:', err);
    process.exit(2);
  }
}

init();
