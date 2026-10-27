// Real browsers, real server: every screen agrees, and a dropped connection
// loses nothing. Needs Chromium through Playwright (PLAYWRIGHT_PATH, or the
// globally installed one); skipped when neither is there.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack } = require('./helpers.js');

let playwright = null;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
  try { playwright = require(p); break; } catch { /* try the next */ }
}

const skip = playwright ? false : 'Playwright is not installed';
let stack;
let browser;

test.before(async () => {
  if (skip) return;
  stack = await startStack('e2e');
  browser = await playwright.chromium.launch();
});
test.after(async () => {
  if (skip) return;
  await browser.close();
  await stack.stop();
});

async function phone(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.stack || e.message));
  return { ctx, page };
}

const url = (hash) => `${stack.base}/?backend=local&nosw=1${hash}`;
const secondsOnScreen = async (page) => {
  const text = (await page.textContent('.hero-time')).trim();
  const parts = text.replace(/[^\d:]/g, '').split(':').map(Number);
  return parts.reduce((t, n) => t * 60 + n, 0);
};

test('the admin moves the program; another phone follows, even with its clock wrong', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Sync check', p_venue: '' });
  await stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: 'program', p_args: {
    segments: [{ title: 'Welcome', duration_s: 600 }, { title: 'Talk', duration_s: 900 }],
  } });

  const admin = await phone();
  await admin.page.goto(url(`#/e/${made.code}/join/${made.key}`));
  await admin.page.waitForSelector('#controls [data-act=next]');

  // This phone's clock is ten minutes fast.
  const viewer = await phone();
  await viewer.page.clock.install({ time: Date.now() + 10 * 60_000 });
  await viewer.page.goto(url(`#/e/${made.code}`));
  await viewer.page.waitForSelector('.hero');

  await admin.page.click('#controls [data-act=next]');
  await admin.page.waitForSelector('.hero-title:has-text("Welcome")');
  await viewer.page.waitForSelector('.hero-title:has-text("Welcome")', { timeout: 6000 });

  const a = await secondsOnScreen(admin.page);
  const v = await secondsOnScreen(viewer.page);
  assert.ok(Math.abs(a - v) <= 2, `admin ${a}s vs viewer ${v}s`);
  assert.ok(v > 590 && v <= 600, `viewer shows ${v}s left of 600`);

  await admin.page.click('#controls [data-act=next]');
  await viewer.page.waitForSelector('.hero-title:has-text("Talk")', { timeout: 6000 });
  assert.deepEqual([...admin.page.errors, ...viewer.page.errors], []);
  await admin.ctx.close();
  await viewer.ctx.close();
});

test('Next pressed with no signal is kept, and lands at the moment it was pressed', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Offline check', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('program', { segments: [{ title: 'One', duration_s: 300 }, { title: 'Two', duration_s: 300 }] });
  await admin('start', { from: -1 });

  const p = await phone();
  await p.page.goto(url(`#/e/${made.code}/join/${made.key}`));
  await p.page.waitForSelector('.hero-title:has-text("One")');

  await p.ctx.setOffline(true);
  const pressedAt = Date.now();
  await p.page.click('#controls [data-act=next]');
  await p.page.waitForSelector('#toast:has-text("No connection")');
  await p.page.waitForSelector('.pill:has-text("Offline")', { timeout: 20000 });
  const stillOne = await stack.rpc('et_state', { p_code: made.code, p_since: 0 });
  assert.equal(stillOne.event.current_index, 0, 'nothing reached the server');

  await new Promise((r) => setTimeout(r, 3000));
  await p.ctx.setOffline(false);
  await p.page.waitForSelector('.hero-title:has-text("Two")', { timeout: 20000 });
  const after = await stack.rpc('et_state', { p_code: made.code, p_since: 0 });
  assert.equal(after.event.current_index, 1);
  const drift = after.event.segment_started_at - pressedAt;
  assert.ok(Math.abs(drift) < 1500, `started ${drift} ms from the press, not when it uploaded`);
  assert.deepEqual(p.page.errors, []);
  await p.ctx.close();
});

