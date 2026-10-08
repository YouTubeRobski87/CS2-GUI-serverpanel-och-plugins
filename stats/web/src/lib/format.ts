export type PlayerStats = {
  steam_id: string; name: string; points: number; kills: number; deaths: number; last_seen: string;
  headshots: number; tracked_kills: number; favorite_weapon: string | null; favorite_mode: string | null;
};
export type Kill = {
  at: string; map: string; mode: string; weapon: string; headshot: boolean;
  attacker_id: string; attacker_name: string; attacker_bot: boolean;
  victim_id: string; victim_name: string; victim_bot: boolean;
};

const MODES: Record<string, string> = { retakes: 'Retakes', deathmatch: 'Deathmatch', arenas: '1v1 Arenas', zombie: 'Zombie', other: 'Övrigt' };
export const modeName = (m: string | null | undefined) => (m ? MODES[m] ?? m : '–');

const WEAPONS: Record<string, string> = {
  ak47: 'AK-47', m4a1: 'M4A4', m4a1_silencer: 'M4A1-S', awp: 'AWP', deagle: 'Desert Eagle', usp_silencer: 'USP-S',
  glock: 'Glock-18', hkp2000: 'P2000', p250: 'P250', fiveseven: 'Five-SeveN', tec9: 'Tec-9', cz75a: 'CZ75-Auto',
  revolver: 'R8 Revolver', elite: 'Dual Berettas', galilar: 'Galil AR', famas: 'FAMAS', sg556: 'SG 553', aug: 'AUG',
  ssg08: 'SSG 08', scar20: 'SCAR-20', g3sg1: 'G3SG1', mp9: 'MP9', mac10: 'MAC-10', mp7: 'MP7', mp5sd: 'MP5-SD',
  ump45: 'UMP-45', p90: 'P90', bizon: 'PP-Bizon', nova: 'Nova', xm1014: 'XM1014', mag7: 'MAG-7', sawedoff: 'Sawed-Off',
  negev: 'Negev', m249: 'M249', hegrenade: 'HE-granat', inferno: 'Molotov', taser: 'Zeus', knife: 'Kniv', world: 'Världen'
};
export function weaponName(w: string | null | undefined) {
  if (!w) return '–';
  const k = w.replace(/^weapon_/, '');
  if (k.startsWith('knife') || k === 'bayonet') return 'Kniv';
  return WEAPONS[k] ?? k.toUpperCase();
}

export const kd = (k: number, d: number) => (d === 0 ? k.toFixed(2) : (k / d).toFixed(2));
export const pct = (a: number, b: number) => (b === 0 ? '–' : `${Math.round((a / b) * 100)}%`);

export function tier(points: number) {
  if (points >= 3000) return 'Global Elite';
  if (points >= 2000) return 'Supreme Master';
  if (points >= 1400) return 'Legendary Eagle';
  if (points >= 900) return 'Distinguished Master';
  if (points >= 500) return 'Master Guardian';
  if (points >= 250) return 'Gold Nova';
  if (points >= 100) return 'Silver Elite';
  return 'Silver I';
}

const rtf = new Intl.RelativeTimeFormat('sv', { numeric: 'auto' });
export function ago(iso: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
  let v = s;
  for (const [n, unit] of steps) { if (Math.abs(v) < n) return rtf.format(Math.round(v), unit); v /= n; }
  return '';
}

export const steamUrl = (id: string) => `https://steamcommunity.com/profiles/${id}`;
