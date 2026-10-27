-- Event Time Tracker — database
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run more than once, and it is safe to run inside a project that
-- already holds something else (the FCUSR Task Tracker, for example): every
-- table and function here starts with et_ and touches nothing else.
--
-- How it is protected. The web page ships with Supabase's publishable key,
-- which anyone can read. So the tables themselves are closed: row-level
-- security is on and there are no policies, which means the publishable key
-- cannot read or write a single row directly. Everything goes through the six
-- functions at the bottom of this file, and each one checks the code it is
-- given:
--
--   et_state    anyone with the event code      read the live state
--   et_create   anyone                          make a new event
--   et_admin    the master admin key            run the program, edit it
--   et_station  that station's code (or admin)  update one station
--   et_role     either                          "which one is this code?"
--   et_enter    any code on its own             "where does this code lead?"
--
-- Codes are drawn from 31 characters that cannot be confused when read aloud
-- or off a screen (no 0/O, 1/I/L). An admin key is 8 of them, about 850
-- billion possibilities; a station code is 6, about 890 million. The admin key
-- is stored only as a salted hash and is shown once, when the event is made.
--
-- Every change bumps the event's rev. Phones ask "has rev moved since mine?"
-- every few seconds; when it has not, the answer is a few bytes.

-- ------------------------------------------------------------------ tables

create table if not exists et_events (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,             -- what people type to join
  name               text not null,
  venue              text not null default '',
  planned_start      timestamptz,                      -- optional: when it is meant to begin
  stations_enabled   boolean not null default false,
  -- The live clock. Only et_admin changes these.
  status             text not null default 'ready'
                       check (status in ('ready', 'countdown', 'live', 'hold', 'ended')),
  current_index      int not null default -1,          -- -1 before the start
  segment_started_at timestamptz,
  segment_extra_s    int not null default 0,           -- the +1 min / −1 min buttons
  hold_started_at    timestamptz,                      -- set while on hold
  hold_total_ms      bigint not null default 0,        -- time held in this segment
  started_at         timestamptz,
  ended_at           timestamptz,
  message            text not null default '',         -- announcement to every screen
  message_at         timestamptz,
  admin_salt         text not null,
  admin_hash         text not null,
  rev                bigint not null default 1,
  created_at         timestamptz not null default now(),
  touched_at         timestamptz not null default now()
);

-- 'countdown': the admin pressed Start before the planned start time; the
-- first segment begins by itself at that time. (Databases set up before this
-- get the wider list of statuses here.)
alter table et_events drop constraint if exists et_events_status_check;
alter table et_events add constraint et_events_status_check
  check (status in ('ready', 'countdown', 'live', 'hold', 'ended'));

create table if not exists et_segments (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references et_events(id) on delete cascade,
  position    int not null,                            -- 0, 1, 2 … in running order
  title       text not null,
  duration_s  int not null default 300 check (duration_s between 0 and 86400),
  lead        text not null default '',                -- who is on, or in charge
  notes       text not null default '',
  started_at  timestamptz,                             -- what actually happened
  ended_at    timestamptz,
  constraint et_segments_order unique (event_id, position) deferrable initially deferred
);

create table if not exists et_stations (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references et_events(id) on delete cascade,
  position         int not null,
  name             text not null,
  location         text not null default '',
  -- The station's own little program. Facilitators move it along.
  phases           text[] not null default array['Students entering', 'Introduction of guest speaker', 'Session', 'Students exit'],
  phase_index      int not null default -1,            -- -1 = not started yet
  phase_started_at timestamptz,
  crowd            text not null default 'open'
                     check (crowd in ('open', 'filling', 'full', 'closed')),
  note             text not null default '',
  updated_at       timestamptz,
  updated_by       text not null default '',
  code             text not null,                      -- handed to the station's facilitators
  constraint et_stations_order unique (event_id, position) deferrable initially deferred
);

-- Databases set up before the four-step default keep their stations as they are;
-- only stations made from now on start with it.
alter table et_stations alter column phases set default array['Students entering', 'Introduction of guest speaker', 'Session', 'Students exit'];

create table if not exists et_log (
  id        bigserial primary key,
  event_id  uuid not null references et_events(id) on delete cascade,
  at        timestamptz not null default now(),
  kind      text not null,                             -- 'program' | 'station' | 'message'
  text      text not null
);

