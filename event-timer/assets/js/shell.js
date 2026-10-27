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

