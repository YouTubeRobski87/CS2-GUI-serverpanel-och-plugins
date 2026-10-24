// The Forest – dedikerad server som "annat spel" i panelen.
// Panelen startar/stoppar TheForestDedicatedServer.exe, visar status och redigerar config.cfg.
// Steam-token (serverSteamAccount) skickas aldrig ut från panelen, bara om den finns.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { getSettings, L } from './settings.js';
import { log } from './events.js';

const isWin = process.platform === 'win32';
const EXE = 'TheForestDedicatedServer.exe';

export function forestPaths() {
	const root = getSettings().forestRoot || 'C:\\GameServers\\TheForest';
	return {
		root,
		exe: path.join(root, EXE),
		config: path.join(root, 'config', 'config.cfg'),
		saves: path.join(root, 'saves')
	};
}

// Fält som går att ändra från panelen. type: text | number | bool | select | secret
export const FOREST_FIELDS = [
	{ key: 'serverName', sv: 'Servernamn', en: 'Server name', type: 'text' },
	{ key: 'serverPassword', sv: 'Lösenord för att gå med (tomt = inget)', en: 'Join password (empty = none)', type: 'text' },
	{ key: 'serverPlayers', sv: 'Max spelare', en: 'Max players', type: 'number', min: 1, max: 8 },
	{ key: 'difficulty', sv: 'Svårighetsgrad', en: 'Difficulty', type: 'select', options: ['Peaceful', 'Normal', 'Hard', 'HardSurvival'] },
	{ key: 'slot', sv: 'Sparplats', en: 'Save slot', type: 'number', min: 1, max: 5 },
	{ key: 'initType', sv: 'Vid start', en: 'On start', type: 'select', options: ['Continue', 'New'] },
	{ key: 'serverAutoSaveInterval', sv: 'Autosparning (minuter)', en: 'Autosave (minutes)', type: 'number', min: 1, max: 120 },
	{ key: 'allowCheats', sv: 'Tillåt fusk (utvecklarkonsol)', en: 'Allow cheats (developer console)', type: 'bool' },
	{ key: 'veganMode', sv: 'Veganläge (inga fiender)', en: 'Vegan mode (no enemies)', type: 'bool' },
	{ key: 'vegetarianMode', sv: 'Vegetariskt läge (fiender bara på natten)', en: 'Vegetarian mode (enemies only at night)', type: 'bool' },
	{ key: 'treeRegrowMode', sv: 'Träd växer tillbaka', en: 'Trees regrow', type: 'bool' },
	{ key: 'allowBuildingDestruction', sv: 'Fiender kan förstöra byggen', en: 'Enemies can destroy buildings', type: 'bool' },
	{ key: 'serverSteamAccount', sv: 'Steam-token (app 242760)', en: 'Steam token (app 242760)', type: 'secret' }
];

function readCfg() {
	const { config } = forestPaths();
	const lines = fs.existsSync(config) ? fs.readFileSync(config, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/) : [];
	const values = {};
	for (const line of lines) {
		const m = line.match(/^\s*([A-Za-z]+)\s?(.*)$/);
		if (m) values[m[1]] = m[2].trim();
	}
	return { lines, values };
}

function writeCfg(lines) {
	const { config } = forestPaths();
	fs.mkdirSync(path.dirname(config), { recursive: true });
	if (fs.existsSync(config)) fs.copyFileSync(config, `${config}.bak`);
	const out = [...lines];
	while (out.length && out[out.length - 1].trim() === '') out.pop();
	fs.writeFileSync(config, out.join('\r\n') + '\r\n', 'utf8');
}

function ps(script) {
	return new Promise((resolve) => {
		execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 15000 }, (err, stdout) =>
			resolve(err ? null : stdout)
		);
	});
}

async function processInfo() {
	if (!isWin) return null;
	const out = await ps(
		`$p = Get-CimInstance Win32_Process -Filter "Name='${EXE}'" | Select-Object -First 1;` +
			`if ($p) { [pscustomobject]@{ pid=$p.ProcessId; created=$p.CreationDate.ToString('o'); ws=$p.WorkingSetSize } | ConvertTo-Json -Compress }`
	);
	if (!out || !out.trim()) return null;
	try {
		return JSON.parse(out.trim());
	} catch {
		return null;
	}
}

// Senast sparade världen (nyaste __RESUME__ under sparmappen).
function lastSave() {
	const { saves } = forestPaths();
	let best = null;
	const walk = (dir, depth) => {
		if (depth > 4 || !fs.existsSync(dir)) return;
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p, depth + 1);
			else if (e.name === '__RESUME__') {
				const t = fs.statSync(p).mtimeMs;
				if (!best || t > best.t) best = { t, dir: path.relative(saves, dir) };
			}
		}
	};
	try {
		walk(saves, 0);
	} catch {
		/* */
	}
	return best ? { at: new Date(best.t).toISOString(), slot: best.dir } : null;
}

