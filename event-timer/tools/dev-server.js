/* Local stand-in for the real thing, for development and the tests.

   Serves this folder as a static site (as GitHub Pages will), and answers
   POST /rest/v1/rpc/<function> the way Supabase does — by running the same
   function in a local Postgres as the same restricted "anon" role — so the
   page cannot tell the difference.

       DATABASE_URL=postgres://postgres:postgres@localhost:5432/et_dev node tools/dev-server.js

   Then put  url: 'http://localhost:4400'  in assets/js/config.js, or open
   http://localhost:4400/?backend=local  which does the same for one visit.

   Options (environment): PORT (4400), DATABASE_URL, LOAD_SCHEMA=1 to (re)load
   backend/schema.sql at start, LATENCY_MS to slow every answer down. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
};

async function prepareDatabase(pool, loadSchema) {
  // Supabase's two API roles. Locally they only need to exist.
  await pool.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    grant usage on schema public to anon, authenticated;`);
  if (loadSchema) {
    await pool.query(fs.readFileSync(path.join(ROOT, 'backend', 'schema.sql'), 'utf8'));
  }
}

function createServer({ pool, latencyMs = 0, offline = { value: false } }) {
  async function rpc(name, body) {
    if (!/^et_[a-z_]+$/.test(name)) return [404, { message: 'Not found' }];
    const keys = Object.keys(body || {});
    if (!keys.every((k) => /^p_[a-z_]+$/.test(k))) return [400, { message: 'Bad argument' }];
    const args = keys.map((k, i) => `${k} := $${i + 1}`).join(', ');
    const values = keys.map((k) => {
      const v = body[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role anon');
      const r = await client.query(`select public.${name}(${args}) as out`, values);
      await client.query('commit');
      return [200, r.rows[0].out];
    } catch (err) {
      await client.query('rollback').catch(() => {});
      // PostgREST's shape for a failed call.
      return [err.code === '42501' ? 401 : 400, { code: err.code, message: err.message }];
    } finally {
      client.release();
    }
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

    const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpcMatch && req.method === 'POST') {
      if (offline.value) { req.socket.destroy(); return; }
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', async () => {
        let body;
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = null; }
        const [status, out] = body === null ? [400, { message: 'Bad JSON' }] : await rpc(rpcMatch[1], body);
        if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
        res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      });
      return;
    }

    let file = decodeURIComponent(url.pathname);
    if (file.endsWith('/')) file += 'index.html';
    const full = path.join(ROOT, path.normalize(file));
    if (!full.startsWith(ROOT) || full.includes(`${path.sep}node_modules${path.sep}`)) {
      res.writeHead(403); res.end(); return;
    }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
}

module.exports = { createServer, prepareDatabase };

if (require.main === module) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/et_dev',
  });
  const port = Number(process.env.PORT) || 4400;
  prepareDatabase(pool, process.env.LOAD_SCHEMA === '1')
    .then(() => {
      createServer({ pool, latencyMs: Number(process.env.LATENCY_MS) || 0 }).listen(port, () => {
        console.log(`Event Time Tracker on http://localhost:${port}/?backend=local`);
      });
    })
    .catch((err) => { console.error(err.message); process.exit(1); });
}
