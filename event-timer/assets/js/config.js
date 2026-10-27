// Where the shared database lives. Fill these two in once (see SETUP.md):
// Supabase → Project Settings → API (or Data API) → Project URL, and the
// publishable key ("anon public" on older projects).
//
// The key is meant to be public; it identifies the project and grants nothing
// on its own. What anyone can do is decided by backend/schema.sql.
export const SUPABASE_URL = 'https://wgmcjqudipvwltkrcsms.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_eUBqGEJhaSdj3_7mAE8lFg_QIgE8VCS';

// For development: ?backend=local makes this visit talk to tools/dev-server.js
// on the same address instead. It sticks for the browser tab, not forever.
function localOverride() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('backend') === 'local') sessionStorage.setItem('et.backend', 'local');
    if (params.get('backend') === 'remote') sessionStorage.removeItem('et.backend');
    return sessionStorage.getItem('et.backend') === 'local';
  } catch {
    return false;
  }
}

export function backendUrl() {
  if (localOverride()) return location.origin;
  return SUPABASE_URL.replace(/\/+$/, '');
}

export function backendKey() {
  if (localOverride()) return 'local';
  return SUPABASE_PUBLISHABLE_KEY;
}
