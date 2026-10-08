import { error } from '@sveltejs/kit';
import { db } from '$lib/supabase';
import type { Kill, PlayerStats } from '$lib/format';
import type { PageServerLoad } from './$types';

const COLS = 'at,map,mode,weapon,headshot,attacker_id,attacker_name,attacker_bot,victim_id,victim_name,victim_bot';

function top<T extends string>(items: T[], n: number) {
  const counts = new Map<T, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export const load: PageServerLoad = async ({ params, setHeaders }) => {
  if (!/^\d{5,20}$/.test(params.id)) error(404, 'Spelaren finns inte');
  setHeaders({ 'cache-control': 'public, max-age=30, s-maxage=60' });
  const supabase = db();

  const [player, rankList, killsBy, killsOf] = await Promise.all([
    supabase.from('player_stats').select('*').eq('steam_id', params.id).maybeSingle(),
    supabase.from('players').select('steam_id').order('points', { ascending: false }).order('kills', { ascending: false }),
    supabase.from('kills').select(COLS).eq('attacker_id', params.id).order('at', { ascending: false }).limit(2000),
    supabase.from('kills').select(COLS).eq('victim_id', params.id).order('at', { ascending: false }).limit(2000)
  ]);

  if (!player.data) error(404, 'Spelaren finns inte');
  const p = player.data as PlayerStats;
  const by = (killsBy.data ?? []) as Kill[];
  const of = (killsOf.data ?? []) as Kill[];

  const position = (rankList.data ?? []).findIndex((r) => r.steam_id === p.steam_id) + 1;
  const weapons = top(by.map((k) => k.weapon).filter(Boolean), 6);
  const modes = top(by.map((k) => k.mode).filter(Boolean), 4);
  const maps = top(by.map((k) => k.map).filter(Boolean), 4);
  const victims = top(by.filter((k) => !k.victim_bot).map((k) => `${k.victim_id}|${k.victim_name}`), 1);
  const nemesis = top(of.filter((k) => !k.attacker_bot).map((k) => `${k.attacker_id}|${k.attacker_name}`), 1);
  const split = (s?: [string, number]) => (s ? { id: s[0].split('|')[0], name: s[0].slice(s[0].indexOf('|') + 1), count: s[1] } : null);

  const recent = [...by.slice(0, 20), ...of.slice(0, 20)]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 15);

  return {
    player: p,
    position,
    totalPlayers: rankList.data?.length ?? 0,
    weapons,
    modes,
    maps,
    favoriteVictim: split(victims[0]),
    nemesis: split(nemesis[0]),
    botKills: by.filter((k) => k.victim_bot).length,
    humanKills: by.filter((k) => !k.victim_bot).length,
    recent
  };
};
