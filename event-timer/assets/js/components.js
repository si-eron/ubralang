// Pieces drawn on more than one screen: the clock, the run of show, stations.
import { clockOf, timelineOf, effective, fmtDuration, fmtClock, fmtDelta, fmtSpan, stationSince, stationPhaseOf } from './time.js';
import { esc, CROWD, ago } from './ui.js';

// When the countdown turns orange: the last two minutes of a segment, or the
// last minute of one shorter than ten minutes.
export function warnAtMs(allotMs) {
  return allotMs >= 10 * 60_000 ? 120_000 : 60_000;
}

// ok (plenty of time) · warn (orange: almost out) · bad (red: over time)
// · hold (stopped) · idle (not started or finished)
export function clockTone(clock) {
  if (clock.status === 'hold') return 'hold';
  if (clock.status !== 'live') return 'idle';
  if (clock.overtime) return 'bad';
  if (clock.remainingMs <= warnAtMs(clock.allotMs)) return 'warn';
  return 'ok';
}

// The words above the big number, for each tone.
export const TONE_CAPTION = {
  ok: 'Time left',
  warn: 'Almost time',
  bad: 'Over time by',
  hold: 'On hold · time left',
  idle: '',
};

// The big card everyone watches: what is on now, how long is left, what is next.
export function heroHtml(raw, now, { compact = false } = {}) {
  const view = effective(raw, now);
  const ev = view.event;
  const clock = clockOf(view, now);
  const tone = clockTone(clock);
  const delta = fmtDelta(clock.deltaMs);
  let label;
  let title;
  let big;
  let caption = TONE_CAPTION[tone];
  let sub = '';

  if (clock.status === 'countdown') {
    // Start was pressed: count down to the planned start.
    label = 'Starting soon';
    title = view.segments.length ? `First: ${view.segments[0].title}` : 'Starting soon';
    caption = 'Starts in';
    big = fmtDuration(clock.startsInMs);
    sub = `Starts at ${fmtClock(ev.planned_start)}. The program begins by itself.`;
  } else if (clock.status === 'ready') {
    label = 'Not started yet';
    title = view.segments.length ? `First: ${view.segments[0].title}` : 'No program yet';
    // No clock until the admin presses Start: not a countdown to the start,
    // and not "behind" before anything has begun.
    big = '';
    sub = ev.planned_start != null
      ? `Planned to start at ${fmtClock(ev.planned_start)}. The clock starts when the admin presses Start.`
      : 'The clock starts when the admin presses Start.';
  } else if (clock.status === 'ended') {
    label = 'Finished';
    title = 'The program has ended';
    caption = 'Ended at';
    big = fmtClock(ev.ended_at);
    sub = ev.started_at ? `Ran ${fmtSpan(ev.ended_at - ev.started_at)}, ${fmtClock(ev.started_at)} to ${fmtClock(ev.ended_at)}` : '';
  } else {
    label = `Now · ${clock.index + 1} of ${clock.count}`;
    title = clock.segment ? clock.segment.title : '';
    big = fmtDuration(Math.abs(clock.remainingMs));
    const extra = ev.segment_extra_s ? ` (${ev.segment_extra_s > 0 ? '+' : '−'}${fmtSpan(Math.abs(ev.segment_extra_s) * 1000)} added)` : '';
    sub = `${fmtSpan(clock.allotMs)} slot${extra} · started ${fmtClock(ev.segment_started_at)}`;
  }

  const lead = clock.segment && clock.status !== 'ready' && clock.status !== 'ended' && clock.segment.lead
    ? `<p class="hero-lead">${esc(clock.segment.lead)}</p>` : '';
  const progress = clock.status === 'live' || clock.status === 'hold'
    ? `<div class="bar" aria-hidden="true"><span style="width:${(clock.progress * 100).toFixed(2)}%"></span></div>` : '';
  // Before the start the title already names the first segment, so "then" is the second.
  const notYet = clock.status === 'ready' || clock.status === 'countdown';
  const upcoming = notYet ? view.segments[1] : clock.next;
  const next = upcoming && clock.status !== 'ended'
    ? `<p class="hero-next"><span class="eyebrow">${notYet ? 'Then' : 'Next'}</span> ${esc(upcoming.title)} <span class="hero-dim">· ${fmtSpan(upcoming.duration_s * 1000)}</span></p>`
    : '';
  const facts = [];
  if (delta && !notYet && clock.status !== 'ended') facts.push(`<span class="chip chip-${delta.tone}">${esc(delta.label)}</span>`);
  if (delta && clock.status === 'ended') facts.push(`<span class="chip chip-${delta.tone}">Finished ${esc(delta.label.toLowerCase())}</span>`);
  // Schedule update: the next item's new time, everywhere at once.
  let sched = '';
  if (clock.nextStart != null && clock.nextPlannedStart != null && !notYet) {
    const late = clock.nextStart - clock.nextPlannedStart;
    if (late >= 60_000) {
      sched = `<p class="hero-sched">Schedule updated: running ${esc(fmtSpan(late))} late · next starts <strong>${esc(fmtClock(clock.nextStart))}</strong> instead of ${esc(fmtClock(clock.nextPlannedStart))}${clock.deltaMs != null && clock.deltaMs < 60_000 ? ' · breaks shorten to finish on time' : ''}</p>`;
    } else if (clock.shrunkMs >= 60_000) {
      sched = `<p class="hero-sched">This break is ${esc(fmtSpan(clock.shrunkMs))} shorter to catch up · next starts ${esc(fmtClock(clock.nextStart))} as planned</p>`;
    }
  }
  if (clock.projectedEnd && clock.status !== 'ended' && clock.status !== 'ready' && clock.count) facts.push(`<span class="hero-dim">Ends about ${fmtClock(clock.projectedEnd)}</span>`);

  return `
    <section class="hero hero-${tone}${compact ? ' hero-compact' : ''}" aria-label="Program clock">
      <p class="hero-label"><span class="state-dot" aria-hidden="true"></span>${esc(label)}</p>
      <h2 class="hero-title">${esc(title)}</h2>
      ${lead}
      ${big ? `<p class="hero-caption">${esc(caption)}</p><p class="hero-time">${esc(big)}</p>` : ''}
      ${sub ? `<p class="hero-sub">${esc(sub)}</p>` : ''}
      ${progress}
      ${compact ? '' : next}
      ${sched}
      ${facts.length && !compact ? `<div class="hero-facts">${facts.join('')}</div>` : ''}
    </section>`;
}