test('a station marks itself full offline: it shows at once, and everyone sees it once it uploads', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Stations check', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('event', { stations_enabled: true });
  await admin('stations', { stations: [{ name: 'Bible study', phases: ['Gathering', 'Session', 'Sharing'] }, { name: 'Games' }] });
  const { codes } = await admin('codes');

  const st = await phone();
  await st.page.goto(url(`#/e/${made.code}/join/${codes[0].code}`));
  await st.page.waitForSelector('.crowd-grid');

  const watcher = await phone();
  await watcher.page.goto(url(`#/e/${made.code}`));
  await watcher.page.click('[data-tab=stations]');
  await watcher.page.waitForSelector('.station');

  await st.ctx.setOffline(true);
  await st.page.click('[data-phase="1"]');
  await st.page.click('[data-crowd=full]');
  await st.page.waitForSelector('.crowd-btn.is-on:has-text("Full house")');
  await st.page.waitForSelector('.mine-phase:has-text("Session")');

  await st.ctx.setOffline(false);
  await watcher.page.waitForSelector('.station-full:has-text("Bible study")', { timeout: 20000 });
  await watcher.page.waitForSelector('.station-full .station-phase:has-text("Session")');
  const text = await watcher.page.textContent('.summary');
  assert.match(text, /1\s*Open\s*0\s*Filling up\s*1\s*Full house\s*0\s*Closed/);
  assert.deepEqual([...st.page.errors, ...watcher.page.errors], []);
  await st.ctx.close();
  await watcher.ctx.close();
});

test('moving between screens never doubles a tap; a deleted event says so', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Navigation check', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('program', { segments: ['A', 'B', 'C', 'D'].map((title) => ({ title, duration_s: 60 })) });
  await admin('start', { from: -1 });

  const p = await phone();
  await p.page.goto(url(`#/e/${made.code}/join/${made.key}`));
  await p.page.waitForSelector('#controls [data-act=next]');
  for (let i = 0; i < 3; i += 1) {
    await p.page.click('a:has-text("Master control"), .topbar-back');
    await p.page.waitForSelector('.page-event .hero');
    await p.page.click('a:has-text("Master control")');
    await p.page.waitForSelector('#controls [data-act=next]:not([disabled])');
  }
  // Every screen visited must be gone for good: one tap on Go asks once and
  // sends once, not once per screen opened along the way.
  let sent = 0;
  p.page.on('request', (r) => { if (r.url().endsWith('/rpc/et_admin')) sent += 1; });
  await p.page.click('[data-goto="3"]');
  await p.page.click('dialog[open] button[value=ok]');
  await p.page.waitForSelector('.hero-title:has-text("D")');
  await p.page.waitForTimeout(1500);
  assert.equal(await p.page.locator('dialog[open]').count(), 0, 'no second question left open');
  assert.equal(sent, 1, 'one tap, one request');
  await p.page.click('#controls [data-act=prev]');
  await p.page.waitForSelector('.hero-title:has-text("C")');
  const st = await stack.rpc('et_state', { p_code: made.code, p_since: 0 });
  assert.equal(st.event.current_index, 2, 'Go to D, then Back to the one before it');

  await p.page.click('.topbar-back');
  await p.page.waitForSelector('.page-event .hero');
  await admin('delete');
  await p.page.waitForSelector('text=No event with code', { timeout: 8000 });
  await p.page.waitForTimeout(600);
  assert.deepEqual(p.page.errors, []);
  await p.ctx.close();
});

test('the clock turns orange when time is almost up and red when it is over', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Colour check', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  // 5 min with plenty left · 1 min, so already inside its last minute · 2 s, soon over.
  await admin('program', { segments: [{ title: 'Calm', duration_s: 300 }, { title: 'Nearly', duration_s: 60 }, { title: 'Over', duration_s: 2 }] });
  await admin('start', { from: -1 });

  const p = await phone();
  await p.page.goto(url(`#/e/${made.code}`));
  await p.page.waitForSelector('.hero-ok .hero-caption:has-text("Time left")');

  await admin('next', { from: 0 });
  await p.page.waitForSelector('.hero-warn .hero-caption:has-text("Almost time")', { timeout: 6000 });
  await p.page.waitForTimeout(600); // the card fades between colours over 0.4 s
  const heroColour = () => p.page.evaluate(() => getComputedStyle(document.querySelector('#hero .hero')).backgroundColor);
  const orange = await heroColour();
  assert.equal(orange, 'rgb(194, 65, 12)');

  await admin('next', { from: 1 });
  await p.page.waitForSelector('.hero-bad .hero-caption:has-text("Over time by")', { timeout: 10000 });
  await p.page.waitForTimeout(2000);
  const red = await heroColour();
  assert.equal(red, 'rgb(212, 42, 47)');
  const shown = await secondsOnScreen(p.page);
  assert.ok(shown >= 1 && shown <= 30, `shows ${shown}s over (it counts up once time is over)`);

  await p.page.goto(url(`#/e/${made.code}/stage`));
  await p.page.waitForSelector('.stage[data-tone="bad"]');
  assert.equal(await p.page.textContent('#stageLabel'), 'Over time by');
  assert.deepEqual(p.page.errors, []);
  await p.ctx.close();
});

