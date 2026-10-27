// Presenter view: for whoever is on stage, the host or the speaker, on a
// phone, tablet or laptop at the lectern. Huge time left, a plain cue when to
// wrap up, the notes for this part of the program, and what comes after.
import { esc, $, keepAwake, prettyCode } from './ui.js';
import { setHeader, mountEvent, setPill } from './shell.js';
import { clockOf, timelineOf, effective, fmtDuration, fmtClock, fmtSpan } from './time.js';
import { clockTone, TONE_CAPTION } from './components.js';

// What the speaker should do, in as few words as possible.
const CUE = {
  ok: '',
  warn: 'Please wrap up',
  bad: 'Time is up',
  hold: 'On hold',
  idle: '',
};

export function presenterView(root, code) {
  setHeader({ title: 'Presenter view', subtitle: prettyCode(code), back: `#/e/${code}` });
  document.body.classList.add('is-presenter');
  keepAwake(true);
  root.innerHTML = `
    <div class="presenter" id="presenter">
      <header class="pv-top">
        <a class="pv-exit" id="pvExit" href="#/e/${esc(code)}" aria-label="Leave presenter view">‹ Exit</a>
        <p class="pv-event" id="pvEvent"></p>
        <p class="pv-clock" id="pvClock"></p>
        <button class="pv-exit" id="pvFull" type="button">Full screen</button>
      </header>
      <main class="pv-main">
        <section class="pv-now" aria-live="polite">
          <p class="pv-label" id="pvLabel"></p>
          <h1 class="pv-title" id="pvTitle"></h1>
          <p class="pv-lead" id="pvLead"></p>
          <p class="pv-cue" id="pvCue" hidden></p>
          <p class="pv-caption" id="pvCaption"></p>
          <p class="pv-time" id="pvTime"></p>
          <div class="pv-bar"><span id="pvBar"></span></div>
          <p class="pv-sub" id="pvSub"></p>
        </section>
        <aside class="pv-side">
          <div class="pv-msg" id="pvMsg" hidden></div>
          <div class="pv-notes" id="pvNotes" hidden></div>
          <h2 class="pv-h">Coming up</h2>
          <ol class="pv-next" id="pvNext"></ol>
        </aside>
      </main>
    </div>`;

  const pv = $('#presenter');
  // Opened by Present in its own window: Exit closes that window.
  $('#pvExit').addEventListener('click', (e) => {
    if (window.opener && window.name.startsWith('et-')) { e.preventDefault(); window.close(); }
  });
  const fullBtn = $('#pvFull');
  const syncFull = () => { fullBtn.hidden = Boolean(document.fullscreenElement) || !document.documentElement.requestFullscreen; };
  fullBtn.addEventListener('click', () => document.documentElement.requestFullscreen?.().catch(() => {}));
  document.addEventListener('fullscreenchange', syncFull);
  syncFull();
  let lastSide = '';

  const draw = (raw, live) => {
    const now = live.now();
    const view = effective(raw, now);
    const ev = view.event;
    const c = clockOf(view, now);
    const tone = clockTone(c);
    pv.dataset.tone = tone;
    $('#pvEvent').textContent = ev.name;
    $('#pvClock').textContent = fmtClock(now);

    let label = '';
    let title = '';
    let caption = TONE_CAPTION[tone];
    let time = '';
    let sub = '';
    if (c.status === 'countdown') {
      label = 'Starting soon';
      title = view.segments[0]?.title || ev.name;
      caption = 'Starts in';
      time = fmtDuration(c.startsInMs);
      sub = `Starts at ${fmtClock(ev.planned_start)}`;
    } else if (c.status === 'ready') {
      label = 'Not started yet';
      title = view.segments[0]?.title || ev.name;
      // No timer until the admin presses Start.
      caption = '';
      time = '';
      sub = view.segments[0] ? `${fmtSpan(view.segments[0].duration_s * 1000)} slot` : '';
    } else if (c.status === 'ended') {
      label = 'Finished';
      title = 'The program has ended';
      caption = '';
    } else {
      label = `Now · ${c.index + 1} of ${c.count}`;
      title = c.segment?.title || '';
      time = fmtDuration(Math.abs(c.remainingMs));
      sub = `${fmtSpan(c.allotMs)} slot · started ${fmtClock(ev.segment_started_at)}`;
    }
    $('#pvLabel').textContent = label;
    $('#pvTitle').textContent = title;
    const lead = c.status !== 'ready' && c.status !== 'countdown' && c.status !== 'ended' ? c.segment?.lead || '' : view.segments[0]?.lead || '';
    $('#pvLead').textContent = lead;
    $('#pvLead').hidden = !lead;
    $('#pvCue').textContent = CUE[tone];
    $('#pvCue').hidden = !CUE[tone];
    $('#pvCaption').textContent = caption;
    $('#pvCaption').hidden = !caption || !time;
    $('#pvTime').textContent = time;
    $('#pvTime').hidden = !time;
    $('#pvBar').style.width = `${(c.progress * 100).toFixed(2)}%`;
    $('#pvBar').parentElement.hidden = !(c.status === 'live' || c.status === 'hold');
    $('#pvSub').textContent = sub;

    // The side panel changes rarely; only redraw it when it does.
    const current = c.status === 'ready' || c.status === 'countdown' ? view.segments[0] : c.segment;
    const rows = timelineOf(view, now).filter((r) => r.state === 'upcoming' && r.id !== current?.id).slice(0, 4);
    const side = JSON.stringify([ev.message, current?.notes, rows.map((r) => [r.id, r.title, r.lead, Math.round((r.expectedStart || 0) / 60000)])]);
    if (side !== lastSide) {
      lastSide = side;
      const msg = $('#pvMsg');
      msg.hidden = !ev.message;
      msg.innerHTML = ev.message ? `<p class="pv-h">Announcement</p><p>${esc(ev.message)}</p>` : '';
      const notes = $('#pvNotes');
      notes.hidden = !current?.notes;
      notes.innerHTML = current?.notes ? `<p class="pv-h">Notes for this part</p><p>${esc(current.notes)}</p>` : '';
      $('#pvNext').innerHTML = rows.length
        ? rows.map((r) => `<li><span class="pv-when">${r.expectedStart != null ? esc(fmtClock(r.expectedStart)) : ''}</span>
            <span class="pv-what"><strong>${esc(r.title)}</strong>${r.lead ? `<span>${esc(r.lead)}</span>` : ''}</span>
            <span class="pv-len">${esc(fmtSpan(r.duration_s * 1000))}</span></li>`).join('')
        : `<li class="pv-none">${c.status === 'ended' ? 'Nothing more today.' : 'This is the last part of the program.'}</li>`;
    }
  };

  const cleanup = mountEvent(code, {
    notices: { role: 'presenter' },
    onNotFound() { location.hash = `#/e/${code}`; },
    render: draw,
    tick: draw,
  });

  return () => {
    cleanup();
    keepAwake(false);
    setPill('');
    document.removeEventListener('fullscreenchange', syncFull);
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
  };
}
