// A station's own screen: where they are in their program, and how full they are.
import { liveEvent } from './sync.js';
import { esc, $, toast, prettyCode, confirmDialog, keepAwake, CROWD } from './ui.js';
import { setHeader, mountEvent, errorText, announce } from './shell.js';
import { heroHtml, messageHtml, stationsBoardHtml } from './components.js';
import { stationSince } from './time.js';
import { stationAccess, setStationAccess, myName, setMyName } from './store.js';

export function stationView(root, code) {
  const access = stationAccess(code);
  if (!access) {
    location.replace(`#/e/${code}/join`);
    return null;
  }
  const live = liveEvent(code);
  let lastOthersAt = 0;
  let noteFocused = false;
  setHeader({ title: 'My station', subtitle: prettyCode(code), back: `#/e/${code}` });
  document.body.classList.add('is-station');
  keepAwake(true);

  root.innerHTML = `
    <div class="page page-station">
      <div id="msg"></div>
      <div id="hero"></div>
      <section class="card mine" id="mine" aria-label="Your station"></section>
      <section class="card">
        <h2 class="card-title">Your update</h2>
        <form id="noteForm" class="form">
          <label class="field"><span>Note to the other stations <em>(optional)</em></span>
            <input id="note" maxlength="140" placeholder="e.g. Send the next group in 5 minutes"></label>
          <label class="field"><span>Your name <em>(shown with your updates)</em></span>
            <input id="myName" maxlength="40" value="${esc(myName())}" autocomplete="name"></label>
          <button class="btn" type="submit">Post note</button>
        </form>
      </section>
      <h2 class="section-title">All stations</h2>
      <div id="others"></div>
      <p class="center"><button class="btn btn-ghost btn-small" id="leave">Sign out of this station</button></p>
    </div>`;

  async function update(patch, done) {
    const res = await live.send('et_station', {
      p_code: code,
      p_station: access.id,
      p_key: access.key,
      p_patch: { ...patch, by: myName() },
    });
    if (res.queued) {
      toast('No connection. Saved on this phone and shown here; it uploads when you are back online.', 'warn', 5000);
    } else if (res.ok === false) {
      if (res.error === 'wrong_key' || res.error === 'no_station') {
        toast('This facilitator code no longer works. Ask the admin for the new one.', 'bad', 7000);
        setStationAccess(code, null);
        location.hash = `#/e/${code}/join`;
      } else {
        toast(errorText(res.error, res.message), 'bad');
      }
    } else if (done) {
      toast(done, 'ok', 1800);
    }
  }

  function drawMine(view) {
    const s = view.stations.find((x) => x.id === access.id);
    if (!s) {
      $('#mine').innerHTML = '<p class="empty">This station was removed by the admin.</p>';
      return;
    }
    setHeader({ title: s.name, subtitle: `${view.event.name} · ${prettyCode(code)}`, back: `#/e/${code}` });
    const now = live.now();
    const since = s.phase_index >= 0 ? stationSince(s, now) : null;
    const nextPhase = s.phases[s.phase_index + 1];
    $('#mine').innerHTML = `
      <header class="mine-head">
        <div>
          <p class="eyebrow">Facilitator · your station</p>
          <h1 class="card-title">${esc(s.name)}</h1>
          ${s.location ? `<p class="muted">${esc(s.location)}</p>` : ''}
        </div>
        ${s.pending ? '<span class="chip chip-warn">Uploading…</span>' : ''}
      </header>

      <h2 class="eyebrow">Which part of the program is your station on?</h2>
      <p class="mine-phase"><strong>${esc(s.phase_index >= 0 ? s.phases[s.phase_index] : 'Not started')}</strong>${since ? ` <span class="muted">· for ${esc(since)}</span>` : ''}</p>
      ${nextPhase ? `<button class="btn btn-go" data-phase="${s.phase_index + 1}"><span class="go-label">${s.phase_index < 0 ? 'Start' : 'Next'} ›</span><span class="go-sub">${esc(nextPhase)}</span></button>` : ''}
      <div class="phase-list" role="group" aria-label="Choose your step">
        ${s.phases.map((p, i) => `<button class="phase-btn${i === s.phase_index ? ' is-on' : ''}" data-phase="${i}" aria-pressed="${i === s.phase_index}">
          <span class="phase-n">${i + 1}</span>${esc(p)}</button>`).join('')}
        <button class="phase-btn phase-reset${s.phase_index < 0 ? ' is-on' : ''}" data-phase="-1" aria-pressed="${s.phase_index < 0}">Not started</button>
      </div>

      <h2 class="eyebrow">Is your station full?</h2>
      <div class="crowd-grid" role="group" aria-label="How full is your station">
        ${Object.entries(CROWD).map(([k, c]) => `<button class="crowd-btn crowd-${c.tone}${s.crowd === k ? ' is-on' : ''}" data-crowd="${k}" aria-pressed="${s.crowd === k}">
          ${esc(c.label)}</button>`).join('')}
      </div>
      ${s.note ? `<p class="station-note">Your note: “${esc(s.note)}” <button class="btn btn-small btn-ghost" data-clearnote>Clear</button></p>` : ''}`;
    if (!noteFocused) $('#note').placeholder = s.note || 'e.g. Send the next group in 5 minutes';
  }

  function drawOthers(view) {
    $('#others').innerHTML = stationsBoardHtml(view, live.now(), { mine: access.id });
    lastOthersAt = Date.now();
  }

  root.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-phase]');
    if (p) {
      const i = Number(p.dataset.phase);
      const s = live.view().stations.find((x) => x.id === access.id);
      if (s && i !== s.phase_index) {
        update({ phase_index: i }, i >= 0 ? `Now: ${s.phases[i]}` : 'Marked not started');
      }
      return;
    }
    const c = e.target.closest('[data-crowd]');
    if (c) {
      const s = live.view().stations.find((x) => x.id === access.id);
      if (s && s.crowd !== c.dataset.crowd) update({ crowd: c.dataset.crowd }, `Marked ${CROWD[c.dataset.crowd].label.toLowerCase()}`);
      return;
    }
    if (e.target.closest('[data-clearnote]')) { update({ note: '' }, 'Note cleared'); return; }
    if (e.target.id === 'leave' && await confirmDialog({ title: 'Sign out of this station?', body: 'You will need the facilitator code to update it again.', confirm: 'Sign out' })) {
      setStationAccess(code, null);
      location.hash = `#/e/${code}`;
    }
  });

  root.addEventListener('focusin', (e) => { if (e.target.id === 'note') noteFocused = true; });
  root.addEventListener('focusout', (e) => { if (e.target.id === 'note') noteFocused = false; });
  root.addEventListener('change', (e) => { if (e.target.id === 'myName') setMyName(e.target.value.trim()); });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    setMyName($('#myName').value.trim());
    const note = $('#note').value.trim();
    update({ note }, note ? 'Note posted' : 'Note cleared');
    $('#note').value = '';
  });

  const cleanup = mountEvent(code, {
    onNotFound() {
      toast('This event no longer exists.', 'bad');
      location.hash = '#/';
    },
    render(view, l, { moved }) {
      $('#msg').innerHTML = messageHtml(view);
      $('#hero').innerHTML = heroHtml(view, live.now(), { compact: true });
      if (moved) {
        const seg = view.segments[view.event.current_index];
        announce(view.event.status === 'ended' ? 'Program ended' : seg ? `Main program now: ${seg.title}` : '');
        $('#hero .hero')?.classList.add('flash');
      }
      drawMine(view);
      drawOthers(view);
    },
    tick(view) {
      $('#hero').innerHTML = heroHtml(view, live.now(), { compact: true });
      if (Date.now() - lastOthersAt > 20000) { drawMine(view); drawOthers(view); }
    },
  });

  return () => {
    cleanup();
    keepAwake(false);
  };
}