-- So an admin key works on its own, without the event code: an unsalted
-- fingerprint of the key, used only to find the event. (The salted hash above
-- is still what proves the key.) Events made before this was added get theirs
-- the next time their admin key is used.
alter table et_events add column if not exists admin_lookup text;
create unique index if not exists et_events_admin_lookup on et_events (admin_lookup);
create index if not exists et_stations_code on et_stations (code);

create index if not exists et_segments_event on et_segments (event_id, position);
create index if not exists et_stations_event on et_stations (event_id, position);
create index if not exists et_log_event on et_log (event_id, at desc);

alter table et_events   enable row level security;
alter table et_segments enable row level security;
alter table et_stations enable row level security;
alter table et_log      enable row level security;

revoke all on et_events, et_segments, et_stations, et_log from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on et_events, et_segments, et_stations, et_log from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on et_events, et_segments, et_stations, et_log from authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------- helpers

-- Codes are typed by people: ignore case, spaces and dashes.
create or replace function et_norm(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Random code from an alphabet with no look-alike characters. The randomness
-- comes from gen_random_uuid(), which uses the operating system's secure source.
create or replace function et_random_code(p_len int) returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := '';
  result text := '';
  i int;
begin
  while length(bytes) < p_len loop
    -- Bytes 0–5 and 10–15 of a v4 uuid are fully random.
    bytes := bytes || substring(uuid_send(gen_random_uuid()) from 1 for 6)
                   || substring(uuid_send(gen_random_uuid()) from 11 for 6);
  end loop;
  for i in 0 .. p_len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;
  return result;
end $$;

-- A 6-character code no event and no station already uses, so that any code
-- typed on its own leads to exactly one place.
create or replace function et_new_code() returns text
language plpgsql volatile as $$
declare
  v text;
begin
  loop
    v := et_random_code(6);
    exit when not exists (select 1 from et_events where code = v)
          and not exists (select 1 from et_stations where code = v);
  end loop;
  return v;
end $$;

create or replace function et_lookup(p_key text) returns text
language sql immutable as $$
  select encode(sha256(convert_to('et-admin:' || p_key, 'UTF8')), 'hex')
$$;

create or replace function et_hash(p_salt text, p_key text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_salt || ':' || p_key, 'UTF8')), 'hex')
$$;

create or replace function et_ms(p timestamptz) returns bigint
language sql immutable as $$
  select case when p is null then null else floor(extract(epoch from p) * 1000)::bigint end
$$;

create or replace function et_int(p text) returns int
language plpgsql immutable as $$
begin
  return round(p::numeric)::int;
exception when others then
  return null;
end $$;

create or replace function et_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- When did this action happen? Phones send the moment the button was pressed,
-- already corrected to the server's clock, so a tap made while offline still
-- lands at the right time once it uploads. The server keeps it honest: never in
-- the future, never more than 15 minutes back, and never before p_floor.
create or replace function et_at(p_ms text, p_floor timestamptz) returns timestamptz
language plpgsql volatile as $$
declare
  t timestamptz;
begin
  begin
    t := to_timestamp(p_ms::double precision / 1000);
  exception when others then
    t := null;
  end;
  if t is null or t > clock_timestamp() then
    t := clock_timestamp();
  end if;
  return greatest(t, clock_timestamp() - interval '15 minutes', coalesce(p_floor, '-infinity'));
end $$;

create or replace function et_fail(p_error text) returns jsonb
language sql volatile as $$
  select jsonb_build_object('ok', false, 'error', p_error, 'now', et_ms(clock_timestamp()))
$$;

-- Every change: move rev on, then push the new state to every open screen.
create or replace function et_touch(p_event uuid) returns void
language plpgsql as $$
begin
  update et_events set rev = rev + 1, touched_at = now() where id = p_event;
  perform et_publish(p_event);
end $$;

-- An event deleted: tell open screens at once, so they stop showing it.
create or replace function et_publish_gone(p_code text) returns void
language plpgsql as $$
begin
  begin
    if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
      execute 'select realtime.send($1, $2, $3, false)'
        using jsonb_build_object('deleted', true), 'state', 'et:' || p_code;
    else
      perform pg_notify('et_broadcast', json_build_object('code', p_code, 'deleted', true)::text);
    end if;
  exception when others then
    null;
  end;
