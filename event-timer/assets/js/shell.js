// Shared by every screen: the header, the sync pill, opening an event.
import { liveEvent } from './sync.js';
import { esc, $, prettyCode, syncPill, copyText, qrSvg } from './ui.js';

// ------------------------------------------------------------- header

export function setHeader({ title = 'Event Time Tracker', subtitle = '', back = null } = {}) {
  $('#title').textContent = title;
  $('#subtitle').textContent = subtitle;
  const b = $('#back');
  b.hidden = !back;
  if (back) b.setAttribute('href', back);
  document.title = title === 'Event Time Tracker' ? title : `${title} · Event Time Tracker`;
}

export function setPill(html) {
  $('#pill').innerHTML = html;
}

export function announce(text) {
  const el = $('#announcer');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
}

export function shareUrl(code, suffix = '') {
  const base = location.href.split('#')[0].split('?')[0];
  return `${base}#/e/${code}${suffix}`;
}

export const ERRORS = {
  not_found: 'No event has that code. Check it and try again.',
  wrong_key: 'That code is not right for this event.',
  no_segments: 'Add the program first (the Program tab).',
  current_removed: 'You cannot delete the segment that is on now. Move to another segment first.',
  name_required: 'Give the event a name.',
  busy: 'A lot of events were made in the last hour. Try again in a few minutes.',
  too_many: 'That is more than this app allows in one event.',
  not_configured: 'This site is not connected to its database yet. See SETUP.md.',
  offline: 'Can’t reach the server. Check the internet connection.',
};

export function errorText(code, fallback) {
  return ERRORS[code] || fallback || 'Something went wrong. Try again.';
}

// ------------------------------------------------------------- live wiring

// Opens an event, keeps it in sync, and calls render() whenever it changes and
// tick() four times a second. Returns the clean-up.
export function mountEvent(code, { render, tick, onNotFound }) {
  const live = liveEvent(code).start();
  let lastKey = null;
  let unsub = null;
  let ticker = null;
  const update = () => {
    setPill(syncPill(live));
    if (live.notFound) {
      // Deleted, or never existed: stop showing a stale copy.
      unsub?.();
      clearInterval(ticker);
      live.stop();
      onNotFound?.();
      return;
    }
    const view = live.view();
    if (!view) return;
    const key = `${view.event.status}:${view.event.current_index}`;
    const moved = lastKey !== null && key !== lastKey;
    lastKey = key;
    render(view, live, { moved });
  };
  unsub = live.subscribe(update);
  ticker = setInterval(() => {
    const view = live.view();
    if (view) tick?.(view, live);
  }, 250);
  update();
  return () => {
    unsub();
    clearInterval(ticker);
    live.stop();
  };
}

export function shareDialog(code, name) {
  const dlg = document.getElementById('dialog');
  const url = shareUrl(code);
  dlg.innerHTML = `
    <form method="dialog" class="dialog-body share">
      <h2>Share ${esc(name)}</h2>
      <p class="muted">Anyone with this code or link can follow the program. They cannot change anything.</p>
      <p class="bigcode">${esc(prettyCode(code))}</p>
      ${qrSvg(url)}
      <p class="share-url">${esc(url)}</p>
      <div class="dialog-actions">
        <button type="button" class="btn" id="copyLink">Copy link</button>
        ${navigator.share ? '<button type="button" class="btn" id="nativeShare">Share…</button>' : ''}
        <button value="close" class="btn btn-primary">Done</button>
      </div>
    </form>`;
  $('#copyLink', dlg).addEventListener('click', () => copyText(url, 'Link copied'));
  $('#nativeShare', dlg)?.addEventListener('click', () => {
    navigator.share({ title: name, text: `Follow ${name} live. Event code ${prettyCode(code)}`, url }).catch(() => {});
  });
  dlg.showModal();
}


// "Present", as in Canva: on a computer the presenter view (or the big
// screen) opens in its own window, so this tab keeps Master control. Drag that
// window onto the projector and press its Full screen button. On a phone it
// opens here, in the app, which is already full screen when installed.
export function present(code, view) {
  const hash = `#/e/${code}/${view}`;
  const isPhone = /iphone|ipad|ipod|android/i.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isPhone) {
    const url = `${location.href.split('#')[0]}${hash}`;
    const win = window.open(url, `et-${view}-${code}`, 'popup,width=1280,height=760');
    if (win) { win.focus(); return; }
    // A blocked pop-up: fall back to this tab.
  }
  location.hash = hash;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-present]');
  if (!b) return;
  const m = location.hash.match(/^#\/e\/([A-Za-z0-9]+)/);
  if (m) present(m[1], b.dataset.present);
});

export function goLink(c) {
  const base = location.href.split('#')[0].split('?')[0];
  return `${base}#/go/${c}`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copylink]');
  if (!b) return;
  copyText(goLink(b.dataset.copylink), 'Link copied');
});

// The three kinds of code, each with a link that signs people straight in.
export function linksHtml(code, key, stations) {
  const row = (label, help, c, secret = false) => `
    <li class="link-row${secret ? ' link-secret' : ''}">
      <div>
        <p class="eyebrow">${label}</p>
        <p class="bigcode bigcode-small">${esc(prettyCode(c))}</p>
        <p class="field-help">${help}</p>
      </div>
      <button class="btn btn-small" type="button" data-copylink="${esc(c)}">Copy link</button>
    </li>`;
  return `<ul class="links">
    ${row('Facilitator view · everyone', 'Follow the live program. Changes nothing.', code)}
    ${stations.map((s) => row(`Station control · ${esc(s.name)}`, 'For this station’s facilitators: their buttons.', s.code)).join('')}
    ${key ? row('Master control · keep private', 'Runs the whole program. Only for the admin.', key, true) : ''}
  </ul>`;
}


// Tap the Live / Offline label to refresh this screen now.
document.addEventListener('click', (e) => {
  if (!e.target.closest('#pill .pill')) return;
  window.dispatchEvent(new Event('et-sync-now'));
});
