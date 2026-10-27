// What this phone remembers: events it has opened, and the keys it was given.
// Nothing here is shared; it is the same as a note in the person's pocket.
import { storage } from './sync.js';

export function recentEvents() {
  return storage.get('et.recent', []);
}

export function rememberEvent(code, name) {
  const list = recentEvents().filter((e) => e.code !== code);
  list.unshift({ code, name: name || code, at: Date.now() });
  storage.set('et.recent', list.slice(0, 12));
}

export function forgetEvent(code) {
  storage.set('et.recent', recentEvents().filter((e) => e.code !== code));
  setAdminKey(code, null);
  setStationAccess(code, null);
  try {
    localStorage.removeItem(`et.snap.${code}`);
    localStorage.removeItem(`et.outbox.${code}`);
  } catch { /* ignore */ }
}

export function adminKey(code) {
  return storage.get(`et.admin.${code}`, null);
}

export function setAdminKey(code, key) {
  storage.set(`et.admin.${code}`, key || null);
}

// { id, key } for the station this phone works at.
export function stationAccess(code) {
  return storage.get(`et.station.${code}`, null);
}

export function setStationAccess(code, access) {
  storage.set(`et.station.${code}`, access || null);
}

export function myName() {
  return storage.get('et.name', '');
}

export function setMyName(name) {
  storage.set('et.name', String(name || '').slice(0, 40));
}
