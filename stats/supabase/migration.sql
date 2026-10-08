-- Gamla Skolan – statistik
create table if not exists public.players (
  steam_id   text primary key,
  name       text not null default '',
  points     integer not null default 0,
  kills      integer not null default 0,
  deaths     integer not null default 0,
  last_seen  timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kills (
  id            bigint generated always as identity primary key,
  at            timestamptz not null,
  map           text not null default '',
  mode          text not null default '',
  weapon        text not null default '',
  headshot      boolean not null default false,
  ranked        boolean not null default false,
  attacker_id   text not null,
  attacker_name text not null default '',
  attacker_bot  boolean not null default false,
  victim_id     text not null,
  victim_name   text not null default '',
  victim_bot    boolean not null default false
);

create index if not exists kills_attacker_idx on public.kills (attacker_id, at desc);
create index if not exists kills_victim_idx   on public.kills (victim_id, at desc);
create index if not exists kills_at_idx       on public.kills (at desc);

alter table public.players enable row level security;
alter table public.kills   enable row level security;

-- Publik läsning, ingen skrivning från webben (bara ingest-funktionen med service role).
drop policy if exists "players are public" on public.players;
create policy "players are public" on public.players for select to anon, authenticated using (true);
drop policy if exists "kills are public" on public.kills;
create policy "kills are public" on public.kills for select to anon, authenticated using (true);

-- Sammanställning per spelare (bara människor)
create or replace view public.player_stats with (security_invoker = true) as
select
  p.steam_id, p.name, p.points, p.kills, p.deaths, p.last_seen,
  coalesce(k.headshots, 0) as headshots,
  coalesce(k.tracked_kills, 0) as tracked_kills,
  k.favorite_weapon,
  k.favorite_mode
from public.players p
left join lateral (
  select
    count(*) filter (where headshot) as headshots,
    count(*) as tracked_kills,
    (select weapon from public.kills w where w.attacker_id = p.steam_id and w.weapon <> ''
       group by weapon order by count(*) desc limit 1) as favorite_weapon,
    (select mode from public.kills m where m.attacker_id = p.steam_id and m.mode <> ''
       group by mode order by count(*) desc limit 1) as favorite_mode
  from public.kills x where x.attacker_id = p.steam_id
) k on true;

create or replace view public.weapon_stats with (security_invoker = true) as
select weapon, count(*) as kills, count(*) filter (where headshot) as headshots
from public.kills where weapon <> '' and not attacker_bot
group by weapon;

create or replace view public.mode_stats with (security_invoker = true) as
select mode, count(*) as kills, count(distinct attacker_id) filter (where not attacker_bot) as players
from public.kills where mode <> ''
group by mode;
