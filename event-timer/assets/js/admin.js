// Master control: the one person who moves the program along.
import { liveEvent } from './sync.js';
import { esc, $, $$, toast, prettyCode, confirmDialog, copyText, keepAwake, qrSvg } from './ui.js';
import { setHeader, mountEvent, errorText, shareUrl, announce } from './shell.js';
import { heroHtml, messageHtml, programHtml, stationsBoardHtml, logHtml } from './components.js';
import { fmtSpan, fmtClock, minutesToSeconds, parseProgramLine } from './time.js';
import { adminKey, setAdminKey, forgetEvent, rememberEvent } from './store.js';

// What a station runs through, unless the admin types something else.
// Every station runs the same four steps, and its facilitators tap through
// them. (Stations with their own programs may come later.)
export const DEFAULT_STEPS = ['Students entering', 'Introduction of guest speaker', 'Session', 'Students exit'];

const TABS = [
  ['run', 'Run'],
  ['program', 'Program'],
  ['stations', 'Stations'],
  ['share', 'Share'],
  ['settings', 'Settings'],
];

export function adminView(root, code, initialTab) {
  const key = adminKey(code);
  if (!key) {
    location.replace(`#/e/${code}/join`);
    return null;
  }
  const live = liveEvent(code);
  let tab = TABS.some(([t]) => t === initialTab) ? initialTab : 'run';
  let programDraft = null; // edits not yet saved
  let programDirty = false;
  let stationsDraft = null;
  let stationsDirty = false;
  let codes = null;
  let busy = false;
  let alive = true; // false once the person has left this screen
  let lastPanelAt = 0;

  setHeader({ title: 'Master control', subtitle: prettyCode(code), back: `#/e/${code}` });
  document.body.classList.add('is-admin');
  keepAwake(true);

  root.innerHTML = `
    <div class="page page-admin">
      <div class="admin-grid">
        <div class="admin-main">
          <div id="msg"></div>
          <div id="hero"></div>
          <section class="controls card" id="controls" aria-label="Program controls"></section>
        </div>
        <div class="admin-side">
          <div class="tabs" role="tablist" id="tabs">${TABS.map(([id, label]) =>
            `<button role="tab" data-tab="${id}" aria-selected="${tab === id}">${label}</button>`).join('')}</div>
          <div id="panel" role="tabpanel"></div>
        </div>
      </div>
    </div>`;

  // -------------------------------------------------------- actions

  async function act(action, args = {}, { quiet = false } = {}) {
    const res = await live.send('et_admin', { p_code: code, p_key: key, p_action: action, p_args: args });
    if (res.queued) {
      toast('No connection. Saved on this phone; it goes through the moment you are back online, with the time you pressed it.', 'warn', 6000);
    } else if (res.ok === false) {
      if (res.error === 'wrong_key') {
        toast('This phone’s admin key no longer works. Sign in again.', 'bad', 6000);
        setAdminKey(code, null);
        location.hash = `#/e/${code}/join`;
      } else {
        toast(errorText(res.error, res.message), 'bad');
      }
    } else if (res.stale && !quiet) {
      toast('Already done: another screen got there first.', 'info');
    }
    return res;
  }

  // Edits need an answer (did it save?), so they go straight to the server.
  async function edit(action, args = {}) {
    try {
      const res = await live.call('et_admin', { p_code: code, p_key: key, p_action: action, p_args: args });
      if (!res.ok) {
        toast(errorText(res.error, res.message), 'bad', 6000);
        return null;
      }
      return res;
    } catch (err) {
      toast(errorText(err.code, err.message), 'bad', 6000);
      return null;
    }
  }

  async function guarded(fn) {
    if (busy) return;
    busy = true;
    $$('#controls button').forEach((b) => { b.disabled = true; });
    try { await fn(); } finally {
      // A short pause stops a double tap from moving twice.
      setTimeout(() => {
        busy = false;
        const v = live.view();
        if (alive && v) drawControls(v);
      }, 500);
    }
  }

  async function next() {
    const v = live.view();
    if (!v) return;
    const ev = v.event;
    if (ev.status === 'ready') return act('start', { from: ev.current_index });
    if (ev.status === 'ended') return null;
    if (ev.current_index >= v.segments.length - 1) {
      const ok = await confirmDialog({ title: 'Finish the program?', body: 'This is the last segment. Everyone’s screen will show the program as ended. You can undo it with Back.', confirm: 'Finish' });
      if (!ok) return null;
    }
    return act('next', { from: ev.current_index });
  }

  // -------------------------------------------------------- drawing

  function drawControls(view) {
    if (!alive || !view) return;
    const ev = view.event;
    const segs = view.segments;
    const nextSeg = segs[ev.current_index + 1];
    let primary;
    if (ev.status === 'ready') {
      primary = segs.length
        ? `<button class="btn btn-go" data-act="next"><span class="go-label">Start program</span><span class="go-sub">${esc(segs[0].title)}</span></button>`
        : '<a class="btn btn-go" href="#/e/' + esc(code) + '/admin/program" data-tab-link="program"><span class="go-label">Add the program first</span></a>';
    } else if (ev.status === 'ended') {
      primary = '<button class="btn btn-go" disabled><span class="go-label">Program ended</span><span class="go-sub">Back reopens the last segment</span></button>';
    } else if (nextSeg) {
      primary = `<button class="btn btn-go" data-act="next"><span class="go-label">Next ›</span><span class="go-sub">${esc(nextSeg.title)}</span></button>`;
    } else {
      primary = '<button class="btn btn-go btn-go-end" data-act="next"><span class="go-label">Finish program</span><span class="go-sub">This is the last segment</span></button>';
    }
    const running = ev.status === 'live' || ev.status === 'hold';
    $('#controls').innerHTML = `
      ${primary}
      <div class="control-row">
        <button class="btn" data-act="prev" ${ev.status === 'ready' ? 'disabled' : ''} title="Undo the last Next (←)">‹ Back</button>
        ${ev.status === 'hold'
          ? '<button class="btn btn-hold" data-act="resume" title="Resume (H)">Resume</button>'
          : `<button class="btn" data-act="hold" ${ev.status !== 'live' ? 'disabled' : ''} title="Stop the clock (H)">Hold</button>`}
        <button class="btn" data-act="minus" ${running ? '' : 'disabled'} aria-label="One minute less">−1 min</button>
        <button class="btn" data-act="plus" ${running ? '' : 'disabled'} aria-label="One minute more">+1 min</button>
      </div>
      <form class="announce-form" id="announceForm">
        <label for="announceText" class="eyebrow">Announcement to every screen</label>
        <div class="join-row">
          <input id="announceText" maxlength="280" placeholder="e.g. Lunch is ready in the canteen" value="">
          <button class="btn" type="submit">Send</button>
        </div>
        ${ev.message ? `<p class="field-help">Showing now: “${esc(ev.message)}” <button type="button" class="btn btn-small btn-ghost" data-act="clearmsg">Clear</button></p>` : ''}
      </form>
      ${running ? '<button class="btn btn-ghost btn-small end-btn" data-act="end">End program now</button>' : ''}
      <p class="kbd-help muted">On a keyboard: → Next · ← Back · H Hold/Resume</p>`;
  }

  function drawPanel(view) {
    if (!alive || !view) return;
    const now = live.now();
    $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const panel = $('#panel');
    lastPanelAt = Date.now();
    if (tab === 'run') {
      panel.innerHTML = `
        <h2 class="panel-title">Run of show</h2>
        <p class="muted panel-help">Go jumps straight to a segment.</p>
        ${programHtml(view, now, { admin: true })}
        ${view.event.stations_enabled && view.stations.length ? `<h2 class="panel-title">Stations</h2>${stationsBoardHtml(view, now)}` : ''}
        <h2 class="panel-title">Updates</h2>${logHtml(view)}`;
    } else if (tab === 'program') {
      if (!programDirty) programDraft = view.segments.map(toDraft);
      drawProgramEditor(view);
    } else if (tab === 'stations') {
      if (!stationsDirty) stationsDraft = view.stations.map(toStationDraft);
      if (!stationsDirty && view.event.stations_enabled && !view.stations.length) {
        // A head start: three stations to rename, ready to save.
        stationsDraft = [1, 2, 3].map(newStation);
        stationsDirty = true;
      }
      drawStationsEditor(view);
    } else if (tab === 'share') {
      drawShare();
    } else if (tab === 'settings') {
      drawSettings(view);
    }
  }

  // -------------------------------------------------------- program editor

  const toDraft = (s) => ({ id: s.id, title: s.title, minutes: +(s.duration_s / 60).toFixed(2), lead: s.lead, notes: s.notes });

  function drawProgramEditor(view) {
    const ev = view.event;
    const currentId = ev.status !== 'ready' ? view.segments[ev.current_index]?.id : null;
    const total = programDraft.reduce((t, s) => t + minutesToSeconds(s.minutes) * 1000, 0);
    const base = ev.planned_start ?? ev.started_at;
    $('#panel').innerHTML = `
      <h2 class="panel-title">Program</h2>
      <p class="muted panel-help">${programDraft.length} segment${programDraft.length === 1 ? '' : 's'} · ${fmtSpan(total)}${base ? ` · planned to end ${fmtClock(base + total)}` : ''}. Changes reach every screen when you save.</p>
      <ol class="edit-list" id="editList">${programDraft.map((s, i) => `
        <li class="edit-row${s.id && s.id === currentId ? ' edit-current' : ''}" data-i="${i}">
          <span class="edit-num" aria-hidden="true">${i + 1}</span>
          <div class="edit-fields">
            <input class="in-title" data-f="title" value="${esc(s.title)}" maxlength="120" placeholder="Segment title" aria-label="Segment ${i + 1} title">
            <div class="edit-line">
              <label class="in-min"><input data-f="minutes" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(s.minutes)}" aria-label="Segment ${i + 1} minutes"><span>min</span></label>
              <input data-f="lead" value="${esc(s.lead)}" maxlength="80" placeholder="Who’s on (optional)" aria-label="Segment ${i + 1} person in charge">
            </div>
            <textarea data-f="notes" rows="1" maxlength="500" placeholder="Notes for the admin (optional)" aria-label="Segment ${i + 1} notes">${esc(s.notes)}</textarea>
            ${s.id && s.id === currentId ? '<p class="field-help">On now: it can be edited but not deleted.</p>' : ''}
          </div>
          <div class="edit-tools">
            <button class="btn btn-small btn-ghost" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button class="btn btn-small btn-ghost" data-move="1" ${i === programDraft.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
            <button class="btn btn-small btn-ghost" data-remove ${s.id && s.id === currentId ? 'disabled' : ''} aria-label="Delete segment ${i + 1}">✕</button>
          </div>
        </li>`).join('')}
      </ol>
      <button class="btn btn-block" id="addSeg">+ Add segment</button>
      <details class="paste">
        <summary>Paste a whole program</summary>
        <p class="field-help">One segment per line, minutes at the end: <code>Opening prayer - 5</code></p>
        <textarea id="pasteText" rows="6" placeholder="Registration - 30&#10;Opening prayer - 5&#10;Welcome remarks - 10&#10;Keynote - 45"></textarea>
        <button class="btn" id="pasteAdd">Add these to the end</button>
      </details>
      <div class="savebar" id="programSave" ${programDirty ? '' : 'hidden'}>
        <span>Unsaved changes</span>
        <button class="btn btn-ghost" id="programDiscard">Discard</button>
        <button class="btn btn-primary" id="programSaveBtn">Save program</button>
      </div>`;
  }

  function markProgramDirty() {
    programDirty = true;
    const bar = $('#programSave');
    if (bar) bar.hidden = false;
  }

  async function saveProgram() {
    const segments = programDraft.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      title: s.title,
      duration_s: minutesToSeconds(s.minutes),
      lead: s.lead || '',
      notes: s.notes || '',
    }));
    const btn = $('#programSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    const res = await edit('program', { segments });
    if (res) {
      programDirty = false;
      toast('Program saved. Every screen has it.', 'ok');
      drawPanel(live.view());
      drawControls(live.view());
    } else if (btn) {
      btn.disabled = false; btn.textContent = 'Save program';
    }
  }

  // -------------------------------------------------------- stations editor

  const toStationDraft = (s) => ({ id: s.id, name: s.name, location: s.location });
  const newStation = (n) => ({ id: null, name: `Station ${n}`, location: '' });

  function drawStationsEditor(view) {
    const ev = view.event;
    $('#panel').innerHTML = `
      <h2 class="panel-title">Station Mode</h2>
      <label class="check toggle"><input type="checkbox" id="stationsOn" ${ev.stations_enabled ? 'checked' : ''}>
        <span><strong>Use stations at this event</strong><br><span class="muted">Each station gets its own facilitator code. Only that station’s facilitators change it: which part of its program it is on, and whether it is full. Everyone sees every station.</span></span></label>
      <div ${ev.stations_enabled ? '' : 'hidden'}>
        <p class="notice notice-gold">Every station’s facilitators get the same four buttons: <strong>Students entering → Introduction of guest speaker → Session → Students exit</strong>, plus whether the station is full.</p>
        <ol class="edit-list" id="stationList">${stationsDraft.map((s, i) => `
          <li class="edit-row" data-i="${i}">
            <span class="edit-num" aria-hidden="true">${i + 1}</span>
            <div class="edit-fields">
              <input data-f="name" value="${esc(s.name)}" maxlength="60" placeholder="Station name" aria-label="Station ${i + 1} name">
              <input data-f="location" value="${esc(s.location)}" maxlength="80" placeholder="Where (optional)" aria-label="Station ${i + 1} location">
            </div>
            <div class="edit-tools">
              <button class="btn btn-small btn-ghost" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
              <button class="btn btn-small btn-ghost" data-move="1" ${i === stationsDraft.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
              <button class="btn btn-small btn-ghost" data-remove aria-label="Delete station ${i + 1}">✕</button>
            </div>
          </li>`).join('')}
        </ol>
        <button class="btn btn-block" id="addStation">+ Add station</button>
        <div class="savebar" id="stationsSave" ${stationsDirty ? '' : 'hidden'}>
          <span>Unsaved changes</span>
          <button class="btn btn-ghost" id="stationsDiscard">Discard</button>
          <button class="btn btn-primary" id="stationsSaveBtn">Save stations</button>
        </div>
        <h2 class="panel-title">Facilitator codes</h2>
        <p class="muted panel-help">Give each station’s facilitators their code, or send them the link: it signs them straight in. A code opens only its own station.</p>
        <div id="codes">${codesHtml(view)}</div>
      </div>`;
    if (ev.stations_enabled && !codes && view.stations.length) loadCodes();
  }

  function codesHtml(view) {
    if (!view.stations.length) return '<p class="empty">Save at least one station first.</p>';
    if (!codes) return '<p class="muted">Loading codes…</p>';
    return `<ul class="codes">${codes.map((c) => `
      <li>
        <div><p class="code-name">${esc(c.name)}</p><p class="bigcode bigcode-small">${esc(prettyCode(c.code))}</p></div>
        <div class="row">
          <button class="btn btn-small" data-copylink="${esc(c.code)}">Copy link</button>
          <button class="btn btn-small btn-ghost" data-newcode="${esc(c.id)}" aria-label="New code for ${esc(c.name)}">New code</button>
        </div>
      </li>`).join('')}</ul>`;
  }

  async function loadCodes() {
    const res = await edit('codes');
    if (res) {
      codes = res.codes;
      const el = $('#codes');
      if (el) el.innerHTML = codesHtml(live.view());
    }
  }

  function markStationsDirty() {
    stationsDirty = true;
    const bar = $('#stationsSave');
    if (bar) bar.hidden = false;
  }

  async function saveStations() {
    const stations = stationsDraft.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      name: s.name,
      location: s.location || '',
      phases: DEFAULT_STEPS,
    }));
    const btn = $('#stationsSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    const res = await edit('stations', { stations });
    if (res) {
      stationsDirty = false;
      codes = null;
      toast('Stations saved.', 'ok');
      drawPanel(live.view());
    } else if (btn) {
      btn.disabled = false; btn.textContent = 'Save stations';
    }
  }

  // -------------------------------------------------------- share & settings

  function drawShare() {
    const url = shareUrl(code);
    $('#panel').innerHTML = `
      <h2 class="panel-title">Everyone</h2>
      <p class="muted panel-help">Anyone with the code or link can follow along. Watching needs no sign-in.</p>
      <div class="share-block">
        ${qrSvg(url)}
        <div>
          <p class="eyebrow">Event code</p>
          <p class="bigcode">${esc(prettyCode(code))}</p>
          <p class="share-url">${esc(url)}</p>
          <div class="row"><button class="btn" data-copy="${esc(url)}">Copy link</button>
          <a class="btn" href="#/e/${esc(code)}/stage">Open big screen</a>
          <a class="btn" href="#/e/${esc(code)}/presenter">Presenter view</a></div>
        </div>
      </div>
      <h2 class="panel-title">Your admin key</h2>
      <p class="muted panel-help">Saved on this phone. To run the event from another device, sign in there with this key.</p>
      <p><button class="btn" id="revealKey">Show admin key</button> <span class="bigcode bigcode-small" id="keyOut" hidden>${esc(prettyCode(key))}</span></p>
      <p><button class="btn btn-ghost" id="newKey">Make a new admin key</button></p>
      <p class="field-help">A new key signs every other device out of master control.</p>`;
  }

  function toLocalInput(ms) {
    if (ms == null) return '';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function drawSettings(view) {
    const ev = view.event;
    $('#panel').innerHTML = `
      <form class="form" id="settingsForm">
        <h2 class="panel-title">Event details</h2>
        <label class="field"><span>Name</span><input name="name" value="${esc(ev.name)}" maxlength="120" required></label>
        <label class="field"><span>Venue</span><input name="venue" value="${esc(ev.venue)}" maxlength="120"></label>
        <label class="field"><span>Planned start <em>(optional)</em></span>
          <input name="planned" type="datetime-local" value="${esc(toLocalInput(ev.planned_start))}"></label>
        <button class="btn btn-primary" type="submit">Save details</button>
      </form>
      <h2 class="panel-title">Start over</h2>
      <p class="muted panel-help">Clear the clock and every recorded time, for a rehearsal or a second run. The program and stations stay.</p>
      <button class="btn" id="resetClock">Reset the clock</button>
      <h2 class="panel-title danger-title">Delete</h2>
      <p class="muted panel-help">Removes the event for everyone. It cannot be undone.</p>
      <div class="row">
        <button class="btn btn-danger" id="deleteEvent">Delete this event</button>
        <button class="btn btn-ghost" id="signOut">Sign this phone out</button>
      </div>`;
  }

  // -------------------------------------------------------- events

  root.addEventListener('click', async (e) => {
    const t = e.target;
    const actBtn = t.closest('[data-act]');
    if (actBtn && !actBtn.disabled) {
      const a = actBtn.dataset.act;
      const v = live.view();
      if (a === 'next') guarded(next);
      if (a === 'prev') guarded(() => act('prev', { from: v.event.current_index }));
      if (a === 'hold') guarded(() => act('hold'));
      if (a === 'resume') guarded(() => act('resume'));
      if (a === 'plus') guarded(() => act('adjust', { seconds: 60 }, { quiet: true }));
      if (a === 'minus') guarded(() => act('adjust', { seconds: -60 }, { quiet: true }));
      if (a === 'clearmsg') act('message', { text: '' });
      if (a === 'end') {
        if (await confirmDialog({ title: 'End the program now?', body: 'Every screen will show it as finished. Back reopens the segment that was on.', confirm: 'End program', danger: true })) {
          guarded(() => act('end'));
        }
      }
      return;
    }
    const tabBtn = t.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      history.replaceState(null, '', `#/e/${code}/admin/${tab}`);
      drawPanel(live.view());
      return;
    }
    const tabLink = t.closest('[data-tab-link]');
    if (tabLink) {
      e.preventDefault();
      tab = tabLink.dataset.tabLink;
      history.replaceState(null, '', `#/e/${code}/admin/${tab}`);
      drawPanel(live.view());
      $('#panel').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const go = t.closest('[data-goto]');
    if (go) {
      const v = live.view();
      const target = Number(go.dataset.goto);
      const seg = v.segments[target];
      if (await confirmDialog({ title: `Start “${seg.title}” now?`, body: 'Every screen moves to it straight away.', confirm: 'Start it' })) {
        guarded(() => act('goto', { index: target, from: v.event.current_index }));
      }
      return;
    }

    // Program editor
    if (tab === 'program' && programDraft) {
      const row = t.closest('.edit-row');
      const i = row ? Number(row.dataset.i) : -1;
      if (t.closest('[data-move]') && row) {
        const d = Number(t.closest('[data-move]').dataset.move);
        const [s] = programDraft.splice(i, 1);
        programDraft.splice(i + d, 0, s);
        markProgramDirty();
        drawProgramEditor(live.view());
        $(`.edit-row[data-i="${i + d}"] [data-move="${d}"]`)?.focus();
      } else if (t.closest('[data-remove]') && row) {
        programDraft.splice(i, 1);
        markProgramDirty();
        drawProgramEditor(live.view());
      } else if (t.id === 'addSeg') {
        programDraft.push({ id: null, title: '', minutes: 5, lead: '', notes: '' });
        markProgramDirty();
        drawProgramEditor(live.view());
        $(`.edit-row[data-i="${programDraft.length - 1}"] .in-title`)?.focus();
      } else if (t.id === 'pasteAdd') {
        const lines = $('#pasteText').value.split('\n').map(parseProgramLine).filter(Boolean);
        if (!lines.length) return;
        programDraft.push(...lines.map((l) => ({ id: null, title: l.title, minutes: +(l.duration_s / 60).toFixed(2), lead: '', notes: '' })));
        markProgramDirty();
        drawProgramEditor(live.view());
        toast(`${lines.length} segment${lines.length === 1 ? '' : 's'} added. Save to publish.`, 'info');
      } else if (t.id === 'programSaveBtn') {
        saveProgram();
      } else if (t.id === 'programDiscard') {
        programDirty = false;
        drawPanel(live.view());
      }
    }

    // Stations editor
    if (tab === 'stations') {
      const row = t.closest('.edit-row');
      const i = row ? Number(row.dataset.i) : -1;
      if (t.closest('[data-move]') && row) {
        const d = Number(t.closest('[data-move]').dataset.move);
        const [s] = stationsDraft.splice(i, 1);
        stationsDraft.splice(i + d, 0, s);
        markStationsDirty();
        drawStationsEditor(live.view());
      } else if (t.closest('[data-remove]') && row) {
        const s = stationsDraft[i];
        if (s.id && !(await confirmDialog({ title: `Delete ${s.name || 'this station'}?`, body: 'Its code stops working once you save.', confirm: 'Delete', danger: true }))) return;
        stationsDraft.splice(i, 1);
        markStationsDirty();
        drawStationsEditor(live.view());
      } else if (t.id === 'addStation') {
        stationsDraft.push(newStation(stationsDraft.length + 1));
        markStationsDirty();
        drawStationsEditor(live.view());
        $(`#stationList .edit-row[data-i="${stationsDraft.length - 1}"] input`)?.select();
      } else if (t.id === 'stationsSaveBtn') {
        saveStations();
      } else if (t.id === 'stationsDiscard') {
        stationsDirty = false;
        drawPanel(live.view());
      } else if (t.closest('[data-copylink]')) {
        copyText(shareUrl(code, `/join/${t.closest('[data-copylink]').dataset.copylink}`), 'Station link copied');
      } else if (t.closest('[data-newcode]')) {
        if (await confirmDialog({ title: 'Make a new code for this station?', body: 'The old code stops working. Phones already signed in with it are signed out.', confirm: 'New code' })) {
          await edit('station_code', { id: t.closest('[data-newcode]').dataset.newcode });
          codes = null;
          loadCodes();
        }
      }
    }

    // Share & settings
    if (t.closest('[data-copy]')) copyText(t.closest('[data-copy]').dataset.copy, 'Link copied');
    if (t.id === 'revealKey') { $('#keyOut').hidden = false; t.hidden = true; }
    if (t.id === 'newKey' && await confirmDialog({ title: 'Make a new admin key?', body: 'Every other device is signed out of master control. Write the new key down.', confirm: 'Make new key' })) {
      const res = await edit('new_key');
      if (res && res.key) {
        setAdminKey(code, res.key);
        toast(`New admin key: ${prettyCode(res.key)}`, 'ok', 15000);
        location.reload();
      }
    }
    if (t.id === 'resetClock' && await confirmDialog({ title: 'Reset the clock?', body: 'Every recorded time is cleared and the program goes back to Not started. The program and stations stay.', confirm: 'Reset', danger: true })) {
      if (await edit('reset')) toast('Clock reset.', 'ok');
    }
    if (t.id === 'deleteEvent' && await confirmDialog({ title: 'Delete this event for everyone?', body: 'The program, stations and history are removed for good.', confirm: 'Delete event', danger: true })) {
      const res = await edit('delete');
      if (res) { forgetEvent(code); location.hash = '#/'; toast('Event deleted.', 'ok'); }
    }
    if (t.id === 'signOut' && await confirmDialog({ title: 'Sign this phone out?', body: 'You will need the admin key to control the event again.', confirm: 'Sign out' })) {
      setAdminKey(code, null);
      location.hash = `#/e/${code}`;
    }
  });

  root.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    const row = e.target.closest('.edit-row');
    if (!f || !row) return;
    const i = Number(row.dataset.i);
    if (tab === 'program' && programDraft) { programDraft[i][f] = e.target.value; markProgramDirty(); }
    if (tab === 'stations' && stationsDraft) { stationsDraft[i][f] = e.target.value; markStationsDirty(); }
  });

  root.addEventListener('change', async (e) => {
    if (e.target.id === 'stationsOn') {
      const on = e.target.checked;
      const res = await edit('event', { stations_enabled: on });
      if (!res) e.target.checked = !on;
      else drawPanel(live.view());
    }
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id === 'announceForm') {
      const text = $('#announceText').value.trim();
      if (!text) return;
      const res = await act('message', { text });
      if (res.ok !== false) { $('#announceText').value = ''; if (!res.queued) toast('Sent to every screen.', 'ok'); }
    }
    if (e.target.id === 'settingsForm') {
      const f = new FormData(e.target);
      const planned = f.get('planned') ? new Date(f.get('planned')).getTime() : null;
      const res = await edit('event', { name: f.get('name'), venue: f.get('venue'), planned_start: planned });
      if (res) { rememberEvent(code, res.event.name); toast('Saved.', 'ok'); }
    }
  });

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const v = live.view();
    if (!v) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); guarded(next); }
    if (e.key === 'ArrowLeft' && v.event.status !== 'ready') { e.preventDefault(); guarded(() => act('prev', { from: v.event.current_index })); }
    if (e.key === 'h' || e.key === 'H') {
      if (v.event.status === 'live') guarded(() => act('hold'));
      else if (v.event.status === 'hold') guarded(() => act('resume'));
    }
  };
  document.addEventListener('keydown', onKey);

  const cleanup = mountEvent(code, {
    onNotFound() {
      toast('This event no longer exists.', 'bad');
      location.hash = '#/';
    },
    render(view, l, { moved }) {
      const ev = view.event;
      setHeader({ title: ev.name, subtitle: `Master control · ${prettyCode(code)}`, back: `#/e/${code}` });
      $('#msg').innerHTML = messageHtml(view);
      $('#hero').innerHTML = heroHtml(view, live.now());
      if (moved) {
        $('#hero .hero')?.classList.add('flash');
        const seg = view.segments[ev.current_index];
        announce(ev.status === 'ended' ? 'Program ended' : seg ? `Now: ${seg.title}` : '');
      }
      if (!busy) {
        // Keep whatever is being typed in the announcement box.
        const typed = $('#announceText')?.value;
        const hadFocus = document.activeElement?.id === 'announceText';
        drawControls(view);
        if (typed) $('#announceText').value = typed;
        if (hadFocus) $('#announceText').focus();
      }
      // Editors keep their drafts; everything else redraws.
      const editing = (tab === 'program' && programDirty) || (tab === 'stations' && stationsDirty)
        || (tab === 'settings' && $('#settingsForm')?.contains(document.activeElement))
        || (tab === 'program' && $('#editList')?.contains(document.activeElement))
        || (tab === 'stations' && $('#stationList')?.contains(document.activeElement));
      if (!editing) drawPanel(view);
    },
    tick(view) {
      $('#hero').innerHTML = heroHtml(view, live.now());
      if (tab === 'run' && Date.now() - lastPanelAt > 10000) drawPanel(view);
    },
  });

  return () => {
    alive = false;
    cleanup();
    keepAwake(false);
    document.removeEventListener('keydown', onKey);
  };
}