end $$;

-- Live push. On Supabase, Realtime broadcasts the whole new state on the
-- topic "et:<event code>" the moment the change is saved, so every phone
-- updates at once instead of waiting for its next check. (Anyone with the
-- event code can already read that state through et_state, so the topic
-- shares nothing new.) Without Realtime (a plain Postgres, as in the tests)
-- it sends a NOTIFY that tools/dev-server.js turns into the same push.
-- A push that fails never undoes the change: phones still check every few
-- seconds.
create or replace function et_publish(p_event uuid) returns void
language plpgsql as $$
declare
  v_code text;
  v_rev bigint;
  v_snap jsonb;
begin
  select code, rev into v_code, v_rev from et_events where id = p_event;
  if v_code is null then
    return;
  end if;
  begin
    if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
      v_snap := et_snapshot(p_event);
      execute 'select realtime.send($1, $2, $3, false)'
        using jsonb_build_object('rev', v_rev, 'snapshot', v_snap), 'state', 'et:' || v_code;
    else
      perform pg_notify('et_broadcast', json_build_object('code', v_code, 'rev', v_rev)::text);
    end if;
  exception when others then
    null;
  end;
end $$;

create or replace function et_note(p_event uuid, p_at timestamptz, p_kind text, p_text text) returns void
language sql as $$
  insert into et_log (event_id, at, kind, text) values (p_event, coalesce(p_at, now()), p_kind, left(p_text, 200))
$$;

-- Everything a screen needs, and nothing secret: no admin hash, no station codes.
create or replace function et_snapshot(p_event uuid) returns jsonb
language sql volatile as $$
  select jsonb_build_object(
    'ok', true,
    'changed', true,
    'now', et_ms(clock_timestamp()),
    'rev', e.rev,
    'event', jsonb_build_object(
      'code', e.code,
      'name', e.name,
      'venue', e.venue,
      'planned_start', et_ms(e.planned_start),
      'stations_enabled', e.stations_enabled,
      'status', e.status,
      'current_index', e.current_index,
      'segment_started_at', et_ms(e.segment_started_at),
      'segment_extra_s', e.segment_extra_s,
      'hold_started_at', et_ms(e.hold_started_at),
      'hold_total_ms', e.hold_total_ms,
      'started_at', et_ms(e.started_at),
      'ended_at', et_ms(e.ended_at),
      'message', e.message,
      'message_at', et_ms(e.message_at)
    ),
    'segments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'position', s.position, 'title', s.title, 'duration_s', s.duration_s,
        'lead', s.lead, 'notes', s.notes,
        'started_at', et_ms(s.started_at), 'ended_at', et_ms(s.ended_at)
      ) order by s.position)
      from et_segments s where s.event_id = e.id), '[]'::jsonb),
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'position', t.position, 'name', t.name, 'location', t.location,
        'phases', to_jsonb(t.phases), 'phase_index', t.phase_index,
        'phase_started_at', et_ms(t.phase_started_at), 'crowd', t.crowd, 'note', t.note,
        'updated_at', et_ms(t.updated_at), 'updated_by', t.updated_by
      ) order by t.position)
      from et_stations t where t.event_id = e.id), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('at', et_ms(l.at), 'kind', l.kind, 'text', l.text) order by l.at desc, l.id desc)
      from (select * from et_log where event_id = e.id order by at desc, id desc limit 30) l), '[]'::jsonb)
  )
  from et_events e where e.id = p_event
$$;

-- Start segment p_target now, closing whatever was running.
create or replace function et_go(p_event uuid, p_target int, p_at timestamptz) returns void
language plpgsql as $$
declare
  e et_events;
begin
  select * into e from et_events where id = p_event;
  update et_segments set ended_at = p_at
   where event_id = p_event and position = e.current_index
     and started_at is not null and ended_at is null and position <> p_target;
  update et_segments set started_at = p_at, ended_at = null
   where event_id = p_event and position = p_target;
  -- Anything after the new segment has not happened yet (matters when going back).
  update et_segments set started_at = null, ended_at = null
   where event_id = p_event and position > p_target;
  update et_events set
    status = 'live',
    current_index = p_target,
    segment_started_at = p_at,
    segment_extra_s = 0,
    hold_started_at = null,
    hold_total_ms = 0,
    started_at = coalesce(started_at, p_at),
    ended_at = null
  where id = p_event;
