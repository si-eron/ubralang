// The page: which screen to show, and the screens anyone can open.
import { liveEvent, rpc, isConfigured } from './sync.js';
import { esc, $, $$, toast, prettyCode, normCode, vibrate } from './ui.js';
import { setHeader, setPill, announce, errorText, mountEvent, shareDialog, linksHtml } from './shell.js';
import { heroHtml, messageHtml, programHtml, stationsBoardHtml, logHtml } from './components.js';
import { recentEvents, rememberEvent, forgetEvent, adminKey, setAdminKey, stationAccess, setStationAccess } from './store.js';
import { adminView } from './admin.js';
import { stationView } from './station.js';
import { stageView } from './stage.js';
import { presenterView } from './presenter.js';
import { needsInstall, installView, isStandalone, platform, canPromptInstall, promptInstall, onInstallChange } from './install.js';

const app = document.getElementById('app');
// ------------------------------------------------------------- one code, three doors
//
// Every code is typed in the same box, and the app works out where it leads:
//   the event code  -> Facilitator view (follow the program; changes nothing)
//   a station code  -> Station control  (that station's buttons)
//   the admin key   -> Master control   (runs the program)
// The same three come as links, #/go/<code>, which sign people straight in.

export async function enterCode(raw) {
  const k = normCode(raw);
  if (k.length < 6) return { ok: false, error: 'too_short' };
  let res;
  try {
    res = await rpc('et_enter', { p_key: k });
  } catch (err) {
    // A database not yet updated for one-box sign-in: treat it as an event code.
    if (err.code === 'server' && /et_enter/.test(err.message)) {
      const st = await rpc('et_state', { p_code: k, p_since: 0 });
      res = st.ok ? { ok: true, role: 'viewer', code: k } : st;
    } else {
      throw err;
    }
  }
  if (!res.ok) return res;
  const state = await rpc('et_state', { p_code: res.code, p_since: 0 }).catch(() => null);
  rememberEvent(res.code, state && state.event ? state.event.name : res.code);
  if (res.role === 'admin') {
    setAdminKey(res.code, k);
    return { ...res, hash: `#/e/${res.code}/admin` };
  }
  if (res.role === 'station') {
    setStationAccess(res.code, { id: res.station, key: k });
    return { ...res, hash: `#/e/${res.code}/station` };
  }
  return { ...res, hash: `#/e/${res.code}` };
}

const ENTER_ERRORS = {
  too_short: 'Type the whole code: 6 or 8 letters and numbers.',
  not_found: 'That code doesn’t match any event, station or admin key. Check it and try again.',
  ambiguous: 'That station code is used twice. Ask the admin for a new one.',
};

async function submitCode(input, btn) {
  btn.disabled = true;
  try {
    const res = await enterCode(input.value);
    if (!res.ok) { toast(ENTER_ERRORS[res.error] || errorText(res.error), 'bad', 5000); return; }
    location.hash = res.hash;
  } catch (err) {
    toast(errorText(err.code, err.message), 'bad');
  } finally {
    btn.disabled = false;
  }
}

function goView(root, code) {
  setHeader({ title: 'Signing in…' });
  setPill('');
  root.innerHTML = '<div class="page"><p class="empty">Opening…</p></div>';
  enterCode(code)
    .then((res) => {
      if (res.ok) location.replace(res.hash);
      else { toast(ENTER_ERRORS[res.error] || errorText(res.error), 'bad', 6000); location.replace('#/'); }
    })
    .catch((err) => { toast(errorText(err.code, err.message), 'bad', 6000); location.replace('#/'); });
}

// ------------------------------------------------------------- home

const ROLE_LABEL = { viewer: 'Facilitator view', station: 'Station control', admin: 'Master control' };