test('on a phone, it asks to be installed first, with that phone’s steps and the event code', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Install check', p_venue: '' });
  const iphone = await phone({ ...playwright.devices['iPhone 13'] });
  await iphone.page.goto(url(`#/e/${made.code}`));
  await iphone.page.waitForSelector('.install-gate');
  const text = await iphone.page.textContent('.install-gate');
  assert.match(text, /Add to Home Screen/);
  assert.match(text, new RegExp(`${made.code.slice(0, 3)}-${made.code.slice(3)}`), 'shows the event code to type in the app');

  const android = await phone({ ...playwright.devices['Pixel 7'] });
  await android.page.goto(url(`#/e/${made.code}`));
  await android.page.waitForSelector('.install-gate');
  assert.match(await android.page.textContent('.install-gate'), /Install app/);
  // On a phone it has to be installed: no way round it, even after a reload.
  assert.equal(await android.page.locator('#browserOk').count(), 0);
  await android.page.reload();
  await android.page.waitForSelector('.install-gate');

  // Opened from Messenger: told to open it in the phone's real browser first.
  const messenger = await phone({ ...playwright.devices['iPhone 13'], userAgent: `${playwright.devices['iPhone 13'].userAgent} [FBAN/MessengerForiOS;FBAV/450.0]` });
  await messenger.page.goto(url(`#/e/${made.code}`));
  await messenger.page.waitForSelector('.install-gate #copyLink');
  assert.match(await messenger.page.textContent('.install-gate'), /Safari/);
  await messenger.ctx.close();

  // A computer is never stopped.
  const desk = await phone();
  await desk.page.goto(url(`#/e/${made.code}`));
  await desk.page.waitForSelector('.page-event .hero');
  assert.deepEqual([...iphone.page.errors, ...android.page.errors, ...desk.page.errors], []);
  await Promise.all([iphone.ctx.close(), android.ctx.close(), desk.ctx.close()]);
});

test('presenter view: time left, notes, what is next, and a wrap-up cue', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Presenter check', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('program', { segments: [
    { title: 'Talk', duration_s: 50, lead: 'Dr. Reyes', notes: 'Thank the sponsors' },
    { title: 'Q&A', duration_s: 600 },
  ] });
  await admin('start', { from: -1 });
  const p = await phone({ viewport: { width: 1280, height: 720 } });
  await p.page.goto(url(`#/e/${made.code}/presenter`));
  await p.page.waitForSelector('.presenter[data-tone="warn"]');
  assert.equal(await p.page.textContent('#pvTitle'), 'Talk');
  assert.equal(await p.page.textContent('#pvCue'), 'Please wrap up');
  assert.match(await p.page.textContent('#pvNotes'), /Thank the sponsors/);
  assert.match(await p.page.textContent('#pvNext'), /Q&A/);
  assert.deepEqual(p.page.errors, []);
  await p.ctx.close();
});

