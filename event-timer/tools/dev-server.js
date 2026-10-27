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
const { WebSocketServer } = require('ws');

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

// Supabase Realtime, as far as this app uses it: the Phoenix websocket at
// /realtime/v1/websocket, joining public "realtime:et:<code>" topics, and
// broadcasts. The database's NOTIFY (see et_publish in schema.sql) becomes
// the same "state" broadcast Supabase would send, with the full snapshot.
async function attachRealtime(server, pool, offline = { value: false }) {
  const wss = new WebSocketServer({ server, path: '/realtime/v1/websocket' });
  const topics = new Map(); // topic -> Set(ws)
  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  wss.on('connection', (ws) => {
    if (offline.value) { ws.terminate(); return; }
    ws.joined = new Set();
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.event === 'heartbeat') {
        send(ws, { topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: msg.ref });
      } else if (msg.event === 'phx_join') {
        if (!topics.has(msg.topic)) topics.set(msg.topic, new Set());
        topics.get(msg.topic).add(ws);
        ws.joined.add(msg.topic);
        send(ws, { topic: msg.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: msg.ref, join_ref: msg.join_ref });
      } else if (msg.event === 'phx_leave') {
        topics.get(msg.topic)?.delete(ws);
        ws.joined.delete(msg.topic);
      }
    });
    ws.on('close', () => { for (const t of ws.joined) topics.get(t)?.delete(ws); });
  });

  const listener = await pool.connect();
  await listener.query('LISTEN et_broadcast');
  listener.on('notification', async (n) => {
    let note;
    try { note = JSON.parse(n.payload); } catch { return; }
    const topic = `realtime:et:${note.code}`;
    const subs = topics.get(topic);
    if (!subs || !subs.size) return;
    if (note.deleted) {
      for (const ws of subs) send(ws, { topic, event: 'broadcast', payload: { type: 'broadcast', event: 'state', payload: { deleted: true } }, ref: null });
      return;
    }
    const r = await pool.query('select public.et_state($1, 0) as s', [note.code]).catch(() => null);
    if (!r) return;
    const payload = { type: 'broadcast', event: 'state', payload: { rev: note.rev, snapshot: r.rows[0].s } };
    for (const ws of subs) send(ws, { topic, event: 'broadcast', payload, ref: null });
  });

  return {
    dropAll() { for (const ws of wss.clients) ws.terminate(); },
    async close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await listener.query('UNLISTEN et_broadcast').catch(() => {});
      listener.release();
    },
  };
}

module.exports = { createServer, prepareDatabase, attachRealtime };

if (require.main === module) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/et_dev',
  });
  const port = Number(process.env.PORT) || 4400;
  prepareDatabase(pool, process.env.LOAD_SCHEMA === '1')
    .then(() => {
      const server = createServer({ pool, latencyMs: Number(process.env.LATENCY_MS) || 0 });
      return attachRealtime(server, pool).then(() => server.listen(port, () => {
        console.log(`Event Time Tracker on http://localhost:${port}/?backend=local`);
      }));
    })
    .catch((err) => { console.error(err.message); process.exit(1); });
}
