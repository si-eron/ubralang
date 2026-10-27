// Keeping every phone on the same page.
//
// Two ways news arrives, and either is enough:
//   1. Live push (realtime.js): the database sends the new state to every
//      open screen the moment a change is saved. Typically well under a
//      second from a tap on one phone to every other screen.
//   2. Checking: each open event asks the server "anything new since rev N?"
//      every 2 seconds, or every 10 seconds while live push is connected
//      (then it is only a safety net), and less often while the screen is
//      hidden. The answer is tiny unless something changed. Every answer also carries the server's clock, so each
// phone learns how far its own clock is off and every countdown runs on the
// server's time, not the phone's.
//
// Anything a person does (Next, Full house, …) is first written to this
// phone's storage, stamped with the moment it happened, then uploaded. If the
// upload fails it stays and is tried again; the server is built so that the
// same change arriving twice does nothing the second time.

import { backendUrl, backendKey } from './config.js';
import { realtime } from './realtime.js';

const POLL_VISIBLE_MS = 2000;   // no live push: check this often
const POLL_LIVE_MS = 8000;      // live push connected and proven: checking is only a safety net
const POLL_HIDDEN_MS = 15000;   // screen off or app in the background
const STALE_AFTER_MS = 12000;   // no news for this long → say "Offline"
const STALE_LIVE_MS = 30000;    // …or this long while live push is connected

export class BackendError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export function isConfigured() {
  return Boolean(backendUrl());
}

export async function rpc(fn, args, { timeoutMs = 10000, keepalive = false } = {}) {
  const url = backendUrl();
  if (!url) throw new BackendError('not_configured', 'This site is not connected to a database yet.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: backendKey(),
        Authorization: `Bearer ${backendKey()}`,
      },
      body: JSON.stringify(args),
      signal: ctrl.signal,
      keepalive, // lets a last message out while the page is closing
      cache: 'no-store',
    });
  } catch {
    throw new BackendError('offline', 'Can’t reach the server.');
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try { body = await res.json(); } catch { /* fall through */ }
  if (!res.ok) {
    // PostgREST error: the request arrived, so retrying will not help.
    throw new BackendError('server', (body && body.message) || `Server answered ${res.status}`);
  }
  return body;
}

// ------------------------------------------------------------ the store

const memory = new Map();
const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return memory.has(key) ? memory.get(key) : fallback;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: memory only */ }
  },
};
export { storage };

// ------------------------------------------------------------ live event

export class LiveEvent {
  constructor(code) {
    this.code = code;
    this.snapshot = storage.get(`et.snap.${code}`, null);
    this.rev = this.snapshot ? this.snapshot.rev : 0;
    this.offset = storage.get('et.clockOffset', 0); // server minus phone, ms
    this.samples = [];
    this.lastOkAt = 0;
    this.lastError = null;
    this.notFound = false;
    this.listeners = new Set();
    this.timer = null;
    this.inflight = false;
    this.results = new Map();
    this.flushChain = null;
    this.stopped = true;
    this.outboxKey = `et.outbox.${code}`;
    this.onVisible = () => this.pollSoon();
    this.onOnline = () => this.pollSoon();
    this.pushLive = false;
    // Connected is not the same as working. Push is trusted (and checking
    // slows down) only once a pushed change has actually arrived, and stops
    // being trusted the moment a check finds a change that push missed.
    this.pushTrusted = false;
    this.lowerRevSeen = 0;
    this.unsubPush = null;
    this.onSyncNow = () => { realtime().ensure(); this.pollSoon(0); };
  }

  // Live push: the whole new state, the moment it is saved.
  onPush(msg) {
    if (msg && msg.presence) { this.presence = msg.presence; this.emit(); return; }
    if (msg && msg.deleted) { this.pollSoon(0); return; } // ask, and learn it is gone
    if (!msg || typeof msg.rev !== 'number') return;
    this.lastOkAt = Date.now();
    this.pushTrusted = true;
    if (msg.rev <= this.rev) return;
    if (msg.snapshot && msg.snapshot.event) {
      this.accept(msg.snapshot);
      this.emit();
    } else {
      this.pollSoon(0); // told something changed, but not what: ask now
    }
  }

  onPushStatus(joined) {
    this.pushLive = joined;
    // Just connected (or back after a drop): catch up on anything missed.
    if (joined) {
      this.pollSoon(0);
    } else {
      // Lost it: go back to checking every 2 seconds until it returns.
      if (!this.inflight) this.pollSoon(POLL_VISIBLE_MS);
      this.emit();
    }
  }