test('one code box: event code, station code and admin key each open their own screen', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'One box', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('event', { stations_enabled: true });
  await admin('stations', { stations: [{ name: 'Faith' }] });
  const { codes } = await admin('codes');

  const tryCode = async (typed, expectSelector) => {
    const p = await phone();
    await p.page.goto(url('#/'));
    await p.page.fill('#codeBox', typed);
    await p.page.click('#enterForm button[type=submit]');
    await p.page.waitForSelector(expectSelector);
    assert.deepEqual(p.page.errors, []);
    await p.ctx.close();
  };
  await tryCode(made.code.toLowerCase(), '.page-event .hero');                    // Facilitator view
  await tryCode(`${codes[0].code.slice(0, 3)} ${codes[0].code.slice(3)}`, '.crowd-grid'); // Station control
  await tryCode(`${made.key.slice(0, 4)}-${made.key.slice(4)}`, '#controls');      // Master control

  // The same, as links that sign people straight in.
  const p = await phone();
  await p.page.goto(url(`#/go/${codes[0].code}`));
  await p.page.waitForSelector('.crowd-grid');
  await p.page.goto(url(`#/go/${made.key}`));
  await p.page.waitForSelector('#controls');
  assert.deepEqual(p.page.errors, []);
  await p.ctx.close();
});

test('Station Mode can be switched on after the event is made, from the Run tab', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Stations later', p_venue: '' });
  const p = await phone();
  await p.page.goto(url(`#/go/${made.key}`));
  await p.page.waitForSelector('#stationsOnRun');
  await p.page.click('#stationsOnRun');
  await p.page.waitForSelector('#stationList .edit-row');
  // No Save button to press: the three new stations save by themselves.
  await p.page.waitForSelector('.codes li');
  const st = await stack.rpc('et_state', { p_code: made.code, p_since: 0 });
  assert.equal(st.event.stations_enabled, true);
  assert.equal(st.stations.length, 3);
  assert.deepEqual(st.stations[0].phases, ['Students entering', 'Introduction of guest speaker', 'Session', 'Students exit']);
  assert.deepEqual(p.page.errors, []);
  await p.ctx.close();
});

test('before the admin presses Start, no screen shows a timer', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Not yet', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('program', { segments: [{ title: 'Registration', duration_s: 600 }] });
  await admin('event', { planned_start: Date.now() + 2 * 3_600_000 }); // two hours from now
  const p = await phone();
  await p.page.goto(url(`#/e/${made.code}`));
  await p.page.waitForSelector('.hero-idle');
  assert.equal(await p.page.locator('.hero-time').count(), 0, 'no countdown on the phone');
  assert.equal(await p.page.locator('.hero-facts').count(), 0, 'no "behind" or "ends about"');
  await p.page.goto(url(`#/e/${made.code}/stage`));
  await p.page.waitForSelector('#stageTitle:has-text("Registration")');
  assert.equal(await p.page.isVisible('#stageTime'), false, 'no countdown on the big screen');
  await p.page.goto(url(`#/e/${made.code}/presenter`));
  await p.page.waitForSelector('#pvTitle:has-text("Registration")');
  assert.equal(await p.page.isVisible('#pvTime'), false, 'no countdown for the presenter');
  assert.deepEqual(p.page.errors, []);
  await p.ctx.close();
});

test('live push: a change reaches every other screen in under a second', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Speed check', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('event', { stations_enabled: true });
  await admin('stations', { stations: [{ name: 'Faith' }] });
  const { codes } = await admin('codes');
  await admin('program', { segments: ['One', 'Two', 'Three', 'Four'].map((title) => ({ title, duration_s: 600 })) });
  await admin('start', { from: -1 });

  // Four phones watching.
  const viewers = await Promise.all([1, 2, 3, 4].map(() => phone()));
  await Promise.all(viewers.map((v) => v.page.goto(url(`#/e/${made.code}`))));
  await Promise.all(viewers.map((v) => v.page.waitForSelector('.hero-title:has-text("One")')));
  await new Promise((r) => setTimeout(r, 1500)); // let the first check and the live link settle

  for (const [from, title] of [[0, 'Two'], [1, 'Three']]) {
    const t0 = Date.now();
    await admin('next', { from });
    await Promise.all(viewers.map((v) => v.page.waitForSelector(`.hero-title:has-text("${title}")`, { timeout: 5000 })));
    const ms = Date.now() - t0;
    if (process.env.SHOW_MS) console.log(`every screen showed "${title}" after ${ms} ms`);
    assert.ok(ms < 1000, `every screen showed "${title}" after ${ms} ms`);
  }

  // A station's tap reaches the others just as fast.
  await viewers[0].page.click('[data-tab=stations]');
  const t1 = Date.now();
  await stack.rpc('et_station', { p_code: made.code, p_station: (await admin('codes')).codes[0].id, p_key: codes[0].code, p_patch: { crowd: 'full' } });
  await viewers[0].page.waitForSelector('.station-full', { timeout: 5000 });
  assert.ok(Date.now() - t1 < 1000, `station update took ${Date.now() - t1} ms`);

  for (const v of viewers) assert.deepEqual(v.page.errors, []);
  await Promise.all(viewers.map((v) => v.ctx.close()));
});

