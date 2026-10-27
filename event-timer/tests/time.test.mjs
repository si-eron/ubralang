import test from 'node:test';
import assert from 'node:assert/strict';
import { clockOf, timelineOf, fmtDuration, fmtDelta, parseProgramLine, minutesToSeconds } from '../assets/js/time.js';

const T = Date.UTC(2026, 9, 27, 0, 0, 0);
const MIN = 60_000;

function snap(event, segments) {
  return {
    event: {
      status: 'ready', current_index: -1, segment_started_at: null, segment_extra_s: 0,
      hold_started_at: null, hold_total_ms: 0, started_at: null, ended_at: null, planned_start: null,
      ...event,
    },
    segments: segments.map((d, i) => ({ id: `s${i}`, title: `S${i}`, duration_s: d * 60, started_at: null, ended_at: null })),
  };
}

test('counts down the segment on stage, and over into overtime', () => {
  const s = snap({ status: 'live', current_index: 0, segment_started_at: T, started_at: T }, [10, 5]);
  s.segments[0].started_at = T;
  let c = clockOf(s, T + 4 * MIN);
  assert.equal(c.remainingMs, 6 * MIN);
  assert.equal(c.overtime, false);
  assert.equal(c.next.title, 'S1');
  assert.equal(c.deltaMs, 0);
  c = clockOf(s, T + 12 * MIN);
  assert.equal(c.remainingMs, -2 * MIN);
  assert.equal(c.overtime, true);
  assert.equal(c.progress, 1);
  assert.equal(c.deltaMs, 2 * MIN, 'running over pushes the end back');
});

test('hold freezes the clock; extra minutes extend it', () => {
  const s = snap({
    status: 'hold', current_index: 0, segment_started_at: T, started_at: T,
    hold_started_at: T + 3 * MIN, hold_total_ms: MIN, segment_extra_s: 120,
  }, [10]);
  const a = clockOf(s, T + 5 * MIN);
  const b = clockOf(s, T + 50 * MIN);
  assert.equal(a.remainingMs, b.remainingMs, 'frozen while held');
  assert.equal(a.elapsedMs, 2 * MIN);
  assert.equal(a.allotMs, 12 * MIN);
  assert.equal(a.remainingMs, 10 * MIN);
});

test('a planned start: before it the clock counts to the start; late starts show as behind', () => {
  const s = snap({ planned_start: T }, [10, 20]);
  const early = clockOf(s, T - 5 * MIN);
  assert.equal(early.startsInMs, 5 * MIN);
  assert.equal(early.deltaMs, 0);
  const late = clockOf(s, T + 7 * MIN);
  assert.equal(late.deltaMs, 7 * MIN);
  assert.equal(fmtDelta(late.deltaMs).label, '7 min behind');
});

test('the run of show: done, now, skipped, and when the rest should start', () => {
  const s = snap({ status: 'live', current_index: 2, segment_started_at: T + 15 * MIN, started_at: T }, [10, 5, 10, 5]);
  s.segments[0].started_at = T; s.segments[0].ended_at = T + 15 * MIN; // ran 5 over
  s.segments[2].started_at = T + 15 * MIN; // segment 1 was jumped over
  const rows = timelineOf(s, T + 20 * MIN);
  assert.deepEqual(rows.map((r) => r.state), ['done', 'skipped', 'now', 'upcoming']);
  assert.equal(rows[0].actualMs, 15 * MIN);
  assert.equal(rows[3].plannedStart, T + 25 * MIN);
  assert.equal(rows[3].expectedStart, T + 25 * MIN, '5 min left of the current one');
});

test('formats', () => {
  assert.equal(fmtDuration(0), '0:00');
  assert.equal(fmtDuration(400), '0:01');
  assert.equal(fmtDuration(65_000), '1:05');
  assert.equal(fmtDuration(3_725_000), '1:02:05');
  assert.equal(fmtDuration(-45_000, { sign: true }), '−0:45');
  assert.equal(fmtDelta(30_000).label, 'On time');
  assert.equal(fmtDelta(-3 * MIN).label, '3 min ahead');
  assert.equal(minutesToSeconds('1,5'), 90);
  assert.equal(minutesToSeconds('-3'), 0);
});

test('reading a pasted program', () => {
  assert.deepEqual(parseProgramLine('Opening prayer - 5'), { title: 'Opening prayer', duration_s: 300 });
  assert.deepEqual(parseProgramLine('Keynote 30 min'), { title: 'Keynote', duration_s: 1800 });
  assert.deepEqual(parseProgramLine('Break (15)'), { title: 'Break', duration_s: 900 });
  assert.deepEqual(parseProgramLine('Awarding: 12.5'), { title: 'Awarding', duration_s: 750 });
  assert.deepEqual(parseProgramLine('Doxology'), { title: 'Doxology', duration_s: 300 });
  assert.equal(parseProgramLine('   '), null);
});

test('countdown: time left until the planned start, then the first segment from that moment', () => {
  const s = snap({ status: 'countdown', planned_start: T }, [10, 5]);
  const before = clockOf(s, T - 90 * MIN);
  assert.equal(before.status, 'countdown');
  assert.equal(before.startsInMs, 90 * MIN);
  assert.equal(fmtDuration(before.startsInMs), '1:30:00');
  const after = clockOf(s, T + 2 * MIN);
  assert.equal(after.status, 'live', 'began by itself at the planned start');
  assert.equal(after.index, 0);
  assert.equal(after.remainingMs, 8 * MIN);
  assert.deepEqual(timelineOf(s, T + 2 * MIN).map((r) => r.state), ['now', 'upcoming']);
});
