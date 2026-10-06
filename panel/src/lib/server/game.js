// Spelare, plugins, topplista och plugin-inställningar.
import fs from 'node:fs';
import path from 'node:path';
import { paths, getSettings, readGslt, L } from './settings.js';
import { bridgeAlive, readStatus, send, exec } from './bridge.js';
import { isRunning } from './server.js';
import { log } from './events.js';

// ---------------- spelare / live-status ----------------
export async function liveStatus() {
	if (!isRunning()) return { ok: false, reason: 'offline', players: [] };
	// Ingen RCON här: den får CS2 att frysa. Bryggpluginet skriver status till fil varje sekund.
	if (!bridgeAlive()) return { ok: false, reason: 'bridge', players: [] };
	return readStatus() ?? { ok: false, reason: 'bridge', players: [] };
}

function cleanArg(s) {
	return String(s ?? '').replace(/["\r\n;]/g, '').slice(0, 120);
}

export async function playerAction(action, slot, extra = {}) {
	const n = Number(slot);
	if (!Number.isInteger(n) || n < 0 || n > 64) throw new Error(L('Ogiltig spelare', 'Invalid player'));
	let out;
	if (action === 'kick') out = await send({ type: 'kick', slot: n, arg: cleanArg(extra.reason || L('Kickad av admin', 'Kicked by admin')) });
	else if (action === 'slay') out = await send({ type: 'slay', slot: n });
	else if (action === 'team') out = await send({ type: 'team', slot: n, arg: ['t', 'ct', 'spec'].includes(extra.team) ? extra.team : 'spec' });
	else if (action === 'ban') {
		const minutes = Math.max(0, Math.min(525600, Number(extra.minutes) || 0));
		out = await exec(`css_ban #${Number(extra.userid)} ${minutes} "${cleanArg(extra.reason || L('Bannad av admin', 'Banned by admin'))}"`);
	} else throw new Error(L('Okänd åtgärd', 'Unknown action'));
	log('player', L(`${action} → spelare ${n}`, `${action} → player ${n}`));
	return out;
}

// ---------------- plugins ----------------
export async function pluginList() {
	const P = paths();
	const installed = [];
	try {
		for (const d of fs.readdirSync(P.cssPlugins, { withFileTypes: true })) if (d.isDirectory()) installed.push(d.name);
	} catch {
		/* */
	}
	const disabled = [];
	try {
		for (const d of fs.readdirSync(path.join(P.panelDisabled, 'plugins'), { withFileTypes: true }))
			if (d.isDirectory()) disabled.push(d.name);
	} catch {
		/* */
	}
	let loaded = [];
	let liveOk = false;
	if (isRunning() && bridgeAlive()) {
		const st = readStatus();
		if (st?.plugins?.length) {
			liveOk = true;
			loaded = st.plugins.map((p) => ({ index: p.id, dir: p.dir, state: String(p.state).toLowerCase(), name: p.name, version: p.version, author: p.author }));
		}
	}
	return { installed, disabled, loaded, liveOk };
}

export async function pluginAction(action, name) {
	if (!['load', 'unload', 'reload'].includes(action)) throw new Error(L('Okänd åtgärd', 'Unknown action'));
	const safe = String(name).replace(/[^\w.\-]/g, '');
	const out = await send({ type: 'plugin', arg: action, command: safe }, 8000);
	log('plugin', `${action} ${safe}`);
	return out;
}

// ---------------- topplista ----------------
export function rankings() {
	const file = path.join(paths().cssPlugins, 'GamlaSkolanRank', 'data', 'rankings.json');
	try {
		// SteamId är för stort för JS-tal – gör om till text innan tolkning.
		const list = JSON.parse(fs.readFileSync(file, 'utf8').replace(/"SteamId"\s*:\s*(\d+)/g, '"SteamId":"$1"'));
		return list
			.map((p) => ({ ...p, SteamId: String(p.SteamId) }))
			.sort((a, b) => b.Points - a.Points || b.Kills - a.Kills);
	} catch {
		return [];
	}
}

// ---------------- plugin-inställningar ----------------
export const EDITABLE = {
	GamlaSkolanLage: {
		title: ['Servernamn', 'Server name'],
		defaults: { Hostname: 'CS2 Multimode – Retakes • DM • 1v1', Prefix: '{gold}[Server]{default}', Language: 'en', ConfigVersion: 1 }
	},
	GamlaSkolanAds: {
		title: ['Tips i chatten', 'Chat tips'],
		defaults: { IntervalSeconds: 120, Prefix: '{green}[Server]{default}', Messages: [], ConfigVersion: 1 }
	},
	GamlaSkolanMvp: {
		title: ['MVP & killgräns', 'MVP & kill limit'],
		defaults: { KillLimit: 100, CelebrationSeconds: 10, MapCycleFile: 'mapcycle_dm.txt', Prefix: '{green}[Server]{default}', Language: 'en', ConfigVersion: 1 }
	},
	GamlaSkolanRank: {
		title: ['Rank', 'Rank'],
		defaults: { PointsPerKill: 10, PointsLostPerDeath: 5, MinimumHumanPlayers: 1, TopCount: 10, ShowPointMessages: true, Language: 'en', ConfigVersion: 1 }
	},
	GamlaSkolanVapen: {
		title: ['Vapenval (Retakes)', 'Weapon menu (Retakes)'],
		defaults: { PistolRounds: 3, AwpPerTeam: 1, BotsCanGetAwp: true, Prefix: '{gold}[Server]{default}', Language: 'en', ConfigVersion: 1 }
	}
};

export const titleOf = (name) => {
	const t = EDITABLE[name]?.title;
	return t ? L(t[0], t[1]) : name;
};

// Plugins som har Language/Prefix i sin config.
const LANG_PLUGINS = ['GamlaSkolanLage', 'GamlaSkolanMvp', 'GamlaSkolanRank', 'GamlaSkolanVapen', 'GamlaSkolanZombieMenu'];
const PREFIX_PLUGINS = ['GamlaSkolanLage', 'GamlaSkolanMvp', 'GamlaSkolanVapen', 'GamlaSkolanAds', 'GamlaSkolanZombieMenu'];

function cfgFile(name) {
	return path.join(paths().cssConfigs, name, `${name}.json`);
}

function stripComments(txt) {
	return txt.replace(/^\uFEFF/, '').replace(/^\s*\/\/.*$/gm, '');
}

function readRaw(name) {
	try {
		return JSON.parse(stripComments(fs.readFileSync(cfgFile(name), 'utf8')));
	} catch {
		return null;
	}
}

function writeRaw(name, obj) {
	const file = cfgFile(name);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.panel-backup`);
	fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

export function readPluginConfig(name) {
	const def = EDITABLE[name];
	if (!def) throw new Error(L('Okänt plugin', 'Unknown plugin'));
	return { ...def.defaults, ...(readRaw(name) || {}) };
}

async function reloadIfRunning(name) {
	if (!isRunning()) return false;
	try {
		await pluginAction('reload', name);
		return true;
	} catch {
		return false; // laddas vid nästa start
	}
}

export async function writePluginConfig(name, data) {
	const def = EDITABLE[name];
	if (!def) throw new Error(L('Okänt plugin', 'Unknown plugin'));
	// Behåll allt som redan står i filen (även nycklar panelen inte känner till).
	const next = { ...def.defaults, ...(readRaw(name) || {}) };
	for (const [k, v] of Object.entries(def.defaults)) {
		if (data[k] === undefined || k === 'ConfigVersion') continue;
		if (Array.isArray(v)) next[k] = (Array.isArray(data[k]) ? data[k] : []).map(String).filter((s) => s.trim());
		else if (typeof v === 'number') next[k] = Number(data[k]);
		else if (typeof v === 'boolean') next[k] = !!data[k];
		else next[k] = String(data[k]);
	}
	writeRaw(name, next);
	log('config', L(`Sparade inställningar för ${titleOf(name)}`, `Saved settings for ${titleOf(name)}`));
	return { saved: next, reloaded: await reloadIfRunning(name) };
}

// Samma chatt-tagg i alla plugins som skriver i chatten.
export async function setChatPrefix(prefix) {
	const p = String(prefix || '').trim().slice(0, 64);
	if (!p) throw new Error(L('Taggen kan inte vara tom', 'The tag cannot be empty'));
	let reloaded = 0;
	for (const name of PREFIX_PLUGINS) {
		const cur = readRaw(name) || { ...EDITABLE[name].defaults };
		if (cur.Prefix === p) continue;
		writeRaw(name, { ...cur, Prefix: p });
		if (await reloadIfRunning(name)) reloaded++;
	}
	log('config', L(`Ny chatt-tagg: ${p}`, `New chat tag: ${p}`));
	return { reloaded };
}

// Panelens språk → pluginens språk. Körs vid start och när språket byts.
// Äldre installationer (från före språkvalet) får behålla sin gamla tagg "[Gamla Skolan]".
export async function syncPluginLanguage() {
	const s = getSettings();
	const lang = s.lang === 'sv' ? 'sv' : 'en';
	const changed = [];
	for (const name of LANG_PLUGINS) {
		const cur = readRaw(name);
		if (!cur) continue; // pluginet skapar sin config själv första gången (svenska väljs vid nästa synk)
		const next = { ...cur };
		if (next.Language !== lang) next.Language = lang;
		if (s.legacyBrand && PREFIX_PLUGINS.includes(name) && !next.Prefix)
			next.Prefix = name === 'GamlaSkolanMvp' ? '{green}[Gamla Skolan]{default}' : '{gold}[Gamla Skolan]{default}';
		if (JSON.stringify(next) === JSON.stringify(cur)) continue;
		writeRaw(name, next);
		changed.push(name);
	}
	for (const name of changed) await reloadIfRunning(name);
	if (changed.length) log('config', L(`Plugin-språk: svenska (${changed.join(', ')})`, `Plugin language: English (${changed.join(', ')})`));
	return changed;
}

// ---------------- Zombie (cs2-zombie-mode) ----------------
// Pluginet läser sin config bara när det laddas, så ändringar gäller när servern startas om.
export const ZOMBIE_FIELDS = [
	{ path: 'infection.roundLimitSeconds', sv: 'Rundtid (sek)', en: 'Round time (s)', min: 120, max: 1800, step: 30, def: 420 },
	{ path: 'infection.hpBase', sv: 'Zombie-HP (bas)', en: 'Zombie HP (base)', min: 100, max: 10000, step: 100, def: 1500 },
	{ path: 'infection.hpPerHuman', sv: 'Extra HP per levande människa', en: 'Extra HP per living human', min: 0, max: 1000, step: 25, def: 100 },
	{ path: 'infection.hpCap', sv: 'Max HP', en: 'Max HP', min: 500, max: 20000, step: 250, def: 6000 },
	{ path: 'infection.firstInfectedMultiplier', sv: 'Första zombien × HP', en: 'First infected × HP', min: 1, max: 6, step: 0.25, def: 2.5 },
	{ path: 'knockback.multiplier', sv: 'Knockback', en: 'Knockback', min: 0, max: 20, step: 0.5, def: 6 },
	{ path: 'infection.bleedDamage', sv: 'Blödning (HP per tick)', en: 'Bleeding (HP per tick)', min: 1, max: 30, step: 1, def: 5 },
	{ path: 'infection.leapCooldown', sv: 'Hopp, nedkylning (sek)', en: 'Leap cooldown (s)', min: 1, max: 30, step: 1, def: 8 },
	{ path: 'infection.minToStart', sv: 'Minst antal spelare för smitta', en: 'Minimum players to infect', min: 1, max: 20, step: 1, def: 2 }
];

function zombieFile() {
	return path.join(paths().cssConfigs, 'ZombieMode', 'ZombieMode.json');
}
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function setPath(o, p, v) {
	const keys = p.split('.');
	let x = o;
	for (const k of keys.slice(0, -1)) x = x[k] ??= {};
	x[keys.at(-1)] = v;
}

export function readZombieConfig() {
	let raw = null;
	try {
		raw = JSON.parse(stripComments(fs.readFileSync(zombieFile(), 'utf8')));
	} catch {
		/* skapas när pluginet laddats första gången */
	}
	return {
		exists: !!raw,
		fields: ZOMBIE_FIELDS.map((f) => ({ ...f, label: L(f.sv, f.en), value: getPath(raw || {}, f.path) ?? f.def }))
	};
}

export function writeZombieConfig(values) {
	const file = zombieFile();
	let raw;
	try {
		raw = JSON.parse(stripComments(fs.readFileSync(file, 'utf8')));
	} catch {
		throw new Error(L('Zombie-configen finns inte än – starta Zombie-läget en gång först.', 'The Zombie config does not exist yet – start Zombie mode once first.'));
	}
	for (const f of ZOMBIE_FIELDS) {
		if (values[f.path] === undefined) continue;
		let v = Number(values[f.path]);
		if (!Number.isFinite(v)) continue;
		v = Math.min(f.max, Math.max(f.min, v));
		if (Number.isInteger(f.step)) v = Math.round(v);
		setPath(raw, f.path, v);
	}
	// Motorns rundtid följer pluginets tidsgräns.
	const minutes = String(Math.ceil(getPath(raw, 'infection.roundLimitSeconds') / 60));
	raw.cvars = { ...(raw.cvars || {}), mp_roundtime: minutes, mp_roundtime_defuse: minutes, mp_roundtime_hostage: minutes };
	fs.copyFileSync(file, `${file}.panel-backup`);
	fs.writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
	log('config', L('Sparade Zombie-inställningar (gäller efter omstart)', 'Saved Zombie settings (applies after restart)'));
	return readZombieConfig();
}

// ---------------- kom igång-kontroll ----------------
export function setupCheck() {
	const P = paths();
	const s = getSettings();
	const has = (p) => {
		try {
			fs.accessSync(p);
			return true;
		} catch {
			return false;
		}
	};
	const inPlugins = (n) => has(path.join(P.cssPlugins, n)) || has(path.join(P.panelDisabled, 'plugins', n));
	const items = [
		{ id: 'cs2', ok: has(P.exe), label: L('CS2 dedikerad server', 'CS2 dedicated server'), hint: L(`Hittar inte ${P.exe}. Kolla "Servermapp" nedan, eller installera servern med SteamCMD (app 730).`, `Cannot find ${P.exe}. Check "Server folder" below, or install the server with SteamCMD (app 730).`) },
		{ id: 'metamod', ok: has(path.join(P.csgo, 'addons', 'metamod')), label: 'Metamod:Source', hint: L('Packa upp Metamod:Source (dev build för CS2) i game\\csgo.', 'Extract Metamod:Source (CS2 dev build) into game\\csgo.') },
		{ id: 'css', ok: has(path.join(P.css, 'api', 'CounterStrikeSharp.API.dll')), label: 'CounterStrikeSharp', hint: L('Packa upp CounterStrikeSharp "with runtime" i game\\csgo.', 'Extract CounterStrikeSharp "with runtime" into game\\csgo.') },
		{ id: 'bridge', ok: inPlugins('GamlaSkolanPanelBridge'), label: L('Panelens bryggplugin', 'Panel bridge plugin'), hint: L('Kopiera addons-mappen från zip-filen till game\\csgo (GamlaSkolanPanelBridge).', 'Copy the addons folder from the zip into game\\csgo (GamlaSkolanPanelBridge).') },
		{ id: 'gslt', ok: !!readGslt(), label: L('GSLT-token', 'GSLT token'), hint: L('Skapa en token på steamcommunity.com/dev/managegameservers (app-id 730) och klistra in den nedan.', 'Create a token at steamcommunity.com/dev/managegameservers (app id 730) and paste it below.') },
		{ id: 'steamcmd', ok: has(s.steamcmd), optional: true, label: 'SteamCMD', hint: L('Behövs bara för att uppdatera CS2 från panelen.', 'Only needed to update CS2 from the panel.') }
	];
	return { ok: items.every((i) => i.ok || i.optional), items };
}

// ---------------- kartor ----------------
export function mapCycle() {
	try {
		return fs
			.readFileSync(path.join(paths().csgo, 'mapcycle_dm.txt'), 'utf8')
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith('//'));
	} catch {
		return [];
	}
}

export async function changeMap(map) {
	const m = String(map).trim();
	let cmd;
	if (/^\d{6,12}$/.test(m)) cmd = `host_workshop_map ${m}`;
	else if (/^[\w\-]+$/.test(m)) cmd = `changelevel ${m}`;
	else throw new Error(L('Ogiltigt kartnamn', 'Invalid map name'));
	log('map', L(`Byter karta till ${m}`, `Changing map to ${m}`));
	return exec(cmd);
}