test('if the live link drops, screens still catch up within seconds, and it reconnects', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Drop check', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('program', { segments: ['One', 'Two', 'Three'].map((title) => ({ title, duration_s: 600 })) });
  await admin('start', { from: -1 });
  const v = await phone();
  await v.page.goto(url(`#/e/${made.code}`));
  await v.page.waitForSelector('.hero-title:has-text("One")');
  await new Promise((r) => setTimeout(r, 1500));

  stack.realtime.dropAll(); // the link is cut; the change is made at once
  await admin('next', { from: 0 });
  const t0 = Date.now();
  await v.page.waitForSelector('.hero-title:has-text("Two")', { timeout: 6000 });
  assert.ok(Date.now() - t0 < 4000, `caught up after ${Date.now() - t0} ms without the live link`);

  // It reconnects by itself; the next change is instant again.
  await new Promise((r) => setTimeout(r, 2500));
  const t1 = Date.now();
  await admin('next', { from: 1 });
  await v.page.waitForSelector('.hero-title:has-text("Three")', { timeout: 5000 });
  assert.ok(Date.now() - t1 < 1000, `after reconnecting: ${Date.now() - t1} ms`);
  assert.deepEqual(v.page.errors, []);
  await v.ctx.close();
});

test('Present opens the presenter view in its own window; this tab keeps control', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Present check', p_venue: '' });
  await stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: 'program', p_args: { segments: [{ title: 'Talk', duration_s: 600 }] } });
  const p = await phone({ viewport: { width: 1280, height: 800 } });
  await p.page.goto(url(`#/go/${made.key}`));
  await p.page.waitForSelector('#controls');
  await p.page.click('[data-tab=share]');
  const [win] = await Promise.all([p.ctx.waitForEvent('page'), p.page.click('.share-block [data-present=presenter]')]);
  await win.waitForSelector('#pvTitle');
  assert.match(win.url(), /\/presenter$/);
  assert.match(await p.page.evaluate(() => location.hash), /\/admin/, 'Master control stays in the first tab');
  // Exit closes the presenter window.
  await Promise.all([win.waitForEvent('close'), win.evaluate(() => document.getElementById('pvExit').click())]);
  assert.deepEqual(p.page.errors, []);
  await p.ctx.close();
});

test('station edits save by themselves and reach other devices within a second or two', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Autosave', p_venue: '' });
  await stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: 'event', p_args: { stations_enabled: true } });
  const adminPhone = await phone();
  await adminPhone.page.goto(url(`#/go/${made.key}`));
  await adminPhone.page.waitForSelector('#controls');
  await adminPhone.page.click('[data-tab=stations]');
  await adminPhone.page.waitForSelector('.codes li'); // the starter stations, already saved

  const viewer = await phone();
  await viewer.page.goto(url(`#/e/${made.code}`));
  await viewer.page.click('[data-tab=stations]');
  await viewer.page.waitForSelector('.station');

  // Rename a station by typing; nobody presses Save.
  const first = adminPhone.page.locator('#stationList .edit-row').first().locator('input[data-f=name]');
  await first.fill('Faith Corner');
  const t0 = Date.now();
  await viewer.page.waitForSelector('.station h3:has-text("Faith Corner")', { timeout: 5000 });
  assert.ok(Date.now() - t0 < 2500, `rename reached the other device after ${Date.now() - t0} ms`);

  // Add one more: it appears on the other device too.
  await adminPhone.page.click('#addStation');
  await viewer.page.waitForFunction(() => document.querySelectorAll('.station').length === 4, null, { timeout: 5000 });
  assert.deepEqual([...adminPhone.page.errors, ...viewer.page.errors], []);
  await adminPhone.ctx.close();
  await viewer.ctx.close();
});