function lanIp() {
	for (const list of Object.values(os.networkInterfaces())) {
		for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254')) return a.address;
	}
	return '127.0.0.1';
}

export async function forestStatus() {
	const P = forestPaths();
	const installed = fs.existsSync(P.exe);
	const { values } = readCfg();
	const proc = installed ? await processInfo() : null;
	const config = {};
	for (const f of FOREST_FIELDS) {
		if (f.type === 'secret') config[f.key] = values[f.key] ? 'set' : '';
		else config[f.key] = values[f.key] ?? '';
	}
	return {
		ok: true,
		installed,
		root: P.root,
		running: !!proc,
		pid: proc?.pid ?? null,
		startedAt: proc?.created ?? null,
		memBytes: proc?.ws ?? 0,
		ports: { steam: values.serverSteamPort, game: values.serverGamePort, query: values.serverQueryPort },
		address: `${lanIp()}:${values.serverQueryPort || '27016'}`,
		fields: FOREST_FIELDS.map((f) => ({ ...f, label: L(f.sv, f.en) })),
		config,
		lastSave: lastSave()
	};
}

export async function forestStart() {
	const P = forestPaths();
	if (!fs.existsSync(P.exe)) throw new Error(L(`Hittar inte ${P.exe} – installera servern först.`, `Cannot find ${P.exe} – install the server first.`));
	if (await processInfo()) throw new Error(L('The Forest-servern körs redan.', 'The Forest server is already running.'));
	// Loggen skrivs till fil i stället för konsolfönstret. Servern spammar annars
	// "RenderTexture.Create failed" (ofarligt i -nographics) i stor mängd. Filen skrivs över vid varje start.
	const logFile = path.join(P.root, 'server.log');
	const args = `-batchmode -nographics -nosteamclient -logFile "${logFile}" -configfilepath "${P.config}" -savefolderpath "${P.saves}"`;
	const child = spawn('cmd.exe', [`/c start "The Forest - Gamla Skolan" /MIN /D "${P.root}" ${EXE} ${args}`], {
		windowsVerbatimArguments: true,
		detached: true,
		stdio: 'ignore',
		windowsHide: false
	});
	child.unref();
	log('server', L('Startar The Forest-servern…', 'Starting The Forest server…'));
	return { ok: true };
}

export async function forestStop() {
	const proc = await processInfo();
	if (!proc) return { ok: true };
	await ps(`Stop-Process -Id ${Number(proc.pid)} -Force -ErrorAction SilentlyContinue`);
	log('ok', L('The Forest-servern är stoppad', 'The Forest server stopped'));
	return { ok: true };
}

export async function forestRestart() {
	await forestStop();
	await new Promise((r) => setTimeout(r, 2000));
	return forestStart();
}

export function forestSaveConfig(data) {
	const { lines, values } = readCfg();
	const next = [...lines];
	const set = (key, val) => {
		const i = next.findIndex((l) => new RegExp(`^\\s*${key}(\\s|$)`).test(l));
		const line = `${key} ${val}`.trimEnd();
		if (i >= 0) next[i] = line;
		else next.splice(next.length && next[next.length - 1] === '' ? next.length - 1 : next.length, 0, line);
	};
	for (const f of FOREST_FIELDS) {
		if (data[f.key] === undefined) continue;
		let v = data[f.key];
		if ((f.type === 'select' || f.type === 'number') && (v === '' || v === null)) continue; // tomt fält = lämna orört
		if (f.type === 'secret') {
			v = String(v).trim();
			if (!v) continue; // tomt = behåll nuvarande token
			if (!/^[A-Za-z0-9]{16,64}$/.test(v)) throw new Error(L('Token ser inte rätt ut', 'The token does not look right'));
		} else if (f.type === 'bool') v = v === true || v === 'on' ? 'on' : 'off';
		else if (f.type === 'number') {
			const n = Math.round(Number(v));
			if (!Number.isFinite(n) || n < f.min || n > f.max) throw new Error(L(`${f.sv}: ${f.min}–${f.max}`, `${f.en}: ${f.min}–${f.max}`));
			v = String(n);
		} else if (f.type === 'select') {
			if (!f.options.includes(String(v))) throw new Error(L(`Ogiltigt värde för ${f.sv}`, `Invalid value for ${f.en}`));
		} else v = String(v).replace(/[\r\n]/g, ' ').trim().slice(0, 64);
		if (values[f.key] !== v) set(f.key, v);
	}
	writeCfg(next);
	log('config', L('Sparade inställningar för The Forest', 'Saved settings for The Forest'));
	return { ok: true };
}
