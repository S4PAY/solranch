const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err);
  process.exit(-1);
});

// Run schema if called directly
if (require.main === module) {
  (async () => {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    try {
      await pool.query(schema);
      console.log('[DB] Schema initialized successfully');
    } catch (err) {
      console.error('[DB] Schema init failed:', err.message);
    } finally {
      await pool.end();
    }
  })();
}

module.exports = pool;
