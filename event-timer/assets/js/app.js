// The page: which screen to show, and the screens anyone can open.
import { liveEvent, rpc, isConfigured } from './sync.js';
import { esc, $, $$, toast, prettyCode, normCode, copyText, vibrate } from './ui.js';
import { setHeader, setPill, announce, errorText, mountEvent, shareDialog } from './shell.js';
import { heroHtml, messageHtml, programHtml, stationsBoardHtml, logHtml } from './components.js';
import { recentEvents, rememberEvent, forgetEvent, adminKey, setAdminKey, stationAccess, setStationAccess } from './store.js';
import { adminView } from './admin.js';
import { stationView } from './station.js';
import { stageView } from './stage.js';

const app = document.getElementById('app');
// ------------------------------------------------------------- home

function homeView(root) {
  setHeader();
  setPill('');
  const recent = recentEvents();
  root.innerHTML = `
    <div class="page page-home">
      <section class="intro">
        <h1>Run the program. Everyone sees it.</h1>
        <p class="lede">One person moves the program along; every phone and screen shows what is on now, how long is left, and what is next. Stations post where they are and whether they are full.</p>
      </section>

      ${isConfigured() ? '' : `<div class="notice notice-warn"><strong>Not connected yet.</strong> This copy of the site has no database. Follow SETUP.md (free, about ten minutes) and fill in assets/js/config.js.</div>`}

      <form class="card join" id="joinForm" autocomplete="off">
        <label for="joinCode" class="card-title">Join an event</label>
        <p class="muted">Type the event code you were given.</p>
        <div class="join-row">
          <input id="joinCode" name="code" inputmode="text" autocapitalize="characters" spellcheck="false"
                 placeholder="ABC-123" maxlength="9" required aria-describedby="joinHelp">
          <button class="btn btn-primary" type="submit">Join</button>
        </div>
        <p class="field-help" id="joinHelp">Six letters and numbers. Dashes and spaces don’t matter.</p>
      </form>

      ${recent.length ? `<section class="card">
        <h2 class="card-title">Your events</h2>
        <ul class="recent">${recent.map((e) => `
          <li>
            <a href="#/e/${esc(e.code)}" class="recent-link">
              <span class="recent-name">${esc(e.name)}</span>
              <span class="muted">${esc(prettyCode(e.code))}${adminKey(e.code) ? ' · <span class="chip chip-live">Admin</span>' : ''}${stationAccess(e.code) ? ' · <span class="chip chip-muted">Station</span>' : ''}</span>
            </a>
            <button class="btn btn-ghost btn-small" data-forget="${esc(e.code)}" aria-label="Remove ${esc(e.name)} from this list">Remove</button>
          </li>`).join('')}
        </ul>
      </section>` : ''}

      <section class="card">
        <h2 class="card-title">Running an event?</h2>
        <p class="muted">Make the event, add the program, and share the code. You become its master admin.</p>
        <a class="btn btn-primary btn-block" href="#/new">Create an event</a>
      </section>

      <section class="card install" id="installCard">
        <h2 class="card-title">Put it on your home screen</h2>
        <p class="muted" id="installText">It opens like an app, full screen, and keeps the last thing it showed if the signal drops.</p>
        <button class="btn btn-block" id="installBtn" hidden>Install the app</button>
      </section>
    </div>`;

  $('#joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normCode($('#joinCode').value);
    if (code.length < 4) { toast('Type the whole event code.', 'warn'); return; }
    const btn = e.submitter || $('#joinForm button');
    btn.disabled = true;
    try {
      const res = await rpc('et_state', { p_code: code, p_since: 0 });
      if (!res.ok) { toast(errorText(res.error), 'bad'); return; }
      rememberEvent(code, res.event.name);
      location.hash = `#/e/${code}`;
    } catch (err) {
      toast(errorText(err.code, err.message), 'bad');
    } finally {
      btn.disabled = false;
    }
  });

  $$('[data-forget]', root).forEach((b) => b.addEventListener('click', () => {
    forgetEvent(b.dataset.forget);
    homeView(root);
  }));

  setupInstall();
}