function homeView(root) {
  setHeader();
  setPill('');
  const recent = recentEvents();
  root.innerHTML = `
    <div class="page page-home">
      <section class="intro">
        <h1>Event Timer</h1>
        <p class="lede">Follow the program live, run your station, or run the whole event, all with one code.</p>
      </section>

      ${isConfigured() ? '' : '<div class="notice notice-warn"><strong>Not connected yet.</strong> This copy of the site has no database. See SETUP.md.</div>'}

      <form class="card enter" id="enterForm" autocomplete="off">
        <label for="codeBox" class="card-title">Enter your code</label>
        <div class="join-row">
          <input id="codeBox" inputmode="text" autocapitalize="characters" spellcheck="false" placeholder="ABC-123" maxlength="10" required>
          <button class="btn btn-primary" type="submit">Go</button>
        </div>
        <ul class="doors">
          <li><span class="door door-view">Event code</span> opens the <strong>Facilitator view</strong>: the live program.</li>
          <li><span class="door door-station">Station code</span> opens <strong>Station control</strong>: your station’s buttons.</li>
          <li><span class="door door-admin">Admin key</span> opens <strong>Master control</strong>: runs the whole program.</li>
        </ul>
      </form>

      <section class="card">
        <h2 class="card-title">Running a new event?</h2>
        <p class="muted">Make the event and add the program. You get the codes and links for everyone else.</p>
        <a class="btn btn-primary btn-block" href="#/new">Create an event</a>
      </section>

      ${recent.length ? `<section class="card">
        <h2 class="card-title">Opened on this phone</h2>
        <ul class="recent">${recent.map((e) => `
          <li>
            <div class="recent-main">
              <span class="recent-name">${esc(e.name)}</span>
              <span class="recent-links">
                ${adminKey(e.code) ? `<a class="chip chip-live" href="#/e/${esc(e.code)}/admin">${ROLE_LABEL.admin}</a>` : ''}
                ${stationAccess(e.code) ? `<a class="chip chip-live" href="#/e/${esc(e.code)}/station">${ROLE_LABEL.station}</a>` : ''}
                <a class="chip" href="#/e/${esc(e.code)}">${ROLE_LABEL.viewer}</a>
              </span>
            </div>
            <button class="btn btn-ghost btn-small" data-forget="${esc(e.code)}" aria-label="Remove ${esc(e.name)} from this phone">Remove</button>
          </li>`).join('')}
        </ul>
      </section>` : ''}

      <section class="card install" id="installCard">
        <h2 class="card-title">On a computer?</h2>
        <p class="muted" id="installText">It works here too. For the projector, open the event and tap <strong>Big screen</strong>.</p>
        <button class="btn btn-block" id="installBtn" hidden>Install the app</button>
      </section>
    </div>`;

  $('#enterForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitCode($('#codeBox'), $('#enterForm button'));
  });
  $$('[data-forget]', root).forEach((b) => b.addEventListener('click', () => {
    forgetEvent(b.dataset.forget);
    homeView(root);
  }));
  setupInstall();
}

// ------------------------------------------------------------- install

