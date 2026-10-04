// Panelens inställningar. Sparas i panel-data/settings.json bredvid panelen.
// Hemligheter (GSLT-token, RCON-lösenord) sparas ALDRIG här – de läses vid behov
// från dina befintliga filer (server.cfg och startfilerna på skrivbordet).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = process.env.GSP_DATA || path.resolve(process.cwd(), 'panel-data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const home = os.homedir();

export const DEFAULTS = {
	serverRoot: process.env.GSP_ROOT || 'C:\\GameServers\\CS2',
	steamcmd: process.env.GSP_STEAMCMD || 'C:\\SteamCMD\\steamcmd.exe',
	mariadbBat: 'C:\\GameServers\\MariaDB\\start-mariadb.bat',
	port: 27016,
	// Filer där GSLT-token (sv_setsteamaccount) kan läsas. Den första som innehåller en token används.
	gsltSources: [
		path.join(home, 'Desktop', 'Starta Gamla Skolan Deathmatch.bat'),
		path.join(home, 'Desktop', 'Starta Aim Arena.bat'),
		path.join(home, 'Desktop', 'Gamla Skolan CS2', 'Gamla_Skolan_Server_Menu.bat')
	],
	defaultMode: 'deathmatch',
	modes: {
		deathmatch: {
			name: 'Classic Deathmatch',
			description: 'Alla mot alla, först till 100 kills. MVP-firande och kartrotation.',
			args: '-dedicated -console -usercon -port {port} +game_type 1 +game_mode 2 +mapgroup mg_active +map de_dust2 +sv_setsteamaccount {gslt} +exec server.cfg +exec gamla_dm_classic.cfg',
			enable: ['plugins/Deathmatch', 'shared/DeathmatchAPI', 'plugins/GamlaSkolanMvp'],
			disable: ['plugins/K4-Arenas', 'plugins/K4-Arenas-Bots', 'plugins/RetakesPlugin', 'plugins/GamlaSkolanVapen', 'plugins/InstadefusePlugin', 'plugins/ClutchAnnouncePlugin'],
			mariadb: false,
			maps: ['de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_train', 'de_ancient', 'de_anubis', 'de_vertigo', 'de_overpass']
		},
		arenas: {
			name: '1v1 Arenas',
			description: 'K4-Arenas med bottar på am_banana_gg. Startar MariaDB automatiskt.',
			args: '-dedicated -console -usercon -port {port} +map de_dust2 +sv_setsteamaccount {gslt} +exec server.cfg +exec arena_boot.cfg',
			enable: ['plugins/K4-Arenas', 'plugins/K4-Arenas-Bots'],
			disable: ['plugins/Deathmatch', 'shared/DeathmatchAPI', 'plugins/RetakesPlugin', 'plugins/GamlaSkolanVapen', 'plugins/InstadefusePlugin', 'plugins/ClutchAnnouncePlugin'],
			mariadb: true,
			maps: []
		},
		retakes: {
			name: 'Retakes',
			description: 'Bomben ligger redan – CT tar tillbaka siten. Vapenval med !vapen, funkar med bottar.',
			args: '-dedicated -console -usercon -port {port} +game_type 0 +game_mode 1 +mapgroup mg_active +map de_mirage +sv_setsteamaccount {gslt} +exec server.cfg',
			enable: ['plugins/RetakesPlugin', 'plugins/GamlaSkolanVapen', 'plugins/InstadefusePlugin', 'plugins/ClutchAnnouncePlugin'],
			disable: ['plugins/Deathmatch', 'shared/DeathmatchAPI', 'plugins/K4-Arenas', 'plugins/K4-Arenas-Bots', 'plugins/GamlaSkolanMvp'],
			mariadb: false,
			maps: ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_ancient', 'de_anubis', 'de_overpass', 'de_vertigo', 'de_train', 'de_cache']
		}
	}
};

let cache = null;

export function getSettings() {
	if (cache) return cache;
	let saved = {};
	try {
		saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
	} catch {
		/* första start */
	}
	// Inbyggda lägen: behåll det du sparat, men ta in nya plugins i enable/disable när panelen uppdateras.
	const modes = { ...DEFAULTS.modes, ...(saved.modes || {}) };
	for (const [id, def] of Object.entries(DEFAULTS.modes)) {
		const cur = saved.modes?.[id];
		if (!cur) continue;
		const union = (a = [], b = []) => [...new Set([...a, ...b])];
		const enable = union(cur.enable, def.enable);
		const disable = union(cur.disable, def.disable).filter((d) => !enable.includes(d));
		modes[id] = { ...def, ...cur, enable, disable, maps: cur.maps?.length ? cur.maps : def.maps };
	}
	const changed = JSON.stringify(modes) !== JSON.stringify(saved.modes || {});
	cache = { ...DEFAULTS, ...saved, modes };
	if (changed && fs.existsSync(SETTINGS_FILE)) saveSettings(cache);
	if (!fs.existsSync(SETTINGS_FILE)) saveSettings(cache);
	return cache;
}

export function saveSettings(next) {
	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
	cache = next;
}

export function updateSettings(patch) {
	const cur = getSettings();
	const allowed = ['serverRoot', 'steamcmd', 'mariadbBat', 'port', 'defaultMode'];
	const next = { ...cur };
	for (const k of allowed) if (patch[k] !== undefined) next[k] = k === 'port' ? Number(patch[k]) : patch[k];
	saveSettings(next);
	return next;
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
