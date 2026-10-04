// Spelare, plugins, topplista och plugin-inställningar.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './settings.js';
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
	if (!Number.isInteger(n) || n < 0 || n > 64) throw new Error('Ogiltig spelare');
	let out;
	if (action === 'kick') out = await send({ type: 'kick', slot: n, arg: cleanArg(extra.reason || 'Kickad av admin') });
	else if (action === 'slay') out = await send({ type: 'slay', slot: n });
	else if (action === 'team') out = await send({ type: 'team', slot: n, arg: ['t', 'ct', 'spec'].includes(extra.team) ? extra.team : 'spec' });
	else if (action === 'ban') {
		const minutes = Math.max(0, Math.min(525600, Number(extra.minutes) || 0));
		out = await exec(`css_ban #${Number(extra.userid)} ${minutes} "${cleanArg(extra.reason || 'Bannad av admin')}"`);
	} else throw new Error('Okänd åtgärd');
	log('player', `${action} → spelare ${n}`);
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
	if (!['load', 'unload', 'reload'].includes(action)) throw new Error('Okänd åtgärd');
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
		title: 'Servernamn',
		defaults: { Hostname: '[Gamla Skolan] Multimode – Retakes • DM • 1v1', ConfigVersion: 1 }
	},
	GamlaSkolanAds: {
		title: 'Tips i chatten',
		defaults: {
			IntervalSeconds: 120,
			Prefix: '{green}[Gamla Skolan]{default}',
			Messages: [],
			ConfigVersion: 1
		}
	},
	GamlaSkolanMvp: {
		title: 'MVP & killgräns',
		defaults: { KillLimit: 100, CelebrationSeconds: 10, MapCycleFile: 'mapcycle_dm.txt', ConfigVersion: 1 }
	},
	GamlaSkolanRank: {
		title: 'Rank',
		defaults: { PointsPerKill: 10, PointsLostPerDeath: 5, MinimumHumanPlayers: 1, TopCount: 10, ShowPointMessages: true, ConfigVersion: 1 }
	}
};

function cfgFile(name) {
	return path.join(paths().cssConfigs, name, `${name}.json`);
}

function stripComments(txt) {
	return txt.replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, '');
}

export function readPluginConfig(name) {
	const def = EDITABLE[name];
	if (!def) throw new Error('Okänt plugin');
	try {
		return { ...def.defaults, ...JSON.parse(stripComments(fs.readFileSync(cfgFile(name), 'utf8'))) };
	} catch {
		return { ...def.defaults };
	}
}

export async function writePluginConfig(name, data) {
	const def = EDITABLE[name];
	if (!def) throw new Error('Okänt plugin');
	const next = { ...def.defaults };
	for (const [k, v] of Object.entries(def.defaults)) {
		if (data[k] === undefined) continue;
		if (Array.isArray(v)) next[k] = (Array.isArray(data[k]) ? data[k] : []).map(String).filter((s) => s.trim());
		else if (typeof v === 'number') next[k] = Number(data[k]);
		else if (typeof v === 'boolean') next[k] = !!data[k];
		else next[k] = String(data[k]);
	}
	const file = cfgFile(name);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.panel-backup`);
	fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
	log('config', `Sparade inställningar för ${def.title}`);
	let reloaded = false;
	if (isRunning()) {
		try {
			await pluginAction('reload', name);
			reloaded = true;
		} catch {
			/* laddas vid nästa start */
		}
	}
	return { saved: next, reloaded };
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
	else throw new Error('Ogiltigt kartnamn');
	log('map', `Byter karta till ${m}`);
	return exec(cmd);
}
