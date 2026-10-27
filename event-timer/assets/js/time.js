// Everything about time, worked out the same way on every screen.
// Pure functions: given the event as the server last described it and "now" on
// the server's clock, say what the clock shows. No DOM, no network.

const MIN = 60_000;

// A countdown that has reached its planned start has started: the first
// segment began at that moment. Every screen works this out for itself, so the
// program starts on time on all of them even if no admin phone is open; the
// server writes it down the next time the admin does anything.
export function effective(snapshot, now) {
  const ev = snapshot.event;
  if (ev.status !== 'countdown' || ev.planned_start == null || now < ev.planned_start || !snapshot.segments?.length) {
    return snapshot;
  }
  const at = ev.planned_start;
  return {
    ...snapshot,
    event: { ...ev, status: 'live', current_index: 0, segment_started_at: at, started_at: at, segment_extra_s: 0, hold_total_ms: 0, hold_started_at: null },
    segments: snapshot.segments.map((s, i) => (i === 0 ? { ...s, started_at: at, ended_at: null } : s)),
  };
}

// The live clock for the segment on stage.
export function clockOf(raw, now) {
  const snapshot = effective(raw, now);
  const ev = snapshot.event;
  const segments = snapshot.segments || [];
  const index = ev.current_index;
  const segment = index >= 0 ? segments[index] || null : null;
  const next = index + 1 < segments.length ? segments[index + 1] : null;
  const total = segments.reduce((sum, s) => sum + s.duration_s * 1000, 0);
  const before = (i) => segments.slice(0, Math.max(0, i)).reduce((sum, s) => sum + s.duration_s * 1000, 0);
  const after = (i) => segments.slice(i + 1).reduce((sum, s) => sum + s.duration_s * 1000, 0);

  const out = {
    status: ev.status,
    index,
    segment,
    next: ev.status === 'ready' || ev.status === 'countdown' ? segments[0] || null : next,
    count: segments.length,
    elapsedMs: 0,
    allotMs: 0,
    remainingMs: 0,
    overtime: false,
    progress: 0,
    heldMs: 0,
    plannedEnd: null,
    projectedEnd: null,
    deltaMs: null, // projected end minus planned end: positive is behind
    startsInMs: null,
  };

  // The base everything is planned from: the start written on the event, or
  // failing that the moment the first segment actually began.
  const base = ev.planned_start ?? ev.started_at ?? null;
  if (base != null) out.plannedEnd = base + total;

  if (ev.status === 'countdown') {
    // Start was pressed: counting down to the planned start.
    out.startsInMs = Math.max(0, ev.planned_start - now);
    out.projectedEnd = ev.planned_start + total;
    out.deltaMs = 0;
    return out;
  }

  if (ev.status === 'ready') {
    if (ev.planned_start != null) {
      out.startsInMs = ev.planned_start - now;
      out.projectedEnd = Math.max(now, ev.planned_start) + total;
      out.deltaMs = out.projectedEnd - out.plannedEnd;
    }
    return out;
  }

  if (segment && ev.segment_started_at != null) {
    const until = ev.status === 'hold' && ev.hold_started_at != null ? ev.hold_started_at : now;
    out.heldMs = ev.hold_total_ms + (ev.status === 'hold' && ev.hold_started_at != null ? now - ev.hold_started_at : 0);
    out.elapsedMs = Math.max(0, until - ev.segment_started_at - ev.hold_total_ms);
    out.allotMs = Math.max(0, (segment.duration_s + ev.segment_extra_s) * 1000);
    out.remainingMs = out.allotMs - out.elapsedMs;
    out.overtime = out.remainingMs < 0;
    out.progress = out.allotMs > 0 ? Math.min(1, out.elapsedMs / out.allotMs) : 1;
  }

  if (ev.status === 'ended') {
    out.projectedEnd = ev.ended_at;
  } else if (segment) {
    out.projectedEnd = now + Math.max(0, out.remainingMs) + after(index);
  }
  if (out.plannedEnd != null && out.projectedEnd != null) {
    out.deltaMs = out.projectedEnd - out.plannedEnd;
  }
  out.plannedStartOfCurrent = base != null ? base + before(index) : null;
  return out;
}

