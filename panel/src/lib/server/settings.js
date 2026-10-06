// Panelens inställningar. Sparas i panel-data/settings.json bredvid panelen.
// GSLT-token sparas separat i panel-data/gslt.txt och RCON-lösenordet läses från server.cfg –
// inget av dem hamnar i settings.json eller visas i klartext i gränssnittet.
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.GSP_DATA || path.resolve(process.cwd(), 'panel-data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export const DEFAULTS = {
	lang: 'en',
	serverRoot: process.env.GSP_ROOT || 'C:\\GameServers\\CS2',
	steamcmd: process.env.GSP_STEAMCMD || 'C:\\SteamCMD\\steamcmd.exe',
	// Valfritt: en .bat som startar MySQL/MariaDB (behövs bara för K4-Arenas).
	mariadbBat: '',
	port: 27015,
	// Gamla startfiler där GSLT-token (sv_setsteamaccount) kan hittas. Oftast tom – token anges i panelen.
	gsltSources: [],
	defaultMode: 'retakes',
	modes: {
		retakes: {
			name: 'Retakes',
			description: 'The bomb is already planted – CT retakes the site. Weapon menu with !guns, works with bots.',
			args: '-dedicated -console -usercon -port {port} +game_type 0 +game_mode 1 +mapgroup mg_active +map de_mirage +sv_setsteamaccount {gslt} +exec server.cfg',
			enable: ['plugins/RetakesPlugin', 'plugins/GamlaSkolanVapen', 'plugins/InstadefusePlugin', 'plugins/ClutchAnnouncePlugin'],
			disable: ['plugins/Deathmatch', 'shared/DeathmatchAPI', 'plugins/K4-Arenas', 'plugins/K4-Arenas-Bots', 'plugins/GamlaSkolanMvp', 'plugins/ZombieMode', 'plugins/ZombieMode.Money', 'plugins/ZombieMode.Magazines', 'plugins/ZombieMode.WeaponDamage'],
			mariadb: false,
			maps: ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_ancient', 'de_anubis', 'de_overpass', 'de_vertigo', 'de_train']
		},
		deathmatch: {
			name: 'Deathmatch',
			description: 'Free for all, first to 100 kills wins the map. MVP celebration and map rotation.',
			args: '-dedicated -console -usercon -port {port} +game_type 1 +game_mode 2 +mapgroup mg_active +map de_dust2 +sv_setsteamaccount {gslt} +exec server.cfg',
			enable: ['plugins/Deathmatch', 'shared/DeathmatchAPI', 'plugins/GamlaSkolanMvp'],
			disable: ['plugins/K4-Arenas', 'plugins/K4-Arenas-Bots', 'plugins/RetakesPlugin', 'plugins/GamlaSkolanVapen', 'plugins/InstadefusePlugin', 'plugins/ClutchAnnouncePlugin', 'plugins/ZombieMode', 'plugins/ZombieMode.Money', 'plugins/ZombieMode.Magazines', 'plugins/ZombieMode.WeaponDamage'],
			mariadb: false,
			maps: ['de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_train', 'de_ancient', 'de_anubis', 'de_vertigo', 'de_overpass']
		},
		arenas: {
			name: '1v1 Arenas',
			description: 'K4-Arenas – 1v1 duels that rotate through arenas. Needs MySQL/MariaDB and an arena map.',
			args: '-dedicated -console -usercon -port {port} +game_type 0 +game_mode 0 +map de_dust2 +sv_setsteamaccount {gslt} +exec server.cfg',
			enable: ['plugins/K4-Arenas'],
			disable: ['plugins/Deathmatch', 'shared/DeathmatchAPI', 'plugins/RetakesPlugin', 'plugins/GamlaSkolanVapen', 'plugins/InstadefusePlugin', 'plugins/ClutchAnnouncePlugin', 'plugins/ZombieMode', 'plugins/ZombieMode.Money', 'plugins/ZombieMode.Magazines', 'plugins/ZombieMode.WeaponDamage'],
			mariadb: true,
			maps: []
		},
		zombie: {
			name: 'Zombie',
			description: 'Infection: one hidden player turns, bites make you bleed. Humans survive the round, zombies infect everyone.',
			args: '-dedicated -console -usercon -port {port} +game_type 0 +game_mode 0 +mapgroup mg_active +map de_dust2 +sv_setsteamaccount {gslt} +exec server.cfg',
			enable: ['plugins/ZombieMode', 'plugins/ZombieMode.Money', 'plugins/ZombieMode.Magazines', 'plugins/ZombieMode.WeaponDamage'],
			disable: ['plugins/Deathmatch', 'shared/DeathmatchAPI', 'plugins/K4-Arenas', 'plugins/K4-Arenas-Bots', 'plugins/RetakesPlugin', 'plugins/GamlaSkolanVapen', 'plugins/InstadefusePlugin', 'plugins/ClutchAnnouncePlugin', 'plugins/GamlaSkolanMvp'],
			mariadb: false,
			maps: ['de_dust2', 'de_mirage', 'de_inferno', 'cs_office', 'cs_italy', 'de_nuke', 'de_vertigo', 'de_ancient']
		}
	}
};

