import { db } from '$lib/supabase';
import type { Kill, PlayerStats } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
  setHeaders({ 'cache-control': 'public, max-age=30, s-maxage=60' });
  const supabase = db();

  const [players, weapons, modes, recent, total] = await Promise.all([
    supabase.from('player_stats').select('*').order('points', { ascending: false }).order('kills', { ascending: false }).limit(100),
    supabase.from('weapon_stats').select('*').order('kills', { ascending: false }).limit(8),
    supabase.from('mode_stats').select('*').order('kills', { ascending: false }),
    supabase.from('kills').select('at,map,mode,weapon,headshot,attacker_id,attacker_name,attacker_bot,victim_id,victim_name,victim_bot')
      .or('attacker_bot.eq.false,victim_bot.eq.false').order('at', { ascending: false }).limit(12),
    supabase.from('kills').select('id', { count: 'exact', head: true })
  ]);

  return {
    players: (players.data ?? []) as PlayerStats[],
    weapons: (weapons.data ?? []) as { weapon: string; kills: number; headshots: number }[],
    modes: (modes.data ?? []) as { mode: string; kills: number; players: number }[],
    recent: (recent.data ?? []) as Kill[],
    totalKills: total.count ?? 0
  };
};