// The card on the home page (the full "install first" screen is install.js).
function setupInstall() {
  const card = $('#installCard');
  if (!card) return;
  if (isStandalone()) { card.hidden = true; return; }
  const btn = $('#installBtn');
  const text = $('#installText');
  if (canPromptInstall()) {
    btn.hidden = false;
    btn.onclick = async () => { await promptInstall(); setupInstall(); };
  } else if (platform() === 'ios') {
    btn.hidden = true;
    text.innerHTML = 'On iPhone or iPad: tap <strong>Share</strong> <span aria-hidden="true">(the square with an arrow)</span>, then <strong>Add to Home Screen</strong>.';
  } else if (platform() === 'android') {
    btn.hidden = true;
    text.innerHTML = 'On Android: open the browser menu <span aria-hidden="true">(⋮)</span> and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. On a computer, look for the install icon in the address bar.';
  }
}
onInstallChange(setupInstall);

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
        <p>These are the codes for <strong>${esc(name)}</strong>. Anyone types one in the box on the home page, or opens its link.</p>
        ${linksHtml(code, key, [])}
        <p class="notice notice-gold"><strong>Write the admin key down.</strong> It is how you open Master control on another phone or a laptop. This phone is already signed in.</p>
        <p class="muted">Station codes appear once you add stations (Master control → Stations).</p>
        <a class="btn btn-primary btn-block" href="#/e/${esc(code)}/admin/program">Next: add the program</a>
      </section>
    </div>`;
}

// ------------------------------------------------------------- join as staff

function joinView(root, code, presetKey) {
  setHeader({ title: 'Admin / facilitator sign-in', subtitle: prettyCode(code), back: `#/e/${code}` });
  setPill('');
  root.innerHTML = `
    <div class="page">
      <form class="card form" id="roleForm" autocomplete="off">
        <h1 class="card-title">Admin or facilitator?</h1>
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
    notices: { role: 'viewer' },
    presence: { role: 'viewer' },
    onNotFound() {
      setHeader({ title: 'Not found', back: '#/' });
      root.innerHTML = `<div class="page"><div class="card"><h1 class="card-title">No event with code ${esc(prettyCode(code))}</h1>
        <p class="muted">It may have been deleted, or the code is mistyped.</p>
        <div class="row"><a class="btn btn-primary" href="#/">Back</a><button class="btn" id="forget">Remove from my list</button></div></div></div>`;
      $('#forget').addEventListener('click', () => { forgetEvent(code); location.hash = '#/'; });
    },
    render(view, live, { moved }) {
      const ev = view.event;
      setHeader({ title: ev.name, subtitle: ['Facilitator view', `Code ${prettyCode(code)}`].join(' · '), back: '#/' });
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
        ${station ? `<a class="btn btn-primary" href="#/e/${esc(code)}/station">Station control</a>` : ''}
        <button class="btn" data-present="presenter">▶ Present</button>
        <button class="btn" data-present="stage">Big screen</button>
        <button class="btn" id="share">Share</button>
        ${isAdmin || station ? '' : '<a class="btn btn-ghost" href="#/">Have a station code or admin key?</a>'}`;
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
  [/^#\/go\/([A-Za-z0-9-]+)$/, (root, code) => goView(root, code)],
  [/^#\/e\/([A-Za-z0-9]+)$/, (root, code) => eventView(root, normCode(code))],
  [/^#\/e\/([A-Za-z0-9]+)\/join(?:\/([A-Za-z0-9-]+))?$/, (root, code, key) => joinView(root, normCode(code), key)],
  [/^#\/e\/([A-Za-z0-9]+)\/admin(?:\/([a-z]+))?$/, (root, code, tab) => adminView(root, normCode(code), tab)],
  [/^#\/e\/([A-Za-z0-9]+)\/station$/, (root, code) => stationView(root, normCode(code))],
  [/^#\/e\/([A-Za-z0-9]+)\/stage$/, (root, code) => stageView(root, normCode(code))],
  [/^#\/e\/([A-Za-z0-9]+)\/presenter$/, (root, code) => presenterView(root, normCode(code))],
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
    if (needsInstall(hash)) {
      // On a phone, in the browser: show how to install it, first.
      setHeader({ title: 'Event Timer' });
      setPill('');
      cleanup = installView(root, hash);
    } else {
      cleanup = view(root, ...m.slice(1)) || null;
    }
    app.focus({ preventScroll: true });
    return;
  }
  location.replace('#/');
}

window.addEventListener('hashchange', route);
route();

// Keeping installed copies up to date. Every file is fetched fresh whenever
// there is signal (see sw.js), and the app looks for a newer version each
// time it is opened or brought back to the front. When one has arrived it
// switches over: at once if the screen is not showing, otherwise after a tap
// on "Update now", so nobody loses what they are typing.
if ('serviceWorker' in navigator && window.isSecureContext && !new URLSearchParams(location.search).has('nosw')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60_000);
  }).catch(() => {});

  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  const reload = () => { if (!reloading) { reloading = true; location.reload(); } };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // the very first install: nothing old to replace
    if (document.visibilityState === 'hidden') { reload(); return; }
    const bar = document.getElementById('updateBar');
    if (bar) {
      bar.hidden = false;
      bar.querySelector('button').onclick = reload;
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') reload(); });
  });
}
// Exposed for the end-to-end tests and for curious officers in the console.
window.eventTimer = { liveEvent, vibrate };