export function messageHtml(view) {
  const ev = view.event;
  if (!ev.message) return '';
  return `<div class="announce" role="alert"><span class="eyebrow">Announcement · ${fmtClock(ev.message_at)}</span><p>${esc(ev.message)}</p></div>`;
}

// The run of show.
export function programHtml(view, now, { admin = false } = {}) {
  if (!view.segments.length) {
    return `<p class="empty">${admin ? 'No segments yet. Add the program under the Program tab.' : 'The program has not been added yet.'}</p>`;
  }
  const rows = timelineOf(view, now);
  return `<ol class="runsheet">${rows.map((r) => {
    let when = '';
    if (r.state === 'done') {
      const diff = r.actualMs - r.duration_s * 1000;
      const d = Math.abs(diff) < 30_000 ? '' : ` <span class="${diff > 0 ? 'over' : 'under'}">${diff > 0 ? '+' : '−'}${fmtSpan(diff)}</span>`;
      when = `${fmtClock(r.started_at)} · ran ${fmtSpan(r.actualMs)}${d}`;
    } else if (r.state === 'now') {
      when = `Started ${fmtClock(r.started_at)}`;
    } else if (r.state === 'skipped') {
      when = 'Skipped';
    } else if (r.expectedStart != null) {
      when = `<strong>${fmtClock(r.expectedStart)}</strong>`;
      if (r.plannedStart != null && Math.abs(r.lateMs ?? 0) >= 60_000) {
        when += ` <span class="${r.lateMs > 0 ? 'over' : 'under'}">(planned ${fmtClock(r.plannedStart)}, ${r.lateMs > 0 ? '+' : '−'}${fmtSpan(r.lateMs)})</span>`;
      }
      if (r.shrinkMs >= 60_000) when += ` <span class="chip chip-warn">${fmtSpan(r.shrinkMs)} shorter to catch up</span>`;
    } else if (r.plannedStart != null) {
      when = fmtClock(r.plannedStart);
    }
    const go = admin && r.state !== 'now'
      ? `<button class="btn btn-small" data-goto="${r.index}" aria-label="Start ${esc(r.title)} now">Go</button>` : '';
    return `<li class="run run-${r.state}">
      <span class="run-num" aria-hidden="true">${r.state === 'done' ? '✓' : r.index + 1}</span>
      <div class="run-main">
        <p class="run-title">${esc(r.title)}${r.state === 'now' ? ' <span class="chip chip-live">Now</span>' : ''}</p>
        <p class="run-meta">${fmtSpan(r.duration_s * 1000)}${r.lead ? ` · ${esc(r.lead)}` : ''}</p>
        ${r.notes && admin ? `<p class="run-notes">${esc(r.notes)}</p>` : ''}
      </div>
      <p class="run-when">${when}</p>
      ${go}
    </li>`;
  }).join('')}</ol>`;
}

export function crowdChip(crowd) {
  const c = CROWD[crowd] || CROWD.open;
  return `<span class="chip chip-${c.tone} chip-crowd">${esc(c.label)}</span>`;
}

export function phaseSteps(station) {
  return `<ol class="steps" aria-label="Station program">${station.phases.map((p, i) => {
    const state = i < station.phase_index ? 'done' : i === station.phase_index ? 'now' : 'todo';
    return `<li class="step step-${state}"><span class="sr-only">${state === 'now' ? 'Current: ' : state === 'done' ? 'Done: ' : ''}</span>${esc(p)}</li>`;
  }).join('')}</ol>`;
}

