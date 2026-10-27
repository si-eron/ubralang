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

test('overtime: a flexible break shrinks so the next session starts as planned', () => {
  // Talk 30 (planned 0–30), Break 15 flexible (30–45), Session 30 (45–75). The talk runs 6 min over.
  const s = snap({ status: 'live', current_index: 0, segment_started_at: T, started_at: T, planned_start: T }, [30, 15, 30]);
  s.segments[1].flexible = true;
  const now = T + 36 * MIN;
  const c = clockOf(s, now);
  assert.equal(c.remainingMs, -6 * MIN);
  assert.equal(c.nextStart, T + 36 * MIN, 'the break starts 6 min late…');
  assert.equal(c.projectedEnd, T + 75 * MIN, '…but the day still ends on time');
  assert.equal(c.deltaMs, 0);
  const rows = timelineOf(s, now);
  assert.equal(rows[1].shrinkMs, 6 * MIN, 'the break is 6 min shorter');
  assert.equal(rows[2].expectedStart, T + 45 * MIN, 'the next session starts as planned');
  assert.equal(rows[2].lateMs, 0);
});

test('overtime: a break shrinks at most to half; with no flexible items everything slides', () => {
  const s = snap({ status: 'live', current_index: 0, segment_started_at: T, started_at: T, planned_start: T }, [30, 10, 30]);
  s.segments[1].flexible = true;
  const late = timelineOf(s, T + 45 * MIN); // 15 min over: the 10-min break can only give 5
  assert.equal(late[1].shrinkMs, 5 * MIN);
  assert.equal(late[2].lateMs, 10 * MIN);
  s.segments[1].flexible = false;
  assert.equal(timelineOf(s, T + 45 * MIN)[2].lateMs, 15 * MIN, 'nothing absorbs it');
});

test('a flexible break that itself starts late is shorter on the clock', () => {
  const s = snap({ status: 'live', current_index: 1, segment_started_at: T + 36 * MIN, started_at: T, planned_start: T }, [30, 15, 30]);
  s.segments[1].flexible = true;
  const c = clockOf(s, T + 36 * MIN);
  assert.equal(c.allotMs, 9 * MIN, 'ends at its planned 45 min mark');
  assert.equal(c.shrunkMs, 6 * MIN);
});
