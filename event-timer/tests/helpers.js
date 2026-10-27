// Shared set-up: a fresh database with the schema loaded, and the dev server on
// a free port in front of it. Needs a local Postgres; see tests/README.md.
const { Pool } = require('pg');
const { createServer, prepareDatabase, attachRealtime } = require('../tools/dev-server.js');

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://postgres:postgres@localhost:5432/postgres';

async function startStack(name) {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const db = `et_${name}_${process.pid}`;
  await admin.query(`drop database if exists ${db}`);
  await admin.query(`create database ${db}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${db}`;
  const pool = new Pool({ connectionString: url.toString(), max: 8 });
  await prepareDatabase(pool, true);

  const offline = { value: false };
  const server = createServer({ pool, offline });
  const realtime = await attachRealtime(server, pool, offline);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function rpc(fn, args) {
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    return res.json();
  }

  async function stop() {
    await realtime.close();
    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();
    await pool.end();
    const a = new Pool({ connectionString: ADMIN_URL });
    await a.query(`drop database if exists ${db} with (force)`);
    await a.end();
  }

  return { base, pool, rpc, stop, offline, realtime };
}

module.exports = { startStack };
