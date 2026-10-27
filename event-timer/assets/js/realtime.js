// Live push from the database (Supabase Realtime), so a change reaches every
// screen the moment it is saved instead of at the next check.
//
// One websocket per page, speaking the small part of the Phoenix protocol
// that Realtime uses: join a public topic, keep the line alive with a
// heartbeat, receive broadcasts. If the socket drops it reconnects by itself,
// quickly at first and then less often. Nothing depends on it: when it is
// down, the regular checks in sync.js carry on as before, just more often.
import { backendUrl, backendKey } from './config.js';

const HEARTBEAT_MS = 25_000;

class RealtimeLink {
  constructor() {
    this.ws = null;
    this.ref = 0;
    this.topics = new Map(); // topic -> { onMessage, onStatus, joined }
    this.retry = 0;
    this.timer = null;
    this.heartbeat = null;
    this.lastHeard = 0;
    window.addEventListener('online', () => this.connectSoon(0));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.topics.size) this.ensure();
    });
  }

  url() {
    const base = backendUrl();
    if (!base) return null;
    const ws = base.replace(/^http/, 'ws');
    return `${ws}/realtime/v1/websocket?apikey=${encodeURIComponent(backendKey())}&vsn=1.0.0`;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  nextRef() {
    this.ref += 1;
    return String(this.ref);
  }

  // A socket that went quiet (a phone waking from sleep) is treated as gone.
  ensure() {
    if (!this.ws || this.ws.readyState > 1 || Date.now() - this.lastHeard > HEARTBEAT_MS * 2.2) {
      this.reconnect();
    }
  }

  connectSoon(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  reconnect() {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.connectSoon(0);
  }

  connect() {
    const url = this.url();
    if (!url || !this.topics.size || typeof WebSocket === 'undefined') return;
    if (this.ws && this.ws.readyState <= 1) return;
    let ws;
    try { ws = new WebSocket(url); } catch { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.lastHeard = Date.now();
      for (const topic of this.topics.keys()) this.join(topic);
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        this.send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.nextRef() });
        if (Date.now() - this.lastHeard > HEARTBEAT_MS * 2.2) this.reconnect();
      }, HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      this.lastHeard = Date.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const t = this.topics.get(msg.topic);
      if (!t) return;
      if (msg.event === 'phx_reply' && msg.payload && msg.ref === t.joinRef) {
        t.joined = msg.payload.status === 'ok';
        t.onStatus(t.joined);
      } else if (msg.event === 'broadcast' && msg.payload) {
        t.onMessage(msg.payload.payload || msg.payload);
      } else if (msg.event === 'phx_error' || msg.event === 'phx_close') {
        t.joined = false;
        t.onStatus(false);
      }
    };
    ws.onclose = () => {
      clearInterval(this.heartbeat);
      for (const t of this.topics.values()) {
        if (t.joined) { t.joined = false; t.onStatus(false); }
      }
      // Only the current socket retries; one replaced on purpose just goes.
      if (this.ws === ws) {
        this.ws = null;
        this.scheduleRetry();
      }
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  scheduleRetry() {
    if (!this.topics.size) return;
    this.retry += 1;
    // 0.5 s, 1 s, 2 s, 4 s … up to 15 s, with a little jitter.
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.retry - 1, 5)) + Math.random() * 300;
    this.connectSoon(delay);
  }

  join(topic) {
    const t = this.topics.get(topic);
    if (!t) return;
    t.joinRef = this.nextRef();
    this.send({
      topic,
      event: 'phx_join',
      payload: {
        config: { broadcast: { self: false, ack: false }, presence: { key: '' }, postgres_changes: [], private: false },
      },
      ref: t.joinRef,
      join_ref: t.joinRef,
    });
  }

  subscribe(name, onMessage, onStatus) {
    const topic = `realtime:${name}`;
    this.topics.set(topic, { onMessage, onStatus, joined: false, joinRef: null });
    if (this.ws && this.ws.readyState === 1) this.join(topic);
    else this.connect();
    return () => {
      const t = this.topics.get(topic);
      this.topics.delete(topic);
      if (t && this.ws && this.ws.readyState === 1) {
        this.send({ topic, event: 'phx_leave', payload: {}, ref: this.nextRef(), join_ref: t.joinRef });
      }
      if (!this.topics.size) {
        clearTimeout(this.timer);
        clearInterval(this.heartbeat);
        try { this.ws?.close(); } catch { /* ignore */ }
        this.ws = null;
      }
    };
  }
}

let link = null;
export function realtime() {
  if (!link) link = new RealtimeLink();
  return link;
}