// ------------------------------------------------------------- install

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  setupInstall();
});

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function setupInstall() {
  const card = $('#installCard');
  if (!card) return;
  if (isStandalone()) { card.hidden = true; return; }
  const btn = $('#installBtn');
  const text = $('#installText');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (deferredPrompt) {
    btn.hidden = false;
    btn.onclick = async () => {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      btn.hidden = true;
    };
  } else if (ios) {
    text.innerHTML = 'On iPhone or iPad: open this page in <strong>Safari</strong>, tap <strong>Share</strong> <span aria-hidden="true">(the square with an arrow)</span>, then <strong>Add to Home Screen</strong>.';
  } else {
    text.innerHTML = 'On Android: open the browser menu <span aria-hidden="true">(⋮)</span> and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. On a computer, look for the install icon in the address bar.';
  }
}

// ------------------------------------------------------------- create

function createView(root) {
  setHeader({ title: 'New event', back: '#/' });
  setPill('');
  root.innerHTML = `
    <div class="page">
      <form class="card form" id="createForm">
        <h1 class="card-title">Create an event</h1>
        <label class="field"><span>Event name</span>
          <input name="name" required maxlength="120" placeholder="e.g. Leadership Summit 2026" autocomplete="off"></label>
        <label class="field"><span>Venue <em>(optional)</em></span>
          <input name="venue" maxlength="120" placeholder="e.g. FCU Gymnasium" autocomplete="off"></label>
        <fieldset class="field">
          <legend>Planned start <em>(optional)</em></legend>
          <p class="field-help">Lets everyone see whether the program is on time, ahead, or behind.</p>
          <div class="row">
            <input type="date" name="date" aria-label="Date">
            <input type="time" name="time" aria-label="Time">
          </div>
        </fieldset>
        <label class="check"><input type="checkbox" name="stations"> <span><strong>Use Station Mode</strong><br><span class="muted">Each station runs its own program (students entering, guest speaker intro, session, students exit). Its facilitators post where they are and whether they are full.</span></span></label>
        <button class="btn btn-primary btn-block" type="submit">Create event</button>
      </form>
    </div>`;

  $('#createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      const res = await rpc('et_create', { p_name: f.get('name'), p_venue: f.get('venue') || '' });
      if (!res.ok) { toast(errorText(res.error), 'bad'); return; }
      const { code, key } = res;
      setAdminKey(code, key);
      rememberEvent(code, res.event.name);
      const settings = {};
      if (f.get('date') && f.get('time')) settings.planned_start = new Date(`${f.get('date')}T${f.get('time')}`).getTime();
      if (f.get('stations')) settings.stations_enabled = true;
      if (Object.keys(settings).length) {
        await rpc('et_admin', { p_code: code, p_key: key, p_action: 'event', p_args: settings }).catch(() => null);
      }
      keyView(root, code, key, res.event.name);
    } catch (err) {
      toast(errorText(err.code, err.message), 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create event';
    }
  });
}

function keyView(root, code, key, name) {
  setHeader({ title: name, subtitle: 'Created' });
  root.innerHTML = `
    <div class="page">
      <section class="card keycard">
        <h1 class="card-title">Your event is ready</h1>
        <div class="code-pair">
          <div>
            <p class="eyebrow">Event code: share it</p>
            <p class="bigcode">${esc(prettyCode(code))}</p>
          </div>
          <div>
            <p class="eyebrow">Admin key: keep it private</p>
            <p class="bigcode bigcode-secret">${esc(prettyCode(key))}</p>
          </div>
        </div>
        <p>This phone is now the master admin. <strong>Write the admin key down</strong>: it is the only way to control this event from another device, and it is shown here only once (you can see it again on this phone under Share).</p>
        <div class="row">
          <button class="btn" id="copyKey">Copy admin key</button>
          <a class="btn btn-primary" href="#/e/${esc(code)}/admin/program">Add the program</a>
        </div>
      </section>
    </div>`;
  $('#copyKey').addEventListener('click', () => copyText(prettyCode(key), 'Admin key copied'));
}

