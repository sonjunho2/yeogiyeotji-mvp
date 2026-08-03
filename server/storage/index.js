'use strict';

const { createJsonStorage } = require('./json-storage');
const { createPostgresStorage } = require('./postgres-storage');
const { createPool } = require('../db/pool');

function createStorage({ driver = process.env.STORAGE_DRIVER || 'json', dataFile, pool } = {}) {
  if (driver === 'json') return createJsonStorage(dataFile);
  if (driver === 'postgres') return createPostgresStorage({ pool: pool || createPool() });
  throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
}

module.exports = { createStorage };
