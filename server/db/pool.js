'use strict';

const { Pool } = require('pg');

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('DATABASE_SSL must be true or false');
}

function createPool({ connectionString = process.env.DATABASE_URL, ssl = process.env.DATABASE_SSL, ...options } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL');
  return new Pool({ connectionString, ssl: parseBoolean(ssl) ? { rejectUnauthorized: false } : false, application_name: 'yeogiyeotji', ...options });
}

module.exports = { createPool, parseBoolean };