// De tre inbyggda lägena. De kan redigeras men inte tas bort helt (omröstningen i spelet känner till dem).
export const BUILTIN_MODES = Object.keys(DEFAULTS.modes);

let cache = null;

export function getSettings() {
	if (cache) return cache;
	let saved = {};
	const existed = fs.existsSync(SETTINGS_FILE);
	try {
		saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
	} catch {
		/* första start */
	}
	// Installationer från före språkvalet var på svenska – behåll det.
	let migrated = false;
	if (existed && !saved.lang) {
		saved.lang = 'sv';
		saved.legacyBrand = true;
		migrated = true;
	}
	// Inbyggda lägen: behåll det du sparat, men ta in nya plugins i enable/disable när panelen uppdateras.
	// Ett inbyggt läge som tagits bort i panelen (removed: true) läggs inte tillbaka.
	const modes = { ...DEFAULTS.modes, ...(saved.modes || {}) };
	for (const [id, def] of Object.entries(DEFAULTS.modes)) {
		const cur = saved.modes?.[id];
		if (!cur) continue;
		if (cur.custom) continue; // redigerat för hand i panelen – rör inte listorna
		const union = (a = [], b = []) => [...new Set([...a, ...b])];
		const enable = union(cur.enable, def.enable);
		const disable = union(cur.disable, def.disable).filter((d) => !enable.includes(d));
		modes[id] = { ...def, ...cur, enable, disable, maps: cur.maps?.length ? cur.maps : def.maps };
	}
	const changed = JSON.stringify(modes) !== JSON.stringify(saved.modes || {});
	cache = { ...DEFAULTS, ...saved, modes };
	if (!cache.modes[cache.defaultMode]) cache.defaultMode = Object.keys(cache.modes)[0];
	if (changed || migrated || !existed) saveSettings(cache);
	return cache;
}

export function saveSettings(next) {
	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
	cache = next;
}

// Svensk eller engelsk text för meddelanden från servern (händelser, fel).
export function L(sv, en) {
	return getSettings().lang === 'sv' ? sv : en;
}

export function updateSettings(patch) {
	const cur = getSettings();
	const allowed = ['serverRoot', 'steamcmd', 'mariadbBat', 'port', 'defaultMode', 'lang'];
	const next = { ...cur };
	for (const k of allowed) if (patch[k] !== undefined) next[k] = k === 'port' ? Number(patch[k]) : String(patch[k]).trim();
	if (next.lang !== 'sv') next.lang = 'en';
	if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) throw new Error(L('Ogiltig port', 'Invalid port'));
	if (!next.modes[next.defaultMode]) next.defaultMode = cur.defaultMode;
	saveSettings(next);
	return next;
}

// ---- lägen som går att redigera i panelen ----
const REL = /^(plugins|shared)\/[\w.\-]+$/;

export function saveMode(id, data) {
	const cur = getSettings();
	const key = String(id || '').trim().toLowerCase();
	if (!/^[a-z0-9_-]{2,24}$/.test(key)) throw new Error(L('Läges-id: 2–24 tecken, a–z, 0–9, - eller _', 'Mode id: 2–24 characters, a–z, 0–9, - or _'));
	const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\r\n,]+/)).map((x) => String(x).trim().replace(/\\/g, '/')).filter(Boolean);
	const enable = list(data.enable);
	const disable = list(data.disable).filter((d) => !enable.includes(d));
	for (const rel of [...enable, ...disable]) if (!REL.test(rel)) throw new Error(L(`Ogiltig plugin-sökväg: ${rel} (t.ex. plugins/RetakesPlugin)`, `Invalid plugin path: ${rel} (e.g. plugins/RetakesPlugin)`));
	const args = String(data.args || '').trim();
	if (!args.includes('-dedicated')) throw new Error(L('Startargumenten måste innehålla -dedicated', 'Launch arguments must contain -dedicated'));
	const name = String(data.name || '').trim().slice(0, 40) || key;
	const mode = {
		...(cur.modes[key] || {}),
		name,
		description: String(data.description || '').trim().slice(0, 200),
		args,
		enable,
		disable,
		mariadb: !!data.mariadb,
		maps: list(data.maps).filter((m) => /^[\w\-]+$/.test(m)),
		custom: true
	};
	const next = { ...cur, modes: { ...cur.modes, [key]: mode } };
	saveSettings(next);
	return mode;
}