  start() {
    if (!this.stopped) return this;
    this.stopped = false;
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('focus', this.onVisible);
    window.addEventListener('et-sync-now', this.onSyncNow);
    this.unsubPush = realtime().subscribe(`et:${this.code}`, (m) => this.onPush(m), (j) => this.onPushStatus(j));
    this.pollSoon();
    return this;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('focus', this.onVisible);
    window.removeEventListener('et-sync-now', this.onSyncNow);
    this.unsubPush?.();
    this.unsubPush = null;
    this.pushLive = false;
    this.pushTrusted = false;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  now() {
    return Date.now() + this.offset;
  }

  // ok | waiting | offline | error | connecting
  get health() {
    const pending = this.outbox().length;
    if (this.notFound) return 'error';
    if (!this.lastOkAt) return this.lastError ? 'offline' : 'connecting';
    const stale = this.pushLive ? STALE_LIVE_MS : STALE_AFTER_MS;
    // A send or check that just failed means offline, live link or not.
    if (Date.now() - this.lastOkAt > stale || this.lastError === 'offline') return 'offline';
    if (pending) return 'waiting';
    return 'ok';
  }

  pollSoon(delay = 0) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.poll(), delay);
  }

  async poll() {
    if (this.stopped || this.inflight) return;
    this.inflight = true;
    try {
      await this.flush();
      const t0 = Date.now();
      const res = await rpc('et_state', { p_code: this.code, p_since: this.rev });
      const t1 = Date.now();
      this.learnClock(res.now, t0, t1);
      this.lastError = null;
      if (!res.ok) {
        if (res.error === 'not_found') this.notFound = true;
        this.lastError = res.error;
      } else {
        this.notFound = false;
        this.lastOkAt = Date.now();
        if (res.changed) {
          // A change from someone else that live push did not bring: push is
          // not working for this phone, so check every 2 seconds instead.
          if (this.pushLive && res.rev > this.rev && this.snapshot) this.pushTrusted = false;
          this.accept(res, { fromCheck: true });
        }
      }
    } catch (err) {
      this.lastError = err.code || 'offline';
    } finally {
      this.inflight = false;
      this.emit();
      if (!this.stopped) {
        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        // A little jitter so a room full of phones does not ask in lockstep.
        // Something waiting to upload, or no live link: every 2 seconds.
        const waiting = this.outbox().length > 0 || this.lastError === 'offline';
        const base = hidden ? POLL_HIDDEN_MS : this.pushLive && this.pushTrusted && !waiting ? POLL_LIVE_MS : POLL_VISIBLE_MS;
        this.pollSoon(base + Math.random() * 400);
      }
    }
  }

  // The answer that took least time on the wire says most about the clock.
  learnClock(serverNow, t0, t1) {
    if (typeof serverNow !== 'number') return;
    this.samples.push({ rtt: t1 - t0, offset: serverNow - (t0 + t1) / 2, at: t1 });
    this.samples = this.samples.filter((s) => t1 - s.at < 5 * 60_000).slice(-12);
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = Math.round(best.offset);
    storage.set('et.clockOffset', this.offset);
  }

  accept(snapshot, { fromCheck = false } = {}) {
    if (!snapshot || !snapshot.event) return;
    if (this.snapshot && snapshot.rev < this.rev) {
      // Usually an older answer arriving late: ignore it. But if the server
      // keeps saying a lower number (its data was reset or restored), the
      // server is right and this phone's copy is what is out of date.
      if (!fromCheck || ++this.lowerRevSeen < 2) return;
    }
    this.lowerRevSeen = 0;
    const clean = { ...snapshot };
    delete clean.key;
    delete clean.codes;
    delete clean.code;
    this.snapshot = clean;
    this.rev = snapshot.rev;
    storage.set(`et.snap.${this.code}`, clean);
  }

  // What the screens draw: the server's snapshot with this phone's
  // not-yet-uploaded station changes laid on top, so a tap shows at once.
  view() {
    if (!this.snapshot) return null;
    const pending = this.outbox().filter((a) => a.fn === 'et_station');
    if (!pending.length) return this.presence ? { ...this.snapshot, presence: this.presence } : this.snapshot;
    const stations = this.snapshot.stations.map((s) => {
      let out = s;
      for (const a of pending) {
        if (a.args.p_station !== s.id) continue;
        const p = a.args.p_patch;
        out = { ...out };
        if ('phase_index' in p && p.phase_index !== out.phase_index) {
          out.phase_index = p.phase_index;
          out.phase_started_at = p.at;
        }
        if ('crowd' in p) out.crowd = p.crowd;
        if ('note' in p) out.note = p.note;
        if ('by' in p) out.updated_by = p.by;
        out.updated_at = p.at;
        out.pending = true;
      }
      return out;
    });
    return { ...this.snapshot, stations, presence: this.presence };
  }

  // ---------------------------------------------------------- who is online

  // While this screen is open and on screen, say "I'm here" every 15 seconds.
  // Closed or put in the background: say "I've left" at once. Each answer, and
  // each live push, brings the counts for everyone.
  startPresence({ role, key = null, device }) {
    // Moving to another screen of this event: no "left", just the new role.
    clearTimeout(this.pendingLeave);
    this.stopPresence(false);
    this.here = { role, key, device };
    const beat = () => {
      if (!this.here || document.visibilityState !== 'visible') return;
      rpc('et_here', { p_code: this.code, p_device: device, p_role: role, p_key: key })
        .then((res) => { if (res && res.ok && res.presence) { this.presence = res.presence; this.emit(); } })
        .catch(() => {});
    };
    const leave = () => {
      if (!this.here) return;
      rpc('et_here', { p_code: this.code, p_device: device, p_role: role, p_key: key, p_leave: true }, { keepalive: true })
        .catch(() => {});
    };
    this.onHereVisibility = () => (document.visibilityState === 'visible' ? beat() : leave());
    this.onHereHide = () => leave();
    this.hereLeave = leave;
    document.addEventListener('visibilitychange', this.onHereVisibility);
    window.addEventListener('pagehide', this.onHereHide);
    this.hereTimer = setInterval(beat, 15000);
    beat();
  }

  stopPresence(sendLeave = true) {
    if (!this.here) return;
    // Leave a moment later, unless another screen of this event opens first.
    if (sendLeave) { const leave = this.hereLeave; this.pendingLeave = setTimeout(() => leave?.(), 400); }
    clearInterval(this.hereTimer);
    document.removeEventListener('visibilitychange', this.onHereVisibility);
    window.removeEventListener('pagehide', this.onHereHide);
    this.here = null;
  }

  // ---------------------------------------------------------- outbox

  outbox() {
    return storage.get(this.outboxKey, []);
  }

  saveOutbox(list) {
    storage.set(this.outboxKey, list);
  }

  // Queue a change and try to send it now. Resolves with the server's answer,
  // or with { queued: true } when there is no connection (it will go later).
  async send(fn, args) {
    const action = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      fn,
      args: { ...args },
    };
    // Stamp the moment, on the server's clock.
    const at = Math.round(this.now());
    if (fn === 'et_admin') action.args.p_args = { ...(args.p_args || {}), at };
    if (fn === 'et_station') action.args.p_patch = { ...(args.p_patch || {}), at };
    this.saveOutbox([...this.outbox(), action]);
    this.emit();
    await this.flush();
    const res = this.results.get(action.id);
    this.results.delete(action.id);
    return res || { queued: true };
  }

  flush() {
    // One upload at a time, in order. A change queued while an upload is
    // running waits for it, then goes in the next pass.
    const run = (this.flushChain || Promise.resolve()).then(() => this.drain());
    this.flushChain = run.catch(() => {});
    return run;
  }

  async drain() {
    for (;;) {
      const [action] = this.outbox();
      if (!action) break;
      let res;
      try {
        const t0 = Date.now();
        res = await rpc(action.fn, action.args);
        this.learnClock(res && res.now, t0, Date.now());
        this.lastOkAt = Date.now();
        this.lastError = null;
      } catch (err) {
        if (err.code === 'offline') {
          this.lastError = 'offline';
          break; // keep it; try again on the next poll
        }
        res = { ok: false, error: 'server', message: err.message };
      }
      // Delivered (accepted, refused, or already done): it leaves the queue.
      this.saveOutbox(this.outbox().filter((a) => a.id !== action.id));
      if (res && res.ok && res.event) this.accept(res);
      this.results.set(action.id, res);
      if (this.results.size > 50) this.results.delete(this.results.keys().next().value);
      if (res && res.ok === false) this.lastRefusal = { action, res, at: Date.now() };
    }
    this.emit();
    return this.results;
  }

  // Changes that need an answer straight away (editing, codes) go directly,
  // not through the outbox; they need a connection and say so if there is none.
  async call(fn, args) {
    const t0 = Date.now();
    const res = await rpc(fn, args);
    this.learnClock(res && res.now, t0, Date.now());
    this.lastOkAt = Date.now();
    this.lastError = null;
    if (res && res.ok && res.event) this.accept(res);
    this.emit();
    return res;
  }
}

// One LiveEvent per code for the whole page.
const live = new Map();
export function liveEvent(code) {
  if (!live.has(code)) live.set(code, new LiveEvent(code));
  return live.get(code);
}