end $$;

-- ---------------------------------------------------------------- et_state

create or replace function et_state(p_code text, p_since bigint default 0)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  e et_events;
begin
  select * into e from et_events where code = et_norm(p_code);
  if not found then
    return et_fail('not_found');
  end if;
  if p_since is not null and p_since = e.rev then
    return jsonb_build_object('ok', true, 'changed', false, 'rev', e.rev, 'now', et_ms(clock_timestamp()));
  end if;
  return et_snapshot(e.id);
end $$;

-- --------------------------------------------------------------- et_create

create or replace function et_create(p_name text, p_venue text default '')
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  v_code text;
  v_key text := et_random_code(8);
  v_salt text := et_random_code(16);
  v_id uuid;
begin
  if v_name = '' then
    return et_fail('name_required');
  end if;
  -- A free database is not a place for someone to pour in a million events.
  if (select count(*) from et_events where created_at > now() - interval '1 hour') >= 60 then
    return et_fail('busy');
  end if;
  v_code := et_new_code();
  insert into et_events (code, name, venue, admin_salt, admin_hash, admin_lookup)
  values (v_code, v_name, left(btrim(coalesce(p_venue, '')), 120), v_salt, et_hash(v_salt, v_key), et_lookup(v_key))
  returning id into v_id;
  return et_snapshot(v_id) || jsonb_build_object('code', v_code, 'key', v_key);
end $$;

-- ---------------------------------------------------------------- et_admin