// How many have this station's controls open right now (null: not known yet).
function onlineChip(n) {
  if (n == null) return '';
  return n > 0
    ? `<span class="online online-on"><span class="online-dot" aria-hidden="true"></span>${n} online</span>`
    : '<span class="online online-off"><span class="online-dot" aria-hidden="true"></span>No one online</span>';
}

// "Online now: 14 in Facilitator view · 1 presenting · 1 in Master control"
export function onlineHtml(view) {
  const p = view.presence;
  if (!p) return '';
  const atStations = Object.values(p.stations || {}).reduce((a, b) => a + b, 0);
  const parts = [`<strong>${p.viewer}</strong> in Facilitator view`];
  if (view.event.stations_enabled && view.stations.length) parts.push(`<strong>${atStations}</strong> at stations`);
  if (p.presenter) parts.push(`<strong>${p.presenter}</strong> presenting`);
  if (p.admin) parts.push(`<strong>${p.admin}</strong> in Master control`);
  return `<p class="online-now" role="status"><span class="online-dot" aria-hidden="true"></span>Online now: ${parts.join(' · ')}</p>`;
}

export function stationCard(station, now, { mine = false, online = null } = {}) {
  const phase = station.phase_index >= 0 ? station.phases[station.phase_index] : 'Not started';
  const since = station.phase_index >= 0 ? stationSince(station, now) : null;
  return `<article class="station station-${station.crowd}${mine ? ' station-mine' : ''}" data-station="${esc(station.id)}">
    <header class="station-head">
      <div>
        <h3>${esc(station.name)}${mine ? ' <span class="chip chip-muted">Yours</span>' : ''}</h3>
        ${station.location ? `<p class="muted">${esc(station.location)}</p>` : ''}
      </div>
      ${crowdChip(station.crowd)}
    </header>
    <p class="station-phase"><strong>${esc(phase)}</strong>${since ? ` <span class="muted">· for ${esc(since)}</span>` : ''}${station.auto ? ' <span class="chip chip-muted">from the program</span>' : ''}</p>
    ${phaseSteps(station)}
    ${station.note ? `<p class="station-note">“${esc(station.note)}”</p>` : ''}
    ${onlineChip(online)}
    <p class="station-updated muted">${station.pending ? 'Saved on this phone · uploading' : station.updated_at ? `Updated ${ago(station.updated_at, now)} by ${station.updated_by ? esc(station.updated_by) : 'a facilitator'}` : 'No update from the facilitators yet'}</p>
  </article>`;
}

export function stationsSummary(stations) {
  const counts = { open: 0, filling: 0, full: 0, closed: 0 };
  for (const s of stations) counts[s.crowd] += 1;
  return `<div class="summary" role="group" aria-label="Stations at a glance">
    ${Object.entries(counts).map(([k, n]) => `<button class="summary-item summary-${CROWD[k].tone}" data-filter="${k}" aria-pressed="false">
      <span class="summary-n">${n}</span><span>${esc(CROWD[k].label)}</span></button>`).join('')}
  </div>`;
}

export function stationsBoardHtml(view, now, { mine = null, filter = null } = {}) {
  if (!view.event.stations_enabled || !view.stations.length) {
    return '<p class="empty">This event is not using stations.</p>';
  }
  const v = effective(view, now);
  const list = view.stations.map((s) => ({ ...s, ...stationPhaseOf(s, v) })).filter((s) => !filter || s.crowd === filter);
  const online = (id) => (view.presence ? view.presence.stations?.[id] || 0 : null);
  return `${onlineHtml(view)}${stationsSummary(view.stations)}
    <div class="stations">${list.map((s) => stationCard(s, now, { mine: s.id === mine, online: online(s.id) })).join('') || '<p class="empty">No station matches.</p>'}</div>`;
}

export function logHtml(view) {
  if (!view.log || !view.log.length) return '<p class="empty">Nothing has happened yet.</p>';
  return `<ul class="log">${view.log.map((l) => `<li class="log-${esc(l.kind)}"><time>${fmtClock(l.at)}</time> ${esc(l.text)}</li>`).join('')}</ul>`;
}

// Master control at a glance: who is online, and every station's step, how
// full it is and how many facilitators have it open, in one short table.
export function liveGlanceHtml(view, now) {
  const on = view.event.stations_enabled && view.stations.length;
  const v = effective(view, now);
  const rows = on ? view.stations.map((raw) => {
    const s = { ...raw, ...stationPhaseOf(raw, v) };
    const n = view.presence ? view.presence.stations?.[s.id] || 0 : null;
    return `<tr><th scope="row">${esc(s.name)}</th>
      <td>${esc(s.phase_index >= 0 ? s.phases[s.phase_index] : 'Not started')}</td>
      <td>${crowdChip(s.crowd)}</td>
      <td>${onlineChip(n)}</td></tr>`;
  }).join('') : '';
  return `<section class="glance card" aria-label="Live now">
    <h2 class="panel-title">Live now</h2>
    ${onlineHtml(view) || '<p class="muted">Checking who is online…</p>'}
    ${on ? `<div class="glance-scroll"><table class="glance-table">
      <thead><tr><th>Station</th><th>Step</th><th>Status</th><th>Phones</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : ''}
  </section>`;
}