test('Start with a planned time shows a countdown everywhere, then starts by itself', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Countdown', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('program', { segments: [{ title: 'Registration', duration_s: 600 }, { title: 'Opening', duration_s: 300 }] });
  await admin('event', { planned_start: Date.now() + 2 * 3_600_000 + 5000 });

  const a = await phone();
  await a.page.goto(url(`#/go/${made.key}`));
  await a.page.waitForSelector('#controls .go-label:has-text("Start countdown")');
  const v = await phone();
  await v.page.goto(url(`#/e/${made.code}`));
  await v.page.waitForSelector('.hero');
  assert.equal(await v.page.locator('.hero-time').count(), 0, 'no timer before Start is pressed');

  await a.page.click('#controls [data-act=next]');
  await v.page.waitForSelector('.hero-caption:has-text("Starts in")', { timeout: 5000 });
  assert.match(await v.page.textContent('.hero-time'), /^2:00:0\d$/, 'counts down the two hours to the start');
  await a.page.waitForSelector('#controls .go-label:has-text("Start now")');

  // Move the start to 3 seconds from now: when it comes, the program starts on its own.
  await admin('event', { planned_start: Date.now() + 3000 });
  await v.page.waitForSelector('.hero-caption:has-text("Time left")', { timeout: 10000 });
  assert.match(await v.page.textContent('.hero-title'), /Registration/);
  // The admin's phone writes it down, so the database agrees.
  await a.page.waitForSelector('#controls .go-sub:has-text("Opening")', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1000));
  const st = await stack.rpc('et_state', { p_code: made.code, p_since: 0 });
  assert.deepEqual([st.event.status, st.event.current_index], ['live', 0]);
  assert.deepEqual([...a.page.errors, ...v.page.errors], []);
  await a.ctx.close();
  await v.ctx.close();
});

test('notes: full-screen on the stations it is for, confirmed live in Master control', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Notes', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('event', { stations_enabled: true });
  await admin('stations', { stations: [{ name: 'Faith' }, { name: 'Service' }] });
  const { codes } = await admin('codes');

  const a = await phone();
  await a.page.goto(url(`#/go/${made.key}`));
  await a.page.waitForSelector('#controls');
  await a.page.click('[data-tab=notes]');
  const st = await phone();
  await st.page.goto(url(`#/go/${codes[0].code}`));
  await st.page.waitForSelector('.crowd-grid');
  const viewer = await phone();
  await viewer.page.goto(url(`#/e/${made.code}`));
  await viewer.page.waitForSelector('.page-event .hero');
  await new Promise((r) => setTimeout(r, 1500));

  // Master control: quick note to the stations, with a 5-minute countdown.
  await a.page.click('[data-quick="Please wrap up your sessions"]');
  await a.page.check('input[name=audience][value=stations]');
  await a.page.selectOption('select[name=minutes]', '5');
  const t0 = Date.now();
  await a.page.click('#noteForm button[type=submit]');
  await st.page.waitForSelector('.notice-overlay .notice-text:has-text("Please wrap up your sessions")', { timeout: 5000 });
  assert.ok(Date.now() - t0 < 1500, `station saw it after ${Date.now() - t0} ms`);
  assert.match(await st.page.textContent('#noticeTimer'), /^(5:00|4:5\d) left$/);
  const size = await st.page.$eval('.notice-text', (el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(size >= 36, `very big text (${size}px)`);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(await viewer.page.locator('.notice-overlay').count(), 0, 'a note for stations does not go to the facilitator view');
  await a.page.waitForSelector('.note-acks .waiting:has-text("Faith")');

  // The station confirms: the pop-up goes, the countdown stays at the bottom, Master control sees it.
  await st.page.click('#noticeOk');
  await st.page.waitForSelector('.notice-overlay', { state: 'detached' });
  await st.page.waitForSelector('.notice-bar:has-text("left")');
  await a.page.waitForSelector('.note-acks .acked:has-text("Faith")', { timeout: 5000 });
  await a.page.waitForSelector('.note-acks .waiting:has-text("Service")');

  // A note for everyone reaches the facilitator view; confirming is counted.
  await admin('notice', { text: 'Lunch is served in the canteen', audience: 'everyone' });
  await viewer.page.waitForSelector('.notice-text:has-text("Lunch is served")', { timeout: 5000 });
  await viewer.page.click('#noticeOk');
  await a.page.waitForSelector('.note-others:has-text("1 other phone confirmed")', { timeout: 5000 });

  for (const x of [a, st, viewer]) assert.deepEqual(x.page.errors, []);
  await Promise.all([a.ctx.close(), st.ctx.close(), viewer.ctx.close()]);
});

test('notes: presenter yes, big screen no; a scheduled note pops up by itself', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Notes 2', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('program', { segments: [{ title: 'Talk', duration_s: 600 }] });
  const pv = await phone({ viewport: { width: 1280, height: 800 } });
  await pv.page.goto(url(`#/e/${made.code}/presenter`));
  await pv.page.waitForSelector('#pvTitle');
  const tv = await phone({ viewport: { width: 1280, height: 720 } });
  await tv.page.goto(url(`#/e/${made.code}/stage`));
  await tv.page.waitForSelector('#stageTitle');

  await admin('notice', { text: 'Two minutes, please', audience: 'everyone', show_at: Date.now() + 2500 });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(await pv.page.locator('.notice-overlay').count(), 0, 'not before its time');
  await pv.page.waitForSelector('.notice-text:has-text("Two minutes, please")', { timeout: 6000 });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await tv.page.locator('.notice-overlay').count(), 0, 'never on the big screen');
  assert.deepEqual([...pv.page.errors, ...tv.page.errors], []);
  await Promise.all([pv.ctx.close(), tv.ctx.close()]);
});