create or replace function et_admin(p_code text, p_key text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  e et_events;
  a jsonb := coalesce(p_args, '{}'::jsonb);
  v_at timestamptz;
  v_from int := et_int(a->>'from');
  v_count int;
  v_target int;
  v_title text;
  v_cur_id uuid;
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_phases text[];
  v_text text;
  v_extra jsonb := '{}'::jsonb;
  item jsonb;
  i int;
  v_dur int;
  v_held bigint := 0;
begin
  select * into e from et_events where code = et_norm(p_code) for update;
  if not found then
    return et_fail('not_found');
  end if;
  if et_hash(e.admin_salt, et_norm(p_key)) <> e.admin_hash then
    return et_fail('wrong_key');
  end if;
  if e.admin_lookup is null then
    update et_events set admin_lookup = et_lookup(et_norm(p_key)) where id = e.id;
  end if;

  -- A countdown that has reached the planned start: the first segment began
  -- at that moment, whether or not anyone was looking. Every screen already
  -- shows it that way; this writes it down before the admin's action.
  if e.status = 'countdown' and e.planned_start is not null and e.planned_start <= clock_timestamp()
     and exists (select 1 from et_segments where event_id = e.id and position = 0) then
    perform et_go(e.id, 0, e.planned_start);
    perform et_note(e.id, e.planned_start, 'program',
      'Now: ' || (select title from et_segments where event_id = e.id and position = 0));
    perform et_touch(e.id);
    select * into e from et_events where id = e.id;
  end if;

  select count(*) into v_count from et_segments where event_id = e.id;
  v_at := et_at(a->>'at', greatest(e.segment_started_at, e.hold_started_at));
  if e.status = 'hold' and e.hold_started_at is not null then
    v_held := et_ms(v_at) - et_ms(e.hold_started_at);
  end if;
  select title into v_title from et_segments where event_id = e.id and position = e.current_index;

  -- Program moves carry the segment the phone was looking at ("from"). If the
  -- program has already moved on — another tap, a second phone, an upload
  -- retried after a timeout — the move is not applied twice.
  if p_action in ('start', 'next', 'prev', 'goto') and coalesce(v_from, -2) <> e.current_index then
    return et_snapshot(e.id) || jsonb_build_object('stale', true);
  end if;

  case p_action

  when 'verify' then
    return et_snapshot(e.id);

  when 'start', 'next' then
    -- Start before the planned start time: count down to it instead of
    -- starting now. ("Start now" sends now = true to skip the countdown.)
    if p_action = 'start' and e.status = 'ready' and e.planned_start is not null
       and e.planned_start > clock_timestamp() + interval '1 second'
       and coalesce((a->>'now')::boolean, false) = false then
      if v_count = 0 then
        return et_fail('no_segments');
      end if;
      update et_events set status = 'countdown' where id = e.id;
      perform et_note(e.id, now(), 'program', 'Countdown started');
      perform et_touch(e.id);
      return et_snapshot(e.id);
    end if;
    if e.status = 'ended' then
      return et_snapshot(e.id) || jsonb_build_object('stale', true);
    end if;
    if v_count = 0 then
      return et_fail('no_segments');
    end if;
    if e.current_index >= v_count - 1 then
      -- Next on the last segment ends the program.
      update et_segments set ended_at = v_at
       where event_id = e.id and position = e.current_index and ended_at is null;
      update et_events set status = 'ended', ended_at = v_at,
             hold_total_ms = hold_total_ms + v_held, hold_started_at = null
       where id = e.id;
      perform et_note(e.id, v_at, 'program', 'Program ended');
    else
      perform et_go(e.id, e.current_index + 1, v_at);
      select title into v_title from et_segments where event_id = e.id and position = e.current_index + 1;
      perform et_note(e.id, v_at, 'program', 'Now: ' || v_title);
    end if;

  when 'prev' then
    if e.status = 'countdown' then
      -- Back during the countdown: cancel it.
      update et_events set status = 'ready' where id = e.id;
      perform et_note(e.id, v_at, 'program', 'Countdown cancelled');
    elsif e.status = 'ended' then
      update et_segments set ended_at = null where event_id = e.id and position = e.current_index;
      update et_events set status = 'live', ended_at = null where id = e.id;
      perform et_note(e.id, v_at, 'program', 'Reopened: ' || coalesce(v_title, ''));
    elsif e.current_index = 0 then
      update et_segments set started_at = null, ended_at = null where event_id = e.id;
      update et_events set status = 'ready', current_index = -1, segment_started_at = null,
             segment_extra_s = 0, hold_started_at = null, hold_total_ms = 0,
             started_at = null, ended_at = null
       where id = e.id;
      perform et_note(e.id, v_at, 'program', 'Back to the start');
    elsif e.current_index > 0 then
      -- Undo the last Next: the previous segment carries on as if it never stopped.
      update et_segments set started_at = null, ended_at = null
       where event_id = e.id and position >= e.current_index;
      update et_segments set ended_at = null
       where event_id = e.id and position = e.current_index - 1;
      update et_events set current_index = current_index - 1,
             segment_started_at = coalesce(
               (select started_at from et_segments where event_id = e.id and position = e.current_index - 1),
               v_at),
             segment_extra_s = 0, hold_started_at = null, hold_total_ms = 0, status = 'live'
       where id = e.id;
      select title into v_title from et_segments where event_id = e.id and position = e.current_index - 1;
      perform et_note(e.id, v_at, 'program', 'Back to: ' || v_title);
    end if;

  when 'goto' then
    v_target := et_int(a->>'index');
    if v_target is null or v_target < 0 or v_target >= v_count then
      return et_fail('bad_index');
    end if;
    perform et_go(e.id, v_target, v_at);
    select title into v_title from et_segments where event_id = e.id and position = v_target;
    perform et_note(e.id, v_at, 'program', 'Jumped to: ' || v_title);

  when 'hold' then
    if e.status = 'live' then
      update et_events set status = 'hold', hold_started_at = v_at where id = e.id;
      perform et_note(e.id, v_at, 'program', 'On hold: ' || coalesce(v_title, ''));
    end if;

  when 'resume' then
    if e.status = 'hold' then
      update et_events set status = 'live', hold_started_at = null,
             hold_total_ms = hold_total_ms + v_held
       where id = e.id;
      perform et_note(e.id, v_at, 'program', 'Resumed: ' || coalesce(v_title, ''));
    end if;

  when 'adjust' then
    if e.status in ('live', 'hold') then
      select duration_s into v_dur from et_segments where event_id = e.id and position = e.current_index;
      update et_events
         set segment_extra_s = greatest(-coalesce(v_dur, 0),
                                        least(86400, segment_extra_s + coalesce(et_int(a->>'seconds'), 0)))
       where id = e.id;
    end if;

  when 'end' then
    if e.status in ('live', 'hold') then
      update et_segments set ended_at = v_at
       where event_id = e.id and position = e.current_index and ended_at is null;
      update et_events set status = 'ended', ended_at = v_at,
             hold_total_ms = hold_total_ms + v_held, hold_started_at = null
       where id = e.id;
      perform et_note(e.id, v_at, 'program', 'Program ended');
    end if;

  when 'reset' then
    update et_segments set started_at = null, ended_at = null where event_id = e.id;
    update et_events set status = 'ready', current_index = -1, segment_started_at = null,
           segment_extra_s = 0, hold_started_at = null, hold_total_ms = 0,
           started_at = null, ended_at = null
     where id = e.id;
    perform et_note(e.id, now(), 'program', 'Clock reset');

  when 'message' then
    v_text := left(btrim(coalesce(a->>'text', '')), 280);
    update et_events set message = v_text, message_at = case when v_text = '' then null else now() end
     where id = e.id;
    if v_text <> '' then
      perform et_note(e.id, now(), 'message', 'Announcement: ' || v_text);
    end if;

  when 'event' then
    v_text := left(btrim(coalesce(a->>'name', e.name)), 120);
    update et_events set
      name = case when v_text = '' then name else v_text end,
      venue = case when a ? 'venue' then left(btrim(coalesce(a->>'venue', '')), 120) else venue end,
      planned_start = case when a ? 'planned_start'
                           then case when a->>'planned_start' is null then null
                                     else to_timestamp((a->>'planned_start')::double precision / 1000) end
                           else planned_start end,
      stations_enabled = case when a ? 'stations_enabled'
                              then coalesce((a->>'stations_enabled')::boolean, stations_enabled)
                              else stations_enabled end
    where id = e.id;

  when 'program' then
    if jsonb_typeof(a->'segments') is distinct from 'array' then
      return et_fail('bad_program');
    end if;
    if jsonb_array_length(a->'segments') > 200 then
      return et_fail('too_many');
    end if;
    select id into v_cur_id from et_segments where event_id = e.id and position = e.current_index;
    -- Checked before anything changes: the segment on stage cannot be deleted.
    if v_cur_id is not null and e.status <> 'ready' and not exists (
         select 1 from jsonb_array_elements(a->'segments') x where et_uuid(x->>'id') = v_cur_id) then
      return et_fail('current_removed');
    end if;
    i := 0;
    for item in select * from jsonb_array_elements(a->'segments') loop
      v_id := et_uuid(item->>'id');
      v_title := left(btrim(coalesce(item->>'title', '')), 120);
      if v_title = '' then v_title := 'Untitled'; end if;
      v_dur := greatest(0, least(86400, coalesce(et_int(item->>'duration_s'), 300)));
      if v_id is not null and exists (select 1 from et_segments where id = v_id and event_id = e.id) then
        update et_segments set position = i, title = v_title, duration_s = v_dur,
               lead = left(btrim(coalesce(item->>'lead', '')), 80),
               notes = left(btrim(coalesce(item->>'notes', '')), 500)
         where id = v_id;
      else
        insert into et_segments (event_id, position, title, duration_s, lead, notes)
        values (e.id, i, v_title, v_dur,
                left(btrim(coalesce(item->>'lead', '')), 80),
                left(btrim(coalesce(item->>'notes', '')), 500))
        returning id into v_id;
      end if;
      v_ids := v_ids || v_id;
      i := i + 1;
    end loop;
    delete from et_segments where event_id = e.id and not (id = any (v_ids));
    if v_cur_id is not null and e.status <> 'ready' then
      update et_events set current_index = (select position from et_segments where id = v_cur_id)
       where id = e.id;
    end if;

  when 'stations' then
    if jsonb_typeof(a->'stations') is distinct from 'array' then
      return et_fail('bad_stations');
    end if;
    if jsonb_array_length(a->'stations') > 60 then
      return et_fail('too_many');
    end if;
    i := 0;
    for item in select * from jsonb_array_elements(a->'stations') loop
      v_id := et_uuid(item->>'id');
      v_title := left(btrim(coalesce(item->>'name', '')), 60);
      if v_title = '' then v_title := 'Station ' || (i + 1); end if;
      select coalesce(array_agg(left(btrim(p), 40)) filter (where btrim(p) <> ''), array[]::text[])
        into v_phases
        from (select jsonb_array_elements_text(
                case when jsonb_typeof(item->'phases') = 'array' then item->'phases' else '[]'::jsonb end) p
              limit 12) x;
      if cardinality(v_phases) = 0 then
        v_phases := array['Students entering', 'Introduction of guest speaker', 'Session', 'Students exit'];
      end if;
      if v_id is not null and exists (select 1 from et_stations where id = v_id and event_id = e.id) then
        update et_stations set position = i, name = v_title, phases = v_phases,
               location = left(btrim(coalesce(item->>'location', '')), 80),
               phase_index = least(phase_index, cardinality(v_phases) - 1)
         where id = v_id;
      else
        insert into et_stations (event_id, position, name, location, phases, code)
        values (e.id, i, v_title, left(btrim(coalesce(item->>'location', '')), 80), v_phases, et_new_code())
        returning id into v_id;
      end if;
      v_ids := v_ids || v_id;
      i := i + 1;
    end loop;
    delete from et_stations where event_id = e.id and not (id = any (v_ids));

  when 'station_code' then
    update et_stations set code = et_new_code()
     where id = et_uuid(a->>'id') and event_id = e.id;

  when 'codes' then
    -- Read only; nothing to bump.
    return et_snapshot(e.id) || jsonb_build_object('codes', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code) order by position)
      from et_stations where event_id = e.id), '[]'::jsonb));

  when 'new_key' then
    v_text := et_random_code(8);
    update et_events set admin_hash = et_hash(admin_salt, v_text), admin_lookup = et_lookup(v_text) where id = e.id;
    v_extra := jsonb_build_object('key', v_text);

  when 'delete' then
    delete from et_events where id = e.id;
    perform et_publish_gone(e.code);
    return jsonb_build_object('ok', true, 'deleted', true, 'now', et_ms(clock_timestamp()));

  else
    return et_fail('unknown_action');
  end case;

  perform et_touch(e.id);
  return et_snapshot(e.id) || v_extra;