// ------------------------------------------------------------- join as staff

function joinView(root, code, presetKey) {
  setHeader({ title: 'Facilitator sign-in', subtitle: prettyCode(code), back: `#/e/${code}` });
  setPill('');
  root.innerHTML = `
    <div class="page">
      <form class="card form" id="roleForm" autocomplete="off">
        <h1 class="card-title">Facilitating a station?</h1>
        <p class="muted">Type the <strong>facilitator code</strong> for your station. Facilitators are the ones who update their station: which part of its program it is on, and whether it is full. (The master admin types the <strong>admin key</strong> here.)</p>
        <label class="field"><span>Facilitator code or admin key</span>
          <input name="key" required autocapitalize="characters" spellcheck="false" maxlength="12" value="${esc(presetKey || '')}"></label>
        <button class="btn btn-primary btn-block" type="submit">Continue</button>
        <p class="field-help">Just watching? You don’t need a code. <a href="#/e/${esc(code)}">Go to the event</a>.</p>
      </form>
    </div>`;
  const form = $('#roleForm');
  const submit = async () => {
    const key = normCode(form.key.value);
    if (!key) return;
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const res = await rpc('et_role', { p_code: code, p_key: key });
      if (!res.ok) { toast(errorText(res.error), 'bad'); return; }
      if (res.role === 'admin') {
        setAdminKey(code, key);
        location.hash = `#/e/${code}/admin`;
      } else {
        setStationAccess(code, { id: res.station, key });
        location.hash = `#/e/${code}/station`;
      }
    } catch (err) {
      toast(errorText(err.code, err.message), 'bad');
    } finally {
      btn.disabled = false;
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  if (presetKey) submit();
}

// ------------------------------------------------------------- everyone's view

function eventView(root, code) {
  setHeader({ title: 'Loading…', subtitle: prettyCode(code), back: '#/' });
  let tab = sessionStorage.getItem(`et.tab.${code}`) || 'program';
  let filter = null;
  root.innerHTML = `
    <div class="page page-event">
      <div id="msg"></div>
      <div id="hero"></div>
      <p class="legend" aria-label="What the colours mean"><span style="--c: var(--orange)">Orange: almost time</span><span style="--c: var(--red)">Red: over time</span></p>
      <div class="tabs" role="tablist" id="tabs"></div>
      <div id="panel" role="tabpanel"></div>
      <nav class="actions" id="actions" aria-label="More"></nav>
    </div>`;

  let rememberedName = null;
  let lastPanelAt = 0;

  const drawPanel = (view, live) => {
    const now = live.now();
    const stations = view.event.stations_enabled && view.stations.length;
    if (tab === 'stations' && !stations) tab = 'program';
    $('#tabs').innerHTML = [
      ['program', 'Program'],
      ...(stations ? [['stations', 'Stations']] : []),
      ['activity', 'Updates'],
    ].map(([id, label]) => `<button role="tab" data-tab="${id}" aria-selected="${tab === id}">${label}</button>`).join('');
    const panel = $('#panel');
    if (tab === 'program') panel.innerHTML = programHtml(view, now);
    if (tab === 'stations') {
      panel.innerHTML = stationsBoardHtml(view, now, { mine: stationAccess(code)?.id, filter });
      $$('[data-filter]', panel).forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
      });
    }
    if (tab === 'activity') panel.innerHTML = logHtml(view);
    lastPanelAt = Date.now();
  };

  const cleanup = mountEvent(code, {
    onNotFound() {
      setHeader({ title: 'Not found', back: '#/' });
      root.innerHTML = `<div class="page"><div class="card"><h1 class="card-title">No event with code ${esc(prettyCode(code))}</h1>
        <p class="muted">It may have been deleted, or the code is mistyped.</p>
        <div class="row"><a class="btn btn-primary" href="#/">Back</a><button class="btn" id="forget">Remove from my list</button></div></div></div>`;
      $('#forget').addEventListener('click', () => { forgetEvent(code); location.hash = '#/'; });
    },
    render(view, live, { moved }) {
      const ev = view.event;
      setHeader({ title: ev.name, subtitle: [ev.venue, `Code ${prettyCode(code)}`].filter(Boolean).join(' · '), back: '#/' });
      if (rememberedName !== ev.name) { rememberEvent(code, ev.name); rememberedName = ev.name; }
      $('#msg').innerHTML = messageHtml(view);
      $('#hero').innerHTML = heroHtml(view, live.now());
      if (moved) {
        $('#hero .hero')?.classList.add('flash');
        const seg = view.segments[ev.current_index];
        announce(ev.status === 'ended' ? 'Program ended' : seg ? `Now: ${seg.title}` : '');
      }
      drawPanel(view, live);
      const isAdmin = Boolean(adminKey(code));
      const station = stationAccess(code);
      $('#actions').innerHTML = `
        ${isAdmin ? `<a class="btn btn-primary" href="#/e/${esc(code)}/admin">Master control</a>` : ''}
        ${station ? `<a class="btn btn-primary" href="#/e/${esc(code)}/station">My station</a>` : ''}
        <a class="btn" href="#/e/${esc(code)}/stage">Big screen</a>
        <button class="btn" id="share">Share</button>
        ${isAdmin || station ? '' : `<a class="btn btn-ghost" href="#/e/${esc(code)}/join">I’m a facilitator</a>`}`;
      $('#share').onclick = () => shareDialog(code, ev.name);
    },
    tick(view, live) {
      $('#hero').innerHTML = heroHtml(view, live.now());
      if (Date.now() - lastPanelAt > 15000) drawPanel(view, live);
    },
  });

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      sessionStorage.setItem(`et.tab.${code}`, tab);
      const live = liveEvent(code);
      if (live.view()) drawPanel(live.view(), live);
      return;
    }
    const f = e.target.closest('[data-filter]');
    if (f) {
      filter = filter === f.dataset.filter ? null : f.dataset.filter;
      const live = liveEvent(code);
      if (live.view()) drawPanel(live.view(), live);
    }
  });

  return cleanup;
}