test('a program that has ended can be restarted, or reset to not started', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Restart', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('program', { segments: [{ title: 'Opening', duration_s: 300 }, { title: 'Closing', duration_s: 300 }] });
  await admin('start', { from: -1 });
  await admin('next', { from: 0 });
  await admin('next', { from: 1 }); // ended

  const a = await phone();
  await a.page.goto(url(`#/go/${made.key}`));
  await a.page.waitForSelector('#controls [data-act=restart]');
  const v = await phone();
  await v.page.goto(url(`#/e/${made.code}`));
  await v.page.waitForSelector('.hero-title:has-text("The program has ended")');

  await a.page.click('#controls [data-act=restart]');
  await a.page.click('dialog[open] button[value=ok]');
  await a.page.waitForSelector('#controls .go-sub:has-text("Closing")', { timeout: 10000 }); // Next › Closing
  await v.page.waitForSelector('.hero-title:has-text("Opening")', { timeout: 10000 });
  assert.match(await v.page.textContent('.hero-caption'), /Time left/);
  const st = await stack.rpc('et_state', { p_code: made.code, p_since: 0 });
  assert.deepEqual([st.event.status, st.event.current_index, st.segments[1].started_at], ['live', 0, null]);

  // End it again, then "Reset to not started": no timer until Start.
  await admin('end');
  await a.page.waitForSelector('#controls [data-act=resetonly]', { timeout: 10000 });
  await a.page.click('#controls [data-act=resetonly]');
  await a.page.click('dialog[open] button[value=ok]');
  // "Ended" also has no running clock, so wait for the reset itself.
  await v.page.waitForSelector('.hero-label:has-text("Not started")', { timeout: 10000 });
  assert.equal(await v.page.locator('.hero-time').count(), 0);
  assert.equal((await stack.rpc('et_state', { p_code: made.code, p_since: 0 })).event.status, 'ready');
  assert.deepEqual([...a.page.errors, ...v.page.errors], []);
  await a.ctx.close();
  await v.ctx.close();
});

