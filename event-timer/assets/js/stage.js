// The big screen: a projector, a TV by the stage, a speaker's monitor.
// Read from across a room: just the time, what is on, and what is next.
import { esc, $, keepAwake, prettyCode } from './ui.js';
import { setHeader, mountEvent, setPill } from './shell.js';
import { clockOf, effective, fmtDuration, fmtClock, fmtSpan } from './time.js';
import { clockTone, TONE_CAPTION } from './components.js';

export function stageView(root, code) {
  setHeader({ title: 'Big screen', subtitle: prettyCode(code), back: `#/e/${code}` });
  document.body.classList.add('is-stage');
  keepAwake(true);
  root.innerHTML = `
    <div class="stage" id="stage">
      <div class="stage-top">
        <p class="stage-event" id="stageEvent"></p>
        <p class="stage-clock" id="stageClock"></p>
      </div>
      <h1 class="stage-title" id="stageTitle"></h1>
      <p class="stage-label" id="stageLabel"></p>
      <p class="stage-time" id="stageTime"></p>
      <div class="stage-bar"><span id="stageBar"></span></div>
      <p class="stage-next" id="stageNext"></p>
      <p class="stage-msg" id="stageMsg" hidden></p>
      <div class="stage-tools" id="stageTools">
        <a class="btn" id="stageExit" href="#/e/${esc(code)}">Exit</a>
        <button class="btn" id="fs">Full screen</button>
        <span id="stagePill"></span>
      </div>
    </div>`;

  const stage = $('#stage');
  $('#stageExit').addEventListener('click', (e) => {
    if (window.opener && window.name.startsWith('et-')) { e.preventDefault(); window.close(); }
  });
  let hideTimer = null;
  const showTools = () => {
    stage.classList.add('show-tools');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => stage.classList.remove('show-tools'), 3500);
  };
  stage.addEventListener('pointermove', showTools);
  stage.addEventListener('click', showTools);
  showTools();
  $('#fs').addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen?.();
    else stage.requestFullscreen?.().catch(() => {});
  });

  const draw = (raw, live) => {
    const now = live.now();
    const view = effective(raw, now);
    const ev = view.event;
    const c = clockOf(view, now);
    const tone = clockTone(c);
    stage.dataset.tone = tone;
    $('#stageEvent').textContent = ev.name;
    $('#stageClock').textContent = fmtClock(now);
    let label = '';
    let title = '';
    let time = '';
    let next = '';
    if (c.status === 'countdown') {
      label = 'Starts in';
      title = view.segments[0]?.title || ev.name;
      time = fmtDuration(c.startsInMs);
      next = `Starts at ${fmtClock(ev.planned_start)}`;
    } else if (c.status === 'ready') {
      // No timer until the admin presses Start.
      label = 'Starting soon';
      title = view.segments[0]?.title || ev.name;
      time = '';
    } else if (c.status === 'ended') {
      label = 'Thank you';
      title = 'Program ended';
      time = '';
    } else {
      label = TONE_CAPTION[tone];
      title = c.segment?.title || '';
      time = fmtDuration(Math.abs(c.remainingMs));
      if (c.next) next = `Next: ${c.next.title} · ${fmtSpan(c.next.duration_s * 1000)}`;
    }
    $('#stageLabel').textContent = label;
    $('#stageTitle').textContent = title;
    $('#stageTime').textContent = time;
    $('#stageTime').hidden = !time;
    $('#stageBar').style.width = `${(c.progress * 100).toFixed(2)}%`;
    $('#stageBar').parentElement.hidden = !(c.status === 'live' || c.status === 'hold');
    $('#stageNext').textContent = next;
    const msg = $('#stageMsg');
    msg.hidden = !ev.message;
    msg.textContent = ev.message || '';
  };

  const cleanup = mountEvent(code, {
    onNotFound() { location.hash = `#/e/${code}`; },
    render(view, live) {
      draw(view, live);
      $('#stagePill').innerHTML = $('#pill').innerHTML;
    },
    tick: draw,
  });

  return () => {
    cleanup();
    keepAwake(false);
    clearTimeout(hideTimer);
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    setPill('');
  };
}
