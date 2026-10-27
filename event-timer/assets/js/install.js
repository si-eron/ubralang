// "Add it to your home screen first."
//
// On a phone, the app works best installed: full screen, its own icon, the
// screen kept on, and it opens with no signal. So the first time someone
// opens the site in a phone's browser, they see how to install it, with the
// steps for their own phone, before anything else. They can still carry on
// in the browser if they must; that choice lasts until the tab is closed.
//
// One thing people trip over: an app added to the home screen does not share
// what the browser remembered (on iPhone in particular). So if they came in
// through an event link, the event code is shown here to type in once the
// app is open.
import { esc, prettyCode } from './ui.js';

let deferredPrompt = null;
const listeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  try { localStorage.setItem('et.installed', '1'); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
});

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function canPromptInstall() {
  return Boolean(deferredPrompt);
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  return choice && choice.outcome === 'accepted';
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

// 'ios' | 'android' | 'desktop'
export function platform() {
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

function iosBrowser() {
  const ua = navigator.userAgent || '';
  if (/CriOS/i.test(ua)) return 'Chrome';
  if (/FxiOS/i.test(ua)) return 'Firefox';
  if (/EdgiOS/i.test(ua)) return 'Edge';
  return 'Safari';
}

export function needsInstall(hash) {
  if (platform() === 'desktop' || isStandalone()) return false;
  if (/\/stage$/.test(hash)) return false; // a big screen is not a phone app
  try {
    if (sessionStorage.getItem('et.browserOk') === '1') return false;
  } catch { /* ignore */ }
  return true;
}

const SHARE_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const PLUS_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const DOTS_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>';

function stepsHtml() {
  if (platform() === 'ios') {
    const browser = iosBrowser();
    const where = browser === 'Safari'
      ? 'at the bottom of the screen (on iPad: top right)'
      : 'at the top right, next to the address';
    return `<ol class="steps-install">
      <li><span class="n">1</span><span>Tap the <strong>Share</strong> button ${SHARE_ICON} ${where}.</span></li>
      <li><span class="n">2</span><span>Scroll down and tap <strong>Add to Home Screen</strong> ${PLUS_ICON}.</span></li>
      <li><span class="n">3</span><span>Tap <strong>Add</strong> (top right).</span></li>
      <li><span class="n">4</span><span>Close ${esc(browser)} and open <strong>Event Timer</strong> from your home screen.</span></li>
    </ol>
    ${browser !== 'Safari' ? '<p class="field-help">Don’t see “Add to Home Screen”? Open this page in <strong>Safari</strong> and try again.</p>' : ''}`;
  }
  return `<ol class="steps-install">
      <li><span class="n">1</span><span>Tap the menu ${DOTS_ICON} at the top right of Chrome.</span></li>
      <li><span class="n">2</span><span>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</span></li>
      <li><span class="n">3</span><span>Tap <strong>Install</strong> (or <strong>Add</strong>).</span></li>
      <li><span class="n">4</span><span>Open <strong>Event Timer</strong> from your home screen.</span></li>
    </ol>`;
}

export function installView(root, hash, onContinue) {
  const code = (hash.match(/^#\/e\/([A-Za-z0-9]+)/) || [])[1];
  const phone = platform() === 'ios' ? 'iPhone' : 'Android phone';
  const draw = () => {
    const installed = (() => { try { return localStorage.getItem('et.installed') === '1'; } catch { return false; } })();
    root.innerHTML = `
      <div class="page install-gate">
        <section class="card gate-card">
          <img class="gate-icon" src="assets/icons/icon-192.png" alt="" width="72" height="72">
          <h1 class="card-title gate-title">${installed ? 'The app is installed' : 'Add Event Timer to your home screen first'}</h1>
          <p class="lede">${installed
            ? 'Open <strong>Event Timer</strong> from your home screen. It works there full screen, keeps your screen on, and still opens when the signal drops.'
            : `It works like an app on your ${phone}: full screen, keeps the screen on, and still opens when the signal drops. It takes 20 seconds.`}</p>
          ${installed ? '' : canPromptInstall()
            ? '<button class="btn btn-go" id="installNow"><span class="go-label">Install the app</span><span class="go-sub">Free · no app store needed</span></button>'
            : stepsHtml()}
          ${code ? `<div class="gate-code">
            <p class="eyebrow">Your event code</p>
            <p class="bigcode">${esc(prettyCode(code))}</p>
            <p class="field-help">Once the app is open, tap <strong>Join</strong> and type this code. (The app on your home screen doesn’t see what this browser had open.)</p>
          </div>` : ''}
        </section>
        <p class="center"><button class="btn btn-ghost btn-small" id="browserOk">Continue in the browser for now</button></p>
      </div>`;
    root.querySelector('#installNow')?.addEventListener('click', async () => {
      await promptInstall();
      draw();
    });
    root.querySelector('#browserOk').addEventListener('click', () => {
      try { sessionStorage.setItem('et.browserOk', '1'); } catch { /* ignore */ }
      onContinue();
    });
  };
  draw();
  return onInstallChange(draw);
}