test('who is online: open screens count, closed ones drop off at once', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Online', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('event', { stations_enabled: true });
  await admin('stations', { stations: [{ name: 'Faith' }, { name: 'Service' }] });
  const { codes } = await admin('codes');

  const a = await phone();
  await a.page.goto(url(`#/go/${made.key}`));
  await a.page.waitForSelector('#controls');
  await a.page.waitForSelector('.station:has-text("Faith") .online-off');

  const st = await phone();
  await st.page.goto(url(`#/go/${codes[0].code}`));
  await st.page.waitForSelector('.crowd-grid');
  const v = await phone();
  await v.page.goto(url(`#/e/${made.code}`));
  await v.page.waitForSelector('.page-event .hero');

  // Master control sees them within a moment, without refreshing.
  await a.page.waitForSelector('.station:has-text("Faith") .online-on:has-text("1 online")', { timeout: 5000 });
  await a.page.waitForSelector('.station:has-text("Service") .online-off');
  await a.page.waitForSelector('.online-now:has-text("1 in Facilitator view")', { timeout: 5000 });
  await a.page.waitForSelector('.online-now:has-text("1 at stations")');

  // The station facilitator closes the app: it drops off straight away.
  const t0 = Date.now();
  await st.page.goto('about:blank');
  await a.page.waitForSelector('.station:has-text("Faith") .online-off', { timeout: 5000 });
  assert.ok(Date.now() - t0 < 3000, `dropped off after ${Date.now() - t0} ms`);

  // Everyone can see it too: the Facilitator view's Stations tab.
  await v.page.click('[data-tab=stations]');
  await v.page.waitForSelector('.online-now:has-text("Online now")');
  for (const x of [a, st, v]) assert.deepEqual(x.page.errors, []);
  await Promise.all([a.ctx.close(), st.ctx.close(), v.ctx.close()]);
});

test('overtime: every screen shows the updated time, and a flexible break wins it back', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Catch up', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  // Talk 1 min, Break 10 min (can shrink), Session 10 min. Planned from 2 min ago, so the talk is already 1 min over.
  await admin('program', { segments: [{ title: 'Talk', duration_s: 60 }, { title: 'Break', duration_s: 600, flexible: true }, { title: 'Session', duration_s: 600 }] });
  await admin('event', { planned_start: Date.now() - 120_000 });
  await admin('start', { from: -1, now: true });
  await stack.pool.query("update et_events set segment_started_at = now() - interval '2 minutes', started_at = now() - interval '2 minutes', rev = rev + 1 where code = $1", [made.code]);
  const v = await phone();
  await v.page.goto(url(`#/e/${made.code}`));
  await v.page.waitForSelector('.hero-sched:has-text("Schedule updated")', { timeout: 8000 });
  assert.match(await v.page.textContent('.hero-sched'), /breaks shorten to finish on time/);
  assert.match(await v.page.textContent('.runsheet'), /shorter to catch up/);
  assert.deepEqual(v.page.errors, []);
  await v.ctx.close();
});

test('Next onto a station step pops it up on the stations by itself, and Master control sees every station live', { skip }, async () => {
  const made = await stack.rpc('et_create', { p_name: 'Auto steps', p_venue: '' });
  const admin = (action, args = {}) => stack.rpc('et_admin', { p_code: made.code, p_key: made.key, p_action: action, p_args: args });
  await admin('event', { stations_enabled: true });
  await admin('stations', { stations: [{ name: 'Room A' }] });
  await admin('program', { segments: [
    { title: 'S1 · Students entering', duration_s: 480 },
    { title: 'S1 · Introduction of guest speaker', duration_s: 300 },
  ] });
  const { codes } = await admin('codes');

  const st = await phone();
  await st.page.goto(url(`#/e/${made.code}/join/${codes[0].code}`));
  await st.page.waitForSelector('.crowd-grid');
  const m = await phone({ viewport: { width: 1280, height: 800 } });
  await m.page.goto(url(`#/go/${made.key}`));
  await m.page.waitForSelector('#controls');

  await m.page.click('[data-act=next]');
  await st.page.waitForSelector('.notice-overlay:has-text("Students entering")', { timeout: 5000 });
  await st.page.click('#noticeOk');
  await st.page.waitForSelector('.mine-phase:has-text("Students entering")');
  await m.page.waitForSelector('.glance-table:has-text("Room A")');
  await m.page.waitForSelector('.glance-table:has-text("Students entering")');

  await m.page.click('[data-act=next]');
  await st.page.waitForSelector('.notice-overlay:has-text("Introduction of guest speaker")', { timeout: 5000 });
  await m.page.waitForSelector('.glance-table:has-text("Introduction of guest speaker")');
  assert.deepEqual([...st.page.errors, ...m.page.errors], []);
  await st.ctx.close();
  await m.ctx.close();
});