// ------------------------------------------------------------- router

const routes = [
  [/^#?\/?$/, (root) => homeView(root)],
  [/^#\/new$/, (root) => createView(root)],
  [/^#\/e\/([A-Za-z0-9]+)$/, (root, code) => eventView(root, normCode(code))],
  [/^#\/e\/([A-Za-z0-9]+)\/join(?:\/([A-Za-z0-9-]+))?$/, (root, code, key) => joinView(root, normCode(code), key)],
  [/^#\/e\/([A-Za-z0-9]+)\/admin(?:\/([a-z]+))?$/, (root, code, tab) => adminView(root, normCode(code), tab)],
  [/^#\/e\/([A-Za-z0-9]+)\/station$/, (root, code) => stationView(root, normCode(code))],
  [/^#\/e\/([A-Za-z0-9]+)\/stage$/, (root, code) => stageView(root, normCode(code))],
];

let cleanup = null;
function route() {
  // Links like ?e=ABC123 (easy to type, or from a QR made elsewhere).
  const params = new URLSearchParams(location.search);
  if (params.get('e') && !location.hash) {
    location.replace(`#/e/${normCode(params.get('e'))}`);
    return;
  }
  const hash = location.hash || '#/';
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    if (cleanup) { try { cleanup(); } catch { /* ignore */ } }
    document.body.className = '';
    // A fresh container per screen, so no screen's listeners outlive it.
    const root = document.createElement('div');
    root.className = 'view';
    app.replaceChildren(root);
    window.scrollTo(0, 0);
    cleanup = view(root, ...m.slice(1)) || null;
    app.focus({ preventScroll: true });
    return;
  }
  location.replace('#/');
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && window.isSecureContext && !new URLSearchParams(location.search).has('nosw')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Exposed for the end-to-end tests and for curious officers in the console.
window.eventTimer = { liveEvent, vibrate };
