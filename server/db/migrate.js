'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('./pool');

async function migrate({ pool = createPool(), migrationsDir = path.join(__dirname, 'migrations') } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const files = (await fs.readdir(migrationsDir)).filter(file => file.endsWith('.sql')).sort();
    for (const file of files) {
      const version = file.split('_')[0];
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (applied.rowCount) continue;
      await client.query(await fs.readFile(path.join(migrationsDir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

if (require.main === module) migrate().then(() => console.log('Database migrations applied')).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { migrate };
