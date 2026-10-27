// Small shared pieces of the interface.
import qrcode from '../vendor/qrcode.js'; // qrcode-generator 2.0.4, MIT, Kazuhiko Arase

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// "K7Q2MX" → "K7Q-2MX", "ABCDEFGH" → "ABCD-EFGH": easier to read aloud.
export function prettyCode(code) {
  const c = String(code || '');
  if (c.length === 6) return `${c.slice(0, 3)}-${c.slice(3)}`;
  if (c.length === 8) return `${c.slice(0, 4)}-${c.slice(4)}`;
  return c;
}

export function normCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ------------------------------------------------------------- toast

let toastTimer = null;
export function toast(message, tone = 'info', ms = 3500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); el.hidden = true; }, ms);
}

// ------------------------------------------------------------- dialog

export function confirmDialog({ title, body = '', confirm = 'OK', cancel = 'Cancel', danger = false }) {
  const dlg = document.getElementById('dialog');
  if (!dlg || typeof dlg.showModal !== 'function') {
    return Promise.resolve(window.confirm(`${title}\n\n${body}`));
  }
  dlg.innerHTML = `
    <form method="dialog" class="dialog-body">
      <h2>${esc(title)}</h2>
      ${body ? `<p>${esc(body)}</p>` : ''}
      <div class="dialog-actions">
        <button value="cancel" class="btn">${esc(cancel)}</button>
        <button value="ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" autofocus>${esc(confirm)}</button>
      </div>
    </form>`;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}

// ------------------------------------------------------------- sync pill

const PILL = {
  ok: ['ok', 'Live'],
  waiting: ['warn', 'Sending…'],
  offline: ['warn', 'Offline'],
  connecting: ['muted', 'Connecting…'],
  error: ['bad', 'Not found'],
};

export function syncPill(live) {
  const [tone, label] = PILL[live.health] || PILL.connecting;
  const pending = live.outbox().length;
  let detail = '';
  if (live.health === 'offline') {
    detail = live.lastOkAt
      ? `Last synced ${new Date(live.lastOkAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Can’t reach the server';
    if (pending) detail += ` · ${pending} change${pending > 1 ? 's' : ''} saved here`;
  } else if (live.health === 'waiting') {
    detail = `${pending} change${pending > 1 ? 's' : ''} uploading`;
  } else if (live.health === 'ok') {
    detail = 'In sync with every screen';
  }
  return `<span class="pill pill-${tone}" title="${esc(detail ? `${detail} · tap to refresh` : "Tap to refresh")}" role="status">
    <span class="dot" aria-hidden="true"></span>${esc(label)}${detail && live.health !== 'ok' ? `<span class="pill-detail"> · ${esc(detail)}</span>` : ''}
  </span>`;
}

// ------------------------------------------------------------- crowd

export const CROWD = {
  open: { label: 'Open', long: 'Open · room available', tone: 'ok' },
  filling: { label: 'Filling up', long: 'Filling up', tone: 'warn' },
  full: { label: 'Full house', long: 'Full house', tone: 'bad' },
  closed: { label: 'Closed', long: 'Closed', tone: 'muted' },
};

// ------------------------------------------------------------- copy, QR

export async function copyText(text, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, 'ok', 1800);
  } catch {
    window.prompt('Copy this:', text);
  }
}

export function qrSvg(text, cell = 6) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 4;
  const size = (n + margin * 2) * cell;
  let path = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (qr.isDark(r, c)) path += `M${(c + margin) * cell} ${(r + margin) * cell}h${cell}v${cell}h-${cell}z`;
    }
  }
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code for ${esc(text)}">
    <rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// ------------------------------------------------------------- keep screen on

let wakeLock = null;
let wantWake = false;
async function acquire() {
  try {
    if (wantWake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* not allowed here; fine */ }
}
document.addEventListener('visibilitychange', () => { if (wantWake) acquire(); });
export function keepAwake(on) {
  wantWake = on;
  if (on) acquire();
  else if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}

export function ago(ms, now) {
  if (ms == null) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
}
