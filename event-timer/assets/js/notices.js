// Notes from Master control: a full-screen pop-up in very big type, which
// stays until the person taps "I've read it". Then, if the note has a
// countdown ("5 minutes to wrap up"), a bar along the bottom keeps counting.
//
// Who sees a note: "everyone" notes go to every phone (facilitator view,
// stations, presenter view); "stations" notes only to station screens, or
// only to the stations chosen. Master control and the big screen never pop up.
import { esc, vibrate } from './ui.js';
import { fmtDuration, fmtClock } from './time.js';
import { deviceId, hasAcked, markAcked, myName, stationAccess } from './store.js';

function forMe(n, role, stationId) {
  if (n.audience === 'everyone') return true;
  if (role !== 'station') return false;
  return !n.station_ids || n.station_ids.includes(stationId);
}

function timerTone(left) {
  if (left <= 0) return 'bad';
  if (left <= 60_000) return 'warn';
  return 'ok';
}

export function createNotices(code, live, { role, stationId = null }) {
  const layer = document.createElement('div');
  layer.className = 'notice-layer';
  document.body.appendChild(layer);
  let shownId = null;
  let mine = [];

  const pick = (view, now) => {
    mine = (view.notices || []).filter((n) => n.show_at <= now && forMe(n, role, stationId));
    const pending = mine.filter((n) => !hasAcked(n.id)); // newest first, as sent
    const running = mine
      .filter((n) => hasAcked(n.id) && n.ends_at != null && now - n.ends_at < 60_000)
      .sort((a, b) => a.ends_at - b.ends_at);
    return { pending, running };
  };

  const confirm = (n) => {
    markAcked(n.id);
    const station = stationAccess(code);
    live.send('et_ack', {
      p_code: code,
      p_notice: n.id,
      p_device: deviceId(),
      p_key: station ? station.key : null,
      p_name: myName(),
    });
  };

  const draw = (view) => {
    const now = live.now();
    const { pending, running } = pick(view, now);
    const n = pending[0];
    if (n) {
      const left = n.ends_at != null ? n.ends_at - now : null;
      if (shownId !== n.id) {
        shownId = n.id;
        layer.innerHTML = `
          <div class="notice-overlay" role="alertdialog" aria-modal="true" aria-labelledby="noticeText">
            <p class="notice-from">Note from Master control · ${esc(fmtClock(n.show_at))}</p>
            <p class="notice-text" id="noticeText">${esc(n.text)}</p>
            <p class="notice-timer" id="noticeTimer" hidden></p>
            <button class="notice-ok" type="button" id="noticeOk">I’ve read it</button>
            <p class="notice-more" id="noticeMore"></p>
          </div>`;
        layer.querySelector('#noticeOk').addEventListener('click', () => {
          confirm(n);
          shownId = null;
          draw(live.view() || view);
        });
        vibrate([200, 100, 200, 100, 400]);
        layer.querySelector('#noticeOk').focus({ preventScroll: true });
      }
      const timer = layer.querySelector('#noticeTimer');
      timer.hidden = left == null;
      if (left != null) {
        timer.dataset.tone = timerTone(left);
        timer.innerHTML = left > 0 ? `${esc(fmtDuration(left))} <span>left</span>` : `Time is up <span>+${esc(fmtDuration(-left))}</span>`;
      }
      const more = pending.length - 1;
      layer.querySelector('#noticeMore').textContent = more > 0 ? `${more} more note${more > 1 ? 's' : ''} after this` : '';
      document.body.classList.add('has-notice');
      return;
    }
    shownId = null;
    document.body.classList.remove('has-notice');
    const r = running[0];
    if (r) {
      const left = r.ends_at - now;
      layer.innerHTML = `<div class="notice-bar" data-tone="${timerTone(left)}" role="status">
        <span class="notice-bar-text">${esc(r.text)}</span>
        <strong>${left > 0 ? `${esc(fmtDuration(left))} left` : 'Time is up'}</strong></div>`;
    } else {
      layer.innerHTML = '';
    }
  };

  return {
    update: draw,
    tick: draw,
    destroy() {
      layer.remove();
      document.body.classList.remove('has-notice');
    },
  };
}
