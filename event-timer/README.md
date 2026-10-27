# Event Time Tracker

A live run-of-show clock for events, on a website that installs like an app.

One person, the **master admin**, moves the program along with a single
**Next** button. Every phone, tablet and big screen that has the event open
shows the same thing within a few seconds: what is on now, how much time is
left, what is next, and whether the program is running on time, ahead, or
behind.

With **Station Mode**, each station has its own small program (for example
*Preparing → In session → Wrapping up*). Its facilitators post where they are
in it and how full they are (**Open**, **Filling up**, **Full house**,
**Closed**), so every other station and every facilitator can see it.

It costs nothing to run: a static website (GitHub Pages) and a free database
(Supabase Free). See [SETUP.md](SETUP.md).

---

## Who does what

| Who | Opens | Can |
| --- | --- | --- |
| Anyone | the event code or link | Follow the program and the stations. Change nothing. |
| A station's facilitators | their **station code** | Update their own station: its step, how full it is, a short note. |
| The master admin | the **admin key** | Run the program, edit it, set up stations, send announcements. |

Codes ignore capital letters, spaces and dashes, and never use letters that
look alike (no 0/O or 1/I/L).

## Running an event

1. **Create the event** (home screen → *Create an event*). You get two codes:
   the **event code**, which you share with everyone, and the **admin key**,
   which you keep. Write the admin key down: it is shown once. This phone stays
   signed in as admin.
2. **Add the program** under **Program**. Type it in, or paste a whole list,
   one segment per line with the minutes at the end:

   ```
   Registration - 30
   Opening prayer - 5
   Keynote - 45
   ```

   Each segment can also have a person in charge and private notes. Add a
   **planned start** under Settings to see whether you are on time.
3. **Share** the event code, link or QR code (Share tab). Open **Big screen**
   on the projector or a TV by the stage.
4. On the day, press **Next** each time the program moves on. The first press
   starts it.
   - **Back** undoes the last Next. The earlier segment carries on as if it had
     never stopped.
   - **Hold** stops the clock (a delay, a technical problem); **Resume**
     starts it again.
   - **−1 min / +1 min** shorten or stretch the segment that is on now.
   - **Go** on any line of the run of show jumps straight to it.
   - **Announcement** puts a message on every screen until you clear it.
   - On a laptop: **→** Next, **←** Back, **H** Hold or Resume.

The countdown turns amber near the end of a segment (the last two minutes, or
the last minute of a short one) and red with a **+** once it runs over.

## Station Mode

Turn it on when creating the event, or under **Stations** later. Then, for
each station, give it a name, where it is, and its steps, one per line. Save,
and each station gets its own code. **Copy link** gives a link that signs the
facilitator straight in.

A facilitator opens the link (or the event, then **I'm staff**, then their
code) and sees:

- the main program's clock at the top, so they know what the main program is
  doing;
- big buttons for **their step** (*Start › Next ›* moves them along);
- big buttons for **how full they are**: Open, Filling up, Full house, Closed;
- a short **note** to the others ("Send the next group in 5 minutes"), with
  their name;
- every other station's card below.

Everyone else sees all stations on the **Stations** tab, with a count of how
many are open, filling, full and closed (tap a count to see only those).

## Staying in sync

- Every open screen checks with the server every 2.5 seconds (every 15 seconds
  while the screen is off or the app is in the background). When nothing has
  changed the answer is a few bytes.
- Countdowns run on the **server's clock**, not the phone's. Each answer
  carries the server time, and each phone works out how far off its own clock
  is. A phone whose clock is ten minutes wrong still shows the same seconds as
  everyone else.
- The pill in the corner says **Live** when the phone is in step, **Sending…**
  while it uploads, and **Offline** with the last sync time when it cannot
  reach the server. Offline, the countdown keeps running from what it last
  knew.
- What an admin or a facilitator taps is **saved on the phone first**, with the
  moment it was tapped, then uploaded. If the signal is gone, it goes through
  when it comes back, and it counts from when it was pressed, not when it
  arrived (up to 15 minutes back). A station's tap shows on its own screen
  straight away.
- The same tap arriving twice (a double tap, two admin phones, a retried
  upload) counts once: each Next says which segment it was moving on from, and
  is ignored if the program has already moved. For stations, the tap made last
  wins.
- The app itself is kept on the phone too, so it opens at a venue with no
  signal and shows the last state it saw.

## Putting it on a phone

Open the site, then:

- **iPhone / iPad:** in Safari, *Share* → *Add to Home Screen*.
- **Android:** the browser menu → *Install app* (or *Add to Home screen*). The
  home page also shows an **Install** button where the browser allows it.

Admin, station and big-screen pages ask the phone to keep its screen on.

## Files

```
index.html, manifest.webmanifest, sw.js   the page, the install details, the offline copy
assets/app.css                            the look (light and dark follow the phone)
assets/js/app.js                          screens anyone can open, and the router
assets/js/admin.js                        master control
assets/js/station.js                      a station's own screen
assets/js/stage.js                        the big screen
assets/js/sync.js                         polling, server clock, the outbox
assets/js/time.js                         all timing arithmetic (no screen code)
assets/js/config.js                       where the database is
backend/schema.sql                        the whole database, rules included
tools/dev-server.js                       a local stand-in for Supabase
tests/                                    database, timing and browser tests
```

No build step and nothing to install for the site itself. The QR code maker is
copied into `assets/vendor/` (qrcode-generator, MIT licence).

## Working on it

You need Node 22 and a local Postgres 16 (user `postgres`, password
`postgres`; change it with `TEST_DATABASE_ADMIN_URL`).

```bash
cd event-timer
npm install
createdb et_dev
DATABASE_URL=postgres://postgres:postgres@localhost:5432/et_dev LOAD_SCHEMA=1 npm run dev
# open http://localhost:4400/?backend=local
npm test       # database rules, timing, and three real-browser checks
```

The browser checks use Playwright's Chromium and are skipped if it is not
installed.
