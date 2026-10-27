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