export function deleteMode(id) {
	const cur = getSettings();
	if (!cur.modes[id]) throw new Error(L('Okänt läge', 'Unknown mode'));
	if (Object.keys(cur.modes).length <= 1) throw new Error(L('Minst ett läge måste finnas kvar', 'At least one mode must remain'));
	const modes = { ...cur.modes };
	delete modes[id];
	const next = { ...cur, modes };
	if (next.defaultMode === id) next.defaultMode = Object.keys(modes)[0];
	saveSettings(next);
}

export function resetMode(id) {
	if (!DEFAULTS.modes[id]) throw new Error(L('Bara inbyggda lägen kan återställas', 'Only built-in modes can be reset'));
	const cur = getSettings();
	const next = { ...cur, modes: { ...cur.modes, [id]: { ...DEFAULTS.modes[id] } } };
	saveSettings(next);
}

export function paths() {
	const s = getSettings();
	const csgo = path.join(s.serverRoot, 'game', 'csgo');
	const css = path.join(csgo, 'addons', 'counterstrikesharp');
	return {
		root: s.serverRoot,
		bin: path.join(s.serverRoot, 'game', 'bin', 'win64'),
		exe: path.join(s.serverRoot, 'game', 'bin', 'win64', 'cs2.exe'),
		csgo,
		cfg: path.join(csgo, 'cfg'),
		logs: path.join(csgo, 'logs'),
		gameinfo: path.join(csgo, 'gameinfo.gi'),
		steamInf: path.join(csgo, 'steam.inf'),
		manifest: path.join(s.serverRoot, 'steamapps', 'appmanifest_730.acf'),
		css,
		cssLogs: path.join(css, 'logs'),
		cssPlugins: path.join(css, 'plugins'),
		cssConfigs: path.join(css, 'configs', 'plugins'),
		panelDisabled: path.join(s.serverRoot, '_panel_disabled'),
		dataDir: DATA_DIR
	};
}

// --- hemligheter, läses vid behov och visas aldrig i gränssnittet ---
export function readRconPassword() {
	try {
		const txt = fs.readFileSync(path.join(paths().cfg, 'server.cfg'), 'utf8');
		const m = txt.match(/^\s*rcon_password\s+"?([^"\r\n]+)"?/m);
		return m ? m[1].trim() : null;
	} catch {
		return null;
	}
}

// GSLT-token: panelen sparar en egen kopia i panel-data/gslt.txt första gången den hittar den
// i en gammal startfil, så att de gamla .bat-filerna kan tas bort utan att servern slutar starta.
const GSLT_FILE = path.join(DATA_DIR, 'gslt.txt');

function tokenIn(txt) {
	let m = txt.match(/sv_setsteamaccount\s+"?([A-Fa-f0-9]{24,40})"?/);
	if (m) return m[1];
	m = txt.match(/STEAM_TOKEN=([A-Fa-f0-9]{24,40})/);
	return m ? m[1] : null;
}

export function readGslt() {
	try {
		const own = tokenIn(fs.readFileSync(GSLT_FILE, 'utf8'));
		if (own) return own;
	} catch {
		/* ingen egen kopia än */
	}
	for (const f of getSettings().gsltSources) {
		try {
			const t = tokenIn(fs.readFileSync(f, 'utf8'));
			if (!t) continue;
			try {
				fs.mkdirSync(DATA_DIR, { recursive: true });
				fs.writeFileSync(GSLT_FILE, `STEAM_TOKEN=${t}\r\n`, 'utf8');
			} catch {
				/* kunde inte spara kopian – används ändå */
			}
			return t;
		} catch {
			/* nästa fil */
		}
	}
	return null;
}

export function saveGslt(token) {
	const t = String(token || '').trim();
	if (!t) {
		try {
			fs.unlinkSync(GSLT_FILE);
		} catch {
			/* fanns inte */
		}
		return null;
	}
	if (!/^[A-Fa-f0-9]{24,40}$/.test(t)) throw new Error(L('Det ser inte ut som en GSLT-token (32 tecken, 0–9 och A–F)', 'That does not look like a GSLT token (32 characters, 0–9 and A–F)'));
	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.writeFileSync(GSLT_FILE, `STEAM_TOKEN=${t}\r\n`, 'utf8');
	return t;
}

export function maskedGslt() {
	const t = readGslt();
	return t ? `${t.slice(0, 4)}••••••••••••${t.slice(-4)}` : null;
}
