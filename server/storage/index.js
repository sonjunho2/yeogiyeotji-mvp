'use strict';

const { createJsonStorage } = require('./json-storage');

function createStorage({ driver = process.env.STORAGE_DRIVER || 'json', dataFile } = {}) {
  if (driver !== 'json') throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
  return createJsonStorage(dataFile);
}

module.exports = { createStorage };
