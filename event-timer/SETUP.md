# Putting it online, for free

Two parts: the **database** (Supabase Free) and the **website** (GitHub
Pages). About ten minutes. No credit card for either.

## 1. The database (Supabase)

**Already have a Supabase project?** For example the FCUSR Task Tracker's. You
can use it: everything here is named `et_…` and touches nothing else. Skip to
step 3. A free account gets two active projects, so sharing one keeps the
other free.

1. Go to **supabase.com**, sign in, **New project**. Name it
   `event-time-tracker`, region **Southeast Asia (Singapore)**. Keep the
   database password somewhere safe; this app never needs it.
2. Wait for it to finish setting up (a minute or two).
3. **SQL Editor → New query**. Paste in all of
   [`backend/schema.sql`](backend/schema.sql) and press **Run**. It should
   say *Success*. Running it again later (after an update) is safe.
4. **Project Settings → API** (on newer projects: **Data API**, and **API
   Keys**). Copy:
   - the **Project URL**, like `https://abcdxyz.supabase.co`
   - the **publishable** key (`sb_publishable_…`), or on older projects the
     **anon public** key.
5. Put both into [`assets/js/config.js`](assets/js/config.js):

   ```js
   export const SUPABASE_URL = 'https://abcdxyz.supabase.co';
   export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_…';
   ```

   That key is meant to be public. It identifies the project and grants
   nothing by itself: the tables are closed to it, and the only things it can
   do are the five functions in `schema.sql`, each of which checks the code it
   is given.

   **Never** put the database password or the `service_role` / secret key in
   this project.

## 2. The website (GitHub Pages)

This folder is a complete static site. Any free static host works; GitHub
Pages is the simplest because the code is already on GitHub.

**From this repository** (`si-eron/ubralang`, already public):

1. Merge this branch into `main`.
2. On github.com: the repository → **Settings → Pages** → Source **Deploy from
   a branch**, branch **main**, folder **/ (root)** → **Save**.
3. After a minute or two the event tracker is at
   `https://si-eron.github.io/ubralang/event-timer/`.

**Or as its own site:** make a new public repository (for example
`event-timer`), copy the contents of this folder into it, and turn on Pages
the same way. The address is then `https://<account>.github.io/event-timer/`.

Pages is free only for public repositories. Nothing secret is in this code, so
that is fine.

To publish a change afterwards: commit and push. The live site follows within a
minute or two, and phones pick up the new version the next time they open it.

## 3. Check it works

1. Open the site. The home page should **not** say "Not connected yet".
2. **Create an event**, add two segments, press **Start program**.
3. Open the event code on a second phone. Press **Next** on the first; the
   second follows within a few seconds.

## Things to know about the free plans

- **Supabase pauses a free project after a week with no use.** Open the site,
  or the Supabase dashboard, at least once in the week before an event. If it
  has paused, the dashboard has a **Restore** button (free, a few minutes).
  Nothing is lost.
- Supabase Free allows 500 MB of stored data and 5 GB of downloads a month. An
  event stores a few hundred kilobytes. A phone that is up to date gets a
  55-byte answer; a change sends the whole state (2–6 KB). With 300 phones
  watching for four hours that comes to roughly 1–2 GB, so about two big
  events a month fit comfortably.
- Each phone asks about once every 2.5 seconds, so 300 phones means about 120
  small requests a second. That is designed to be well within a free
  database, but it has not been load-tested on Supabase. For a crowd much
  bigger than that, have the audience watch the big screen and keep phones
  for staff.
- GitHub Pages: 100 GB of traffic a month, more than any event needs.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "Not connected yet" on the home page | `config.js` is still empty, or the change has not been published yet. |
| "No event has that code" | Mistyped, or the event was deleted. Codes are six characters. |
| The pill says **Offline** everywhere | The Supabase project is paused (see above), or the venue has no internet. Clocks keep running from the last state. |
| The admin key is lost | In Supabase → SQL Editor, run the query below with the event code. It prints a new key and the old one stops working. |

```sql
with k as (select et_random_code(8) as key)
update et_events set admin_hash = et_hash(admin_salt, (select key from k))
where code = 'ABC123'            -- the event code, no dash
returning (select key from k) as new_admin_key;
```