// Each segment's place in the day: when it was planned, when it really ran,
// and when the ones still to come should now start.
export function timelineOf(raw, now) {
  const snapshot = effective(raw, now);
  const ev = snapshot.event;
  const segments = snapshot.segments || [];
  const clock = clockOf(snapshot, now);
  const base = ev.planned_start ?? ev.started_at ?? null;
  let planned = base;
  const notYet = ev.status === 'ready' || ev.status === 'countdown';
  let expected = notYet
    ? Math.max(now, ev.planned_start ?? now)
    : now + Math.max(0, clock.remainingMs);

  return segments.map((s, i) => {
    const row = {
      ...s,
      index: i,
      plannedStart: planned,
      state: 'upcoming', // done | now | skipped | upcoming
      actualMs: null,
      expectedStart: null,
    };
    if (planned != null) planned += s.duration_s * 1000;

    if (ev.status !== 'ready' && i === ev.current_index && ev.status !== 'ended') {
      row.state = 'now';
    } else if (s.started_at != null && s.ended_at != null) {
      row.state = 'done';
      row.actualMs = s.ended_at - s.started_at;
    } else if (ev.status !== 'ready' && i < ev.current_index) {
      row.state = 'skipped';
    } else if (ev.status === 'ended' && i === ev.current_index) {
      row.state = 'done';
    }
    if (row.state === 'upcoming' && (notYet || i > ev.current_index)) {
      row.expectedStart = expected;
      expected += s.duration_s * 1000;
    }
    return row;
  });
}

// "12:05", "1:02:05"; with sign: "+0:45" / "−3:10".
export function fmtDuration(ms, { sign = false } = {}) {
  const negative = ms < 0;
  // Count up to the next whole second so 0:01 shows until the very end.
  const total = Math.ceil(Math.abs(ms) / 1000 - 1e-9);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  if (!sign) return body;
  return (negative ? '−' : '+') + body;
}

// "12 min", "1 h 5 min", "45 s"
export function fmtSpan(ms) {
  const abs = Math.abs(ms);
  if (abs < MIN) return `${Math.round(abs / 1000)} s`;
  const mins = Math.round(abs / MIN);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtClock(ms) {
  if (ms == null) return '—';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// "On time", "5 min behind", "3 min ahead". Within a minute counts as on time.
export function fmtDelta(deltaMs) {
  if (deltaMs == null) return null;
  if (Math.abs(deltaMs) < MIN) return { label: 'On time', tone: 'ok' };
  return deltaMs > 0
    ? { label: `${fmtSpan(deltaMs)} behind`, tone: deltaMs > 5 * MIN ? 'bad' : 'warn' }
    : { label: `${fmtSpan(deltaMs)} ahead`, tone: 'ok' };
}

// Minutes in the editor, seconds in the database.
export function minutesToSeconds(value) {
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(86400, Math.round(n * 60));
}

// "Opening prayer - 5", "Keynote 30 min", "Break (15)" → { title, duration_s }
export function parseProgramLine(line) {
  const text = line.trim();
  if (!text) return null;
  const m = text.match(/^(.*?)[\s\-–—:|,(]*?(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minutes)?\)?\s*$/i);
  if (m && m[1].trim()) {
    return { title: m[1].trim().replace(/[\s\-–—:|,(]+$/, ''), duration_s: minutesToSeconds(m[2]) };
  }
  return { title: text, duration_s: 300 };
}

// When the station clock is useful: "Session · for 12 min".
export function stationSince(station, now) {
  if (station.phase_started_at == null) return null;
  return fmtSpan(Math.max(0, now - station.phase_started_at));
}
