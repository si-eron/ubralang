// The database rules, exercised through the same door the page uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack } = require('./helpers.js');

let stack;
test.before(async () => { stack = await startStack('backend'); });
test.after(async () => { await stack.stop(); });

const PROGRAM = [
  { title: 'Doors open', duration_s: 600 },
  { title: 'Opening prayer', duration_s: 120, lead: 'Ptr. Cruz' },
  { title: 'Keynote', duration_s: 1800 },
  { title: 'Closing', duration_s: 300 },
];

async function newEvent(name = 'Leadership Summit') {
  const made = await stack.rpc('et_create', { p_name: name, p_venue: 'Gym' });
  assert.equal(made.ok, true);
  const admin = (action, args = {}) =>
    stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  return { ...made, admin };
}

test('a new event gets a join code and an admin key, and starts ready', async () => {
  const ev = await newEvent();
  assert.match(ev.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.match(ev.key, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(ev.event.status, 'ready');
  assert.equal(ev.event.current_index, -1);

  const st = await stack.rpc('et_state', { p_code: ev.code.toLowerCase(), p_since: 0 });
  assert.equal(st.ok, true);
  assert.equal(st.event.name, 'Leadership Summit');
  assert.equal(typeof st.now, 'number');
});

test('codes are forgiving about case, spaces and dashes', async () => {
  const ev = await newEvent();
  const typed = `${ev.code.slice(0, 3).toLowerCase()}-${ev.code.slice(3)} `;
  const st = await stack.rpc('et_state', { p_code: typed, p_since: 0 });
  assert.equal(st.ok, true);
  const ok = await stack.rpc('et_admin', { p_code: ev.code, p_key: ev.key.toLowerCase(), p_action: 'verify', p_args: {} });
  assert.equal(ok.ok, true);
});

test('the wrong key changes nothing, and an unknown event says so', async () => {
  const ev = await newEvent();
  const bad = await stack.rpc('et_admin', { p_code: ev.code, p_key: 'AAAAAAAA', p_action: 'message', p_args: { text: 'hi' } });
  assert.deepEqual([bad.ok, bad.error], [false, 'wrong_key']);
  const none = await stack.rpc('et_state', { p_code: 'ZZZZZZ', p_since: 0 });
  assert.deepEqual([none.ok, none.error], [false, 'not_found']);
});

test('the public key cannot touch the tables directly or call the helpers', async () => {
  const client = await stack.pool.connect();
  try {
    for (const sql of ['select * from et_events', 'select * from et_stations', 'delete from et_log',
      "select et_snapshot(gen_random_uuid())", "select et_go(gen_random_uuid(), 0, now())"]) {
      await client.query('begin');
      await client.query('set local role anon');
      await assert.rejects(client.query(sql), /permission denied/, sql);
      await client.query('rollback');
    }
  } finally {
    client.release();
  }
});

test('what everyone can read holds no secrets', async () => {
  const ev = await newEvent();
  await ev.admin('stations', { stations: [{ name: 'Station A' }] });
  const codes = await ev.admin('codes');
  const st = await stack.rpc('et_state', { p_code: ev.code, p_since: 0 });
  const text = JSON.stringify(st);
  assert.ok(!text.includes(ev.key), 'admin key leaked');
  assert.ok(!text.includes(codes.codes[0].code), 'station code leaked');
  assert.ok(!/salt|hash/.test(text));
});

test('a phone that is up to date gets a tiny answer', async () => {
  const ev = await newEvent();
  const st = await stack.rpc('et_state', { p_code: ev.code, p_since: ev.rev });
  assert.deepEqual(Object.keys(st).sort(), ['changed', 'now', 'ok', 'rev']);
  assert.equal(st.changed, false);
  await ev.admin('message', { text: 'Welcome!' });
  const moved = await stack.rpc('et_state', { p_code: ev.code, p_since: ev.rev });
  assert.equal(moved.changed, true);
  assert.equal(moved.event.message, 'Welcome!');
});

test('Next moves exactly once, however many times the same tap arrives', async () => {
  const ev = await newEvent();
  await ev.admin('program', { segments: PROGRAM });
  const started = await ev.admin('start', { from: -1 });
  assert.equal(started.event.status, 'live');
  assert.equal(started.event.current_index, 0);

  // The same "Next from 0" sent five times at once: two phones, retries, a double tap.
  const results = await Promise.all(Array.from({ length: 5 }, () => ev.admin('next', { from: 0 })));
  assert.equal(results.filter((r) => !r.stale).length, 1);
  const st = await stack.rpc('et_state', { p_code: ev.code, p_since: 0 });
  assert.equal(st.event.current_index, 1);
  assert.equal(st.segments[0].ended_at, st.segments[1].started_at);
});

test('Next on the last segment ends the program; Back reopens it', async () => {
  const ev = await newEvent();
  await ev.admin('program', { segments: PROGRAM.slice(0, 2) });
  await ev.admin('start', { from: -1 });
  await ev.admin('next', { from: 0 });
  const ended = await ev.admin('next', { from: 1 });
  assert.equal(ended.event.status, 'ended');
  assert.ok(ended.event.ended_at);
  assert.ok(ended.segments[1].ended_at);

  const again = await ev.admin('next', { from: 1 });
  assert.equal(again.stale, true);

  const reopened = await ev.admin('prev', { from: 1 });
  assert.equal(reopened.event.status, 'live');
  assert.equal(reopened.segments[1].ended_at, null);
});

test('Back undoes a Next: the earlier segment keeps its original start', async () => {
  const ev = await newEvent();
  await ev.admin('program', { segments: PROGRAM });
  const s0 = await ev.admin('start', { from: -1 });
  await ev.admin('next', { from: 0 });
  const back = await ev.admin('prev', { from: 1 });
  assert.equal(back.event.current_index, 0);
  assert.equal(back.event.segment_started_at, s0.event.segment_started_at);
  assert.equal(back.segments[0].ended_at, null);
  assert.equal(back.segments[1].started_at, null);

  const ready = await ev.admin('prev', { from: 0 });
  assert.equal(ready.event.status, 'ready');
  assert.equal(ready.event.current_index, -1);
});

test('hold stops the clock and resume adds the held time; ±1 minute adjusts', async () => {
  const ev = await newEvent();
  await ev.admin('program', { segments: PROGRAM });
  const live = await ev.admin('start', { from: -1 });
  const t0 = live.now;
  const held = await ev.admin('hold', { at: t0 + 1000 });
  assert.equal(held.event.status, 'hold');
  // Resume 40 ms after the hold began.
  await new Promise((r) => setTimeout(r, 50));
  const holdAt = held.event.hold_started_at;
  const resumed = await ev.admin('resume', { at: holdAt + 40 });
  assert.equal(resumed.event.status, 'live');
  assert.equal(resumed.event.hold_total_ms, 40);

  const plus = await ev.admin('adjust', { seconds: 60 });
  assert.equal(plus.event.segment_extra_s, 60);
  const minus = await ev.admin('adjust', { seconds: -99999 });
  assert.equal(minus.event.segment_extra_s, -600, 'cannot go below zero time left');
  const next = await ev.admin('next', { from: 0 });
  assert.equal(next.event.segment_extra_s, 0, 'the next segment starts fresh');
});

test('a tap made offline keeps its time, within limits', async () => {
  const ev = await newEvent();
  await ev.admin('program', { segments: PROGRAM });
  const live = await ev.admin('start', { from: -1 });
  const now = live.now;

  const future = await ev.admin('next', { from: 0, at: now + 3_600_000 });
  assert.ok(future.event.segment_started_at <= future.now, 'never in the future');

  // Earlier than the segment it ends: lands on that segment's start instead.
  const early = await ev.admin('next', { from: 1, at: now - 3_600_000 });
  assert.ok(early.event.segment_started_at >= future.event.segment_started_at);

  const fresh = await newEvent();
  await fresh.admin('program', { segments: PROGRAM });
  // A start claimed three hours back is cut to 15 minutes back.
  const old = await fresh.admin('start', { from: -1, at: Date.now() - 3 * 3_600_000 });
  assert.ok(old.now - old.event.started_at <= 15 * 60_000 + 1000);
  assert.ok(old.now - old.event.started_at >= 15 * 60_000 - 1000);
});

test('the program can be edited live, but the segment on stage stays', async () => {
  const ev = await newEvent();
  const saved = await ev.admin('program', { segments: PROGRAM });
  await ev.admin('start', { from: -1 });
  await ev.admin('next', { from: 0 });
  const ids = saved.segments.map((s) => s.id);

  // Drop "Doors open", rename the keynote, add a raffle before closing.
  const edited = await ev.admin('program', {
    segments: [
      { id: ids[1], title: 'Opening prayer', duration_s: 120 },
      { id: ids[2], title: 'Keynote: Servant Leadership', duration_s: 1500 },
      { title: 'Raffle', duration_s: 300 },
      { id: ids[3], title: 'Closing', duration_s: 300 },
    ],
  });
  assert.equal(edited.ok, true);
  assert.equal(edited.event.current_index, 0, 'still on Opening prayer, now first');
  assert.equal(edited.segments[0].id, ids[1]);
  assert.ok(edited.segments[0].started_at, 'its start time survives');
  assert.equal(edited.segments[2].title, 'Raffle');

  const removing = await ev.admin('program', { segments: [{ id: ids[2], title: 'Keynote', duration_s: 60 }] });
  assert.deepEqual([removing.ok, removing.error], [false, 'current_removed']);
  const still = await stack.rpc('et_state', { p_code: ev.code, p_since: 0 });
  assert.equal(still.segments.length, 4, 'a refused edit changes nothing');
});

test('stations: each code opens one station; admin opens all', async () => {
  const ev = await newEvent();
  await ev.admin('event', { stations_enabled: true });
  const made = await ev.admin('stations', {
    stations: [
      { name: 'Station 1: Bible Study', location: 'Room 101', phases: ['Waiting', 'Session', 'Sharing'] },
      { name: 'Station 2: Games', phases: [] },
    ],
  });
  assert.equal(made.event.stations_enabled, true);
  assert.deepEqual(made.stations[1].phases, ['Students entering', 'Introduction of guest speaker', 'Session', 'Students exit']);
  const { codes } = await ev.admin('codes');
  const [one, two] = made.stations;

  const update = (station, key, patch) =>
    stack.rpc('et_station', { p_code: ev.code, p_station: station.id, p_key: key, p_patch: patch });

  const wrong = await update(one, codes[1].code, { crowd: 'full' });
  assert.deepEqual([wrong.ok, wrong.error], [false, 'wrong_key']);

  const check = await update(one, codes[0].code, {});
  assert.equal(check.ok, true);

  const full = await update(one, codes[0].code, { phase_index: 1, crowd: 'full', note: 'Send people to Station 2', by: 'Ana' });
  const s1 = full.stations[0];
  assert.deepEqual([s1.phase_index, s1.crowd, s1.note, s1.updated_by], [1, 'full', 'Send people to Station 2', 'Ana']);
  assert.ok(s1.phase_started_at);
  assert.ok(full.log.some((l) => l.text === 'Station 1: Bible Study is FULL HOUSE'));
  assert.ok(full.log.some((l) => l.text === 'Station 1: Bible Study: Session'));

  const byAdmin = await update(two, ev.key, { crowd: 'closed' });
  assert.equal(byAdmin.stations[1].crowd, 'closed');

  const clamp = await update(two, codes[1].code, { phase_index: 99 });
  assert.equal(clamp.stations[1].phase_index, 3, 'the last of the four default steps');
});

test('stations: the update pressed last wins, even if it arrives first', async () => {
  const ev = await newEvent();
  const made = await ev.admin('stations', { stations: [{ name: 'Registration' }] });
  const { codes } = await ev.admin('codes');
  const id = made.stations[0].id;
  const t = Date.now();
  const later = await stack.rpc('et_station', { p_code: ev.code, p_station: id, p_key: codes[0].code, p_patch: { crowd: 'full', at: t - 1000 } });
  assert.equal(later.stations[0].crowd, 'full');
  // A phone that was offline uploads a tap it made earlier than that.
  const earlier = await stack.rpc('et_station', { p_code: ev.code, p_station: id, p_key: codes[0].code, p_patch: { crowd: 'open', at: t - 5000 } });
  assert.equal(earlier.stale, true);
  assert.equal(earlier.stations[0].crowd, 'full');
});

test('stations: renaming keeps codes and progress; a new code locks out the old', async () => {
  const ev = await newEvent();
  const made = await ev.admin('stations', { stations: [{ name: 'A', phases: ['One', 'Two', 'Three'] }] });
  const { codes } = await ev.admin('codes');
  const id = made.stations[0].id;
  await stack.rpc('et_station', { p_code: ev.code, p_station: id, p_key: codes[0].code, p_patch: { phase_index: 2 } });

  const renamed = await ev.admin('stations', { stations: [{ id, name: 'A — Plaza', phases: ['One', 'Two'] }] });
  assert.equal(renamed.stations[0].phase_index, 1, 'clamped to the shorter list');
  const after = await ev.admin('codes');
  assert.equal(after.codes[0].code, codes[0].code);

  await ev.admin('station_code', { id });
  const fresh = await ev.admin('codes');
  assert.notEqual(fresh.codes[0].code, codes[0].code);
  const old = await stack.rpc('et_station', { p_code: ev.code, p_station: id, p_key: codes[0].code, p_patch: {} });
  assert.equal(old.error, 'wrong_key');
});

test('a new admin key replaces the old one; delete removes everything', async () => {
  const ev = await newEvent();
  const changed = await ev.admin('new_key');
  assert.match(changed.key, /^[A-HJ-NP-Z2-9]{8}$/);
  const old = await ev.admin('verify');
  assert.equal(old.error, 'wrong_key');
  const gone = await stack.rpc('et_admin', { p_code: ev.code, p_key: changed.key, p_action: 'delete', p_args: {} });
  assert.equal(gone.deleted, true);
  const st = await stack.rpc('et_state', { p_code: ev.code, p_since: 0 });
  assert.equal(st.error, 'not_found');
});

test('one box for any code: it says whether it is the admin key or which station', async () => {
  const ev = await newEvent();
  const made = await ev.admin('stations', { stations: [{ name: 'A' }, { name: 'B' }] });
  const { codes } = await ev.admin('codes');
  const admin = await stack.rpc('et_role', { p_code: ev.code, p_key: ev.key });
  assert.equal(admin.role, 'admin');
  const b = await stack.rpc('et_role', { p_code: ev.code, p_key: prettyish(codes[1].code) });
  assert.deepEqual([b.role, b.station], ['station', made.stations[1].id]);
  const nope = await stack.rpc('et_role', { p_code: ev.code, p_key: 'nope' });
  assert.equal(nope.error, 'wrong_key');
});

function prettyish(code) {
  return `${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`;
}

test('any code on its own says where it leads: event, station or master control', async () => {
  const ev = await newEvent();
  const made = await ev.admin('stations', { stations: [{ name: 'A' }, { name: 'B' }] });
  const { codes } = await ev.admin('codes');
  const enter = (k) => stack.rpc('et_enter', { p_key: k });

  assert.deepEqual(await pick(enter(ev.code.toLowerCase())), { role: 'viewer', code: ev.code });
  const st = await enter(`${codes[1].code.slice(0, 3)}-${codes[1].code.slice(3)}`);
  assert.deepEqual([st.role, st.code, st.station], ['station', ev.code, made.stations[1].id]);
  assert.deepEqual(await pick(enter(ev.key)), { role: 'admin', code: ev.code });
  assert.equal((await enter('ZZZZZZ')).error, 'not_found');
  assert.equal((await enter('')).error, 'not_found');

  // A new admin key moves with it; the old one leads nowhere.
  const fresh = await ev.admin('new_key');
  assert.equal((await enter(ev.key)).error, 'not_found');
  assert.equal((await enter(fresh.key)).role, 'admin');
});

test('an event made before the one-box sign-in learns its admin key the next time it is used', async () => {
  const ev = await newEvent();
  await stack.pool.query('update et_events set admin_lookup = null where code = $1', [ev.code]);
  assert.equal((await stack.rpc('et_enter', { p_key: ev.key })).error, 'not_found');
  await ev.admin('verify');
  assert.equal((await stack.rpc('et_enter', { p_key: ev.key })).role, 'admin');
});

async function pick(p) {
  const r = await p;
  return { role: r.role, code: r.code };
}
