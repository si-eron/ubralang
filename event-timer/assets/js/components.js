// Pieces drawn on more than one screen: the clock, the run of show, stations.
import { clockOf, timelineOf, fmtDuration, fmtClock, fmtDelta, fmtSpan, stationSince } from './time.js';
import { esc, CROWD, ago } from './ui.js';

// When the countdown turns amber.
export function warnAtMs(allotMs) {
  return allotMs >= 10 * 60_000 ? 120_000 : 60_000;
}

export function clockTone(clock) {
  if (clock.status === 'hold') return 'hold';
  if (clock.status !== 'live') return 'idle';
  if (clock.overtime) return 'bad';
  if (clock.remainingMs <= warnAtMs(clock.allotMs)) return 'warn';
  return 'ok';
}

// The big card: what is on now, how long is left, what is next.
export function heroHtml(view, now, { compact = false } = {}) {
  const ev = view.event;
  const clock = clockOf(view, now);
  const tone = clockTone(clock);
  const delta = fmtDelta(clock.deltaMs);
  let label;
  let title;
  let big;
  let sub = '';

  if (clock.status === 'ready') {
    label = 'Not started';
    title = view.segments.length ? 'Waiting to begin' : 'No program yet';
    if (clock.startsInMs != null && clock.startsInMs > 0) {
      big = fmtDuration(clock.startsInMs);
      sub = `Starts at ${fmtClock(ev.planned_start)}`;
    } else if (clock.startsInMs != null) {
      big = fmtDuration(-clock.startsInMs, { sign: true });
      sub = `Was due at ${fmtClock(ev.planned_start)}`;
    } else {
      big = '—:—';
    }
  } else if (clock.status === 'ended') {
    label = 'Ended';
    title = 'Program finished';
    big = fmtClock(ev.ended_at);
    sub = ev.started_at ? `Ran ${fmtSpan(ev.ended_at - ev.started_at)}, ${fmtClock(ev.started_at)}–${fmtClock(ev.ended_at)}` : '';
  } else {
    label = clock.status === 'hold' ? 'On hold' : `Now · ${clock.index + 1} of ${clock.count}`;
    title = clock.segment ? clock.segment.title : '';
    big = clock.overtime ? fmtDuration(clock.remainingMs, { sign: true }) : fmtDuration(clock.remainingMs);
    const extra = ev.segment_extra_s ? ` (${ev.segment_extra_s > 0 ? '+' : '−'}${fmtSpan(Math.abs(ev.segment_extra_s) * 1000)})` : '';
    sub = clock.overtime
      ? `Over time · ${fmtSpan(clock.allotMs)} slot${extra}`
      : `left of ${fmtSpan(clock.allotMs)}${extra} · started ${fmtClock(ev.segment_started_at)}`;
  }

  const lead = clock.segment && clock.status !== 'ready' && clock.status !== 'ended' && clock.segment.lead
    ? `<p class="hero-lead">${esc(clock.segment.lead)}</p>` : '';
  const progress = clock.status === 'live' || clock.status === 'hold'
    ? `<div class="bar" aria-hidden="true"><span style="width:${(clock.progress * 100).toFixed(2)}%"></span></div>` : '';
  const next = clock.next && clock.status !== 'ended'
    ? `<p class="hero-next"><span class="eyebrow">Next</span> ${esc(clock.next.title)} <span class="muted">· ${fmtSpan(clock.next.duration_s * 1000)}</span></p>`
    : '';
  const facts = [];
  if (delta && clock.status !== 'ended') facts.push(`<span class="chip chip-${delta.tone}">${esc(delta.label)}</span>`);
  if (delta && clock.status === 'ended') facts.push(`<span class="chip chip-${delta.tone}">Finished ${esc(delta.label.toLowerCase())}</span>`);
  if (clock.projectedEnd && clock.status !== 'ended' && clock.count) facts.push(`<span class="muted">Ends about ${fmtClock(clock.projectedEnd)}</span>`);

  return `
    <section class="hero hero-${tone}${compact ? ' hero-compact' : ''}" aria-label="Program clock">
      <p class="hero-label"><span class="state-dot" aria-hidden="true"></span>${esc(label)}</p>
      <h2 class="hero-title">${esc(title)}</h2>
      ${lead}
      <p class="hero-time" aria-hidden="${clock.status === 'live' ? 'true' : 'false'}">${esc(big)}</p>
      ${sub ? `<p class="hero-sub">${esc(sub)}</p>` : ''}
      ${progress}
      ${compact ? '' : next}
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
      when = `About ${fmtClock(r.expectedStart)}`;
      if (r.plannedStart != null && Math.abs(r.expectedStart - r.plannedStart) >= 60_000) {
        when += ` <span class="muted">(planned ${fmtClock(r.plannedStart)})</span>`;
      }
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

export function stationCard(station, now, { mine = false } = {}) {
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
    <p class="station-phase"><strong>${esc(phase)}</strong>${since ? ` <span class="muted">· for ${esc(since)}</span>` : ''}</p>
    ${phaseSteps(station)}
    ${station.note ? `<p class="station-note">“${esc(station.note)}”</p>` : ''}
    <p class="station-updated muted">${station.pending ? 'Saved on this phone · uploading' : station.updated_at ? `Updated ${ago(station.updated_at, now)}${station.updated_by ? ` by ${esc(station.updated_by)}` : ''}` : 'No update yet'}</p>
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
  const list = view.stations.filter((s) => !filter || s.crowd === filter);
  return `${stationsSummary(view.stations)}
    <div class="stations">${list.map((s) => stationCard(s, now, { mine: s.id === mine })).join('') || '<p class="empty">No station matches.</p>'}</div>`;
}

export function logHtml(view) {
  if (!view.log || !view.log.length) return '<p class="empty">Nothing has happened yet.</p>';
  return `<ul class="log">${view.log.map((l) => `<li class="log-${esc(l.kind)}"><time>${fmtClock(l.at)}</time> ${esc(l.text)}</li>`).join('')}</ul>`;
}