end $$;

-- -------------------------------------------------------------- et_station

create or replace function et_station(p_code text, p_station uuid, p_key text, p_patch jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  e et_events;
  s et_stations;
  p jsonb := coalesce(p_patch, '{}'::jsonb);
  v_at timestamptz;
  v_phase int;
  v_crowd text;
  v_label text;
begin
  select * into e from et_events where code = et_norm(p_code);
  if not found then
    return et_fail('not_found');
  end if;
  select * into s from et_stations where id = p_station and event_id = e.id for update;
  if not found then
    return et_fail('no_station');
  end if;
  if et_norm(p_key) <> s.code and et_hash(e.admin_salt, et_norm(p_key)) <> e.admin_hash then
    return et_fail('wrong_key');
  end if;
  if p = '{}'::jsonb then
    return et_snapshot(e.id);  -- just checking the code
  end if;

  v_at := et_at(p->>'at', null);
  -- Two facilitators at one station, or an update that waited offline: the
  -- one pressed last wins, whichever reaches the server first.
  if s.updated_at is not null and v_at < s.updated_at then
    return et_snapshot(e.id) || jsonb_build_object('stale', true);
  end if;

  v_phase := case when p ? 'phase_index'
                  then greatest(-1, least(cardinality(s.phases) - 1, coalesce(et_int(p->>'phase_index'), s.phase_index)))
                  else s.phase_index end;
  v_crowd := case when p->>'crowd' in ('open', 'filling', 'full', 'closed') then p->>'crowd' else s.crowd end;

  update et_stations set
    phase_index = v_phase,
    phase_started_at = case when v_phase <> s.phase_index then v_at else phase_started_at end,
    crowd = v_crowd,
    note = case when p ? 'note' then left(btrim(coalesce(p->>'note', '')), 140) else note end,
    updated_by = case when p ? 'by' then left(btrim(coalesce(p->>'by', '')), 40) else updated_by end,
    updated_at = v_at
  where id = s.id;

  if v_phase <> s.phase_index then
    perform et_note(e.id, v_at, 'station', s.name || ': ' ||
      case when v_phase < 0 then 'not started' else s.phases[v_phase + 1] end);
  end if;
  if v_crowd <> s.crowd then
    v_label := case v_crowd when 'open' then 'open, room available' when 'filling' then 'filling up'
                            when 'full' then 'FULL HOUSE' else 'closed' end;
    perform et_note(e.id, v_at, 'station', s.name || ' is ' || v_label);
  end if;

  perform et_touch(e.id);
  return et_snapshot(e.id);
end $$;

-- ----------------------------------------------------------------- et_role

-- "I am working this event": one box for either the admin key or a station
-- code, so a facilitator does not need to know which station a code opens.
create or replace function et_role(p_code text, p_key text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  e et_events;
  v_station uuid;
begin
  select * into e from et_events where code = et_norm(p_code);
  if not found then
    return et_fail('not_found');
  end if;
  if et_hash(e.admin_salt, et_norm(p_key)) = e.admin_hash then
    return jsonb_build_object('ok', true, 'role', 'admin', 'now', et_ms(clock_timestamp()));
  end if;
  select id into v_station from et_stations where event_id = e.id and code = et_norm(p_key);
  if found then
    return jsonb_build_object('ok', true, 'role', 'station', 'station', v_station, 'now', et_ms(clock_timestamp()));
  end if;
  return et_fail('wrong_key');
end $$;

-- ---------------------------------------------------------------- et_enter

-- One box for every code. It says where the code leads:
--   the event code  -> 'viewer'  (follow the program)
--   a station code  -> 'station' (that station's controls)
--   the admin key   -> 'admin'   (master control)
create or replace function et_enter(p_key text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  k text := et_norm(p_key);
  v_code text;
  v_station uuid;
  v_count int;
begin
  if k = '' then
    return et_fail('not_found');
  end if;
  select code into v_code from et_events where admin_lookup = et_lookup(k);
  if found then
    return jsonb_build_object('ok', true, 'role', 'admin', 'code', v_code, 'now', et_ms(clock_timestamp()));
  end if;
  select code into v_code from et_events where code = k;
  if found then
    return jsonb_build_object('ok', true, 'role', 'viewer', 'code', v_code, 'now', et_ms(clock_timestamp()));
  end if;
  select count(*) into v_count from et_stations where code = k;
  if v_count = 1 then
    select s.id, e.code into v_station, v_code
      from et_stations s join et_events e on e.id = s.event_id where s.code = k;
    return jsonb_build_object('ok', true, 'role', 'station', 'code', v_code, 'station', v_station, 'now', et_ms(clock_timestamp()));
  elsif v_count > 1 then
    return et_fail('ambiguous');
  end if;
  return et_fail('not_found');
end $$;

-- ------------------------------------------------------------------ grants

-- Supabase lets the publishable key run every new function by default. Take
-- that away from the helpers, then give back only the six front doors.
do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'et_norm(text)', 'et_random_code(int)', 'et_hash(text,text)', 'et_ms(timestamptz)',
    'et_int(text)', 'et_uuid(text)', 'et_at(text,timestamptz)', 'et_fail(text)',
    'et_touch(uuid)', 'et_publish(uuid)', 'et_publish_gone(text)', 'et_note(uuid,timestamptz,text,text)', 'et_snapshot(uuid)',
    'et_go(uuid,int,timestamptz)',
    'et_state(text,bigint)', 'et_create(text,text)', 'et_admin(text,text,text,jsonb)',
    'et_station(text,uuid,text,jsonb)', 'et_role(text,text)',
    'et_new_code()', 'et_lookup(text)', 'et_enter(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;
  foreach f in array array[
    'et_state(text,bigint)', 'et_create(text,text)', 'et_admin(text,text,text,jsonb)',
    'et_station(text,uuid,text,jsonb)', 'et_role(text,text)', 'et_enter(text)'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('grant execute on function %s to %I', f, r);
      end if;
    end loop;
  end loop;
end $$;

-- Ask PostgREST to notice the new functions straight away.
notify pgrst, 'reload schema';
