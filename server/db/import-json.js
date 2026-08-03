'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('./pool');
function parseArgs(argv) { const i = argv.indexOf('--file'); return { execute: argv.includes('--execute'), dryRun: argv.includes('--dry-run'), file: i >= 0 ? argv[i + 1] : path.join(__dirname, '..', 'data', 'store.json') }; }
async function inspect(file) { const data = JSON.parse(await fs.readFile(file, 'utf8')); for (const key of ['users', 'collections', 'places']) if (!Array.isArray(data[key])) throw new Error(`${key} must be an array`); return { users: data.users.length, collections: data.collections.length, places: data.places.length }; }
async function run({ file, execute }) { const counts = await inspect(file); if (!execute) return counts; const pool = createPool(); try { throw new Error('JSON import execute is reserved for a follow-up migration review'); } finally { await pool.end(); } }
if (require.main === module) { const args = parseArgs(process.argv.slice(2)); if (!args.execute && !args.dryRun) { console.error('Usage: --dry-run or --execute [--file path]'); process.exitCode = 2; } else run(args).then(counts => console.log(JSON.stringify(counts))).catch(error => { console.error(error.message); process.exitCode = 1; }); }
module.exports = { inspect, parseArgs, run };
