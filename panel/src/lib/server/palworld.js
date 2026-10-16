// Palworld – dedikerad server som "annat spel" i panelen.
// Styr PalServer.exe, läser/skriver PalWorldSettings.ini och pratar med serverns REST API
// (som panelen slår på själv med ett slumpat adminlösenord).
// Bakgrundsjobb: vakthund (startar om vid krasch), schemalagda omstarter, automatisk backup,
// koll efter nya Palworld-versioner och Discord-notiser.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { getSettings, saveSettings, L } from './settings.js';
import { log } from './events.js';
import { PAL_FIELDS, PAL_GROUPS, FIELD_BY_KEY } from './palworld-fields.js';

const isWin = process.platform === 'win32';
const APP_ID = '2394010';

// ------------------------------------------------------------------ inställningar för Palworld i panelen
export const PAL_DEFAULTS = {
	root: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\PalServer',
	launch: { port: '', players: '', publicLobby: true, perf: true, extra: '' },
	autoStart: false, // starta Palworld när panelen startar
	autoRestart: true, // starta om om servern kraschar
	stopCountdown: 10, // sekunder från "stäng" till att servern går ner
	schedule: { enabled: false, times: ['06:00'], warnMinutes: 5 },
	backup: { dir: 'C:\\GameServers\\PalworldBackups', auto: false, everyHours: 6, keep: 20, onStop: true },
	update: { auto: false },
	webhook: { url: '', start: true, stop: true, crash: true, restart: true, update: true, backup: false }
};

export function palCfg() {
	const s = getSettings().palworld || {};
	const d = PAL_DEFAULTS;
	return {
		...d,
		...s,
		launch: { ...d.launch, ...(s.launch || {}) },
		schedule: { ...d.schedule, ...(s.schedule || {}) },
		backup: { ...d.backup, ...(s.backup || {}) },
		update: { ...d.update, ...(s.update || {}) },
		webhook: { ...d.webhook, ...(s.webhook || {}) }
	};
}

function savePalCfg(next) {
	saveSettings({ ...getSettings(), palworld: next });
}

export function palPaths() {
	const root = palCfg().root;
	const saved = path.join(root, 'Pal', 'Saved');
	const win64 = path.join(root, 'Pal', 'Binaries', 'Win64');
	return {
		root,
		exe: path.join(root, 'PalServer.exe'),
		ini: path.join(saved, 'Config', 'WindowsServer', 'PalWorldSettings.ini'),
		defaultIni: path.join(root, 'DefaultPalWorldSettings.ini'),
		logs: path.join(saved, 'Logs'),
		saves: path.join(saved, 'SaveGames'),
		banlist: path.join(saved, 'SaveGames', 'banlist.txt'),
		win64,
		ue4ss: fs.existsSync(path.join(win64, 'ue4ss')) ? path.join(win64, 'ue4ss') : win64,
		paks: path.join(root, 'Pal', 'Content', 'Paks'),
		modSettings: path.join(root, 'Mods', 'PalModSettings.ini'),
		manifests: [path.join(root, 'steamapps', `appmanifest_${APP_ID}.acf`), path.resolve(root, '..', '..', `appmanifest_${APP_ID}.acf`)]
	};
}

// ------------------------------------------------------------------ PalWorldSettings.ini
// Allt ligger på en rad: OptionSettings=(Nyckel=Värde,Nyckel="text",Lista=(A,B),...)
function parseIni(text) {
	const start = text.indexOf('OptionSettings=(');
	if (start < 0) throw new Error(L('PalWorldSettings.ini saknar OptionSettings', 'PalWorldSettings.ini has no OptionSettings'));
	let i = start + 'OptionSettings=('.length;
	const entries = [];
	let depth = 1;
	let quote = false;
	let tok = '';
	for (; i < text.length; i++) {
		const c = text[i];
		if (c === '"') quote = !quote;
		if (!quote) {
			if (c === '(') depth++;
			else if (c === ')') {
				depth--;
				if (depth === 0) break;
			} else if (c === ',' && depth === 1) {
				if (tok.trim()) entries.push(tok);
				tok = '';
				continue;
			}
		}
		tok += c;
	}
	if (depth !== 0 || quote) throw new Error(L('PalWorldSettings.ini: parenteser eller citattecken går inte jämnt ut', 'PalWorldSettings.ini: unbalanced parentheses or quotes'));
	if (tok.trim()) entries.push(tok);
	return {
		pre: text.slice(0, start),
		post: text.slice(i + 1),
		entries: entries.map((e) => {
			const eq = e.indexOf('=');
			return eq < 0 ? [e.trim(), ''] : [e.slice(0, eq).trim(), e.slice(eq + 1)];
		})
	};
}

function serializeIni(p) {
	return `${p.pre}OptionSettings=(${p.entries.map(([k, v]) => `${k}=${v}`).join(',')})${p.post}`;
}

function defaultIniText() {
	const P = palPaths();
	if (!fs.existsSync(P.defaultIni)) return '[/Script/Pal.PalGameWorldSettings]\r\nOptionSettings=()\r\n';
	const lines = fs.readFileSync(P.defaultIni, 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith(';'));
	const from = lines.findIndex((l) => l.startsWith('['));
	return lines.slice(from < 0 ? 0 : from).join('\r\n');
}

function readIniText() {
	const P = palPaths();
	if (!fs.existsSync(P.ini) || fs.statSync(P.ini).size < 100) {
		// Tom fil = standardvärden. Utgå från Default-filen så att det finns något att redigera.
		fs.mkdirSync(path.dirname(P.ini), { recursive: true });
		fs.writeFileSync(P.ini, defaultIniText());
	}
	return fs.readFileSync(P.ini, 'utf8').replace(/^\uFEFF/, '');
}

function readIni() {
	return parseIni(readIniText());
}

function writeIni(p) {
	const P = palPaths();
	const text = serializeIni(p);
	if (fs.existsSync(P.ini)) fs.copyFileSync(P.ini, `${P.ini}.bak`);
	fs.writeFileSync(P.ini, text);
	// Palworld skriver över PalWorldSettings.ini med sina gamla värden när servern stängs.
	// Sparas något medan den är igång läggs det tillbaka efter att den har stängts (se applyPending).
	if (state.running) {
		try {
			fs.mkdirSync(path.dirname(PENDING_FILE), { recursive: true });
			fs.writeFileSync(PENDING_FILE, text);
		} catch {
			/* */
		}
	}
}

const PENDING_FILE = path.join(process.env.GSP_DATA || path.resolve(process.cwd(), 'panel-data'), 'palworld-pending.ini');

// Lägger tillbaka inställningar som sparades medan servern var igång. Körs när servern har stängts och före start.
function applyPending() {
	if (!fs.existsSync(PENDING_FILE)) return false;
	try {
		const text = fs.readFileSync(PENDING_FILE, 'utf8');
		parseIni(text); // trasig fil ska aldrig skrivas
		const P = palPaths();
		if (fs.existsSync(P.ini)) fs.copyFileSync(P.ini, `${P.ini}.bak`);
		fs.writeFileSync(P.ini, text);
		fs.rmSync(PENDING_FILE, { force: true });
		log('config', L('Palworld: lade tillbaka inställningarna som sparades medan servern var igång', 'Palworld: re-applied settings saved while the server was running'));
		return true;
	} catch (e) {
		log('error', `Palworld: ${e.message}`);
		return false;
	}
}

const unq = (v) => (/^".*"$/s.test(v) ? v.slice(1, -1) : v);
function getVal(p, key) {
	const e = p.entries.find(([k]) => k === key);
	return e ? unq(e[1]) : null;
}
function setRaw(p, key, raw) {
	const e = p.entries.find(([k]) => k === key);
	if (e) e[1] = raw;
	else p.entries.push([key, raw]);
}

function kindOf(key, raw) {
	const f = FIELD_BY_KEY[key];
	if (f?.type) return f.type;
	if (f?.options) return 'select';
	if (/^(True|False)$/.test(raw)) return 'bool';
	if (/^-?\d+\.\d+$/.test(raw)) return 'float';
	if (/^-?\d+$/.test(raw)) return 'int';
	if (/^".*"$/s.test(raw)) return 'text';
	if (/^\(.*\)$/s.test(raw)) return 'list';
	return 'raw';
}

// Panelen behöver REST API:t och ett adminlösenord för att kunna styra servern.
function ensureApi() {
	const p = readIni();
	let changed = false;
	if (getVal(p, 'RESTAPIEnabled') !== 'True') {
		setRaw(p, 'RESTAPIEnabled', 'True');
		changed = true;
	}
	if (!getVal(p, 'AdminPassword')) {
		setRaw(p, 'AdminPassword', `"${crypto.randomBytes(9).toString('base64url')}"`);
		changed = true;
	}
	if (changed) {
		writeIni(p);
		log('ok', L('Palworld: slog på serverns REST API (behövs för panelen)', 'Palworld: enabled the server REST API (needed by the panel)'));
	}
}

export function palSettings() {
	const p = readIni();
	const known = new Set(PAL_FIELDS.map((f) => f.key));
	const present = new Map(p.entries);
	const fields = [];
	for (const f of PAL_FIELDS) {
		if (!present.has(f.key)) continue; // finns inte i den här versionen av spelet
		fields.push(describe(f.key, present.get(f.key), f));
	}
	for (const [k, raw] of p.entries) if (!known.has(k)) fields.push(describe(k, raw, { key: k, group: 'other', sv: k, en: k }));
	return { groups: PAL_GROUPS.map(([id, sv, en]) => ({ id, label: L(sv, en) })), fields };
}

function describe(key, raw, f) {
	const type = kindOf(key, raw);
	let value = unq(raw);
	if (type === 'list') value = raw.replace(/^\(|\)$/g, '').split(',').map((x) => x.trim()).filter(Boolean);
	if (type === 'float') value = String(Number(raw));
	if (f.secret) value = '';
	return {
		key,
		group: f.group,
		label: L(f.sv, f.en),
		hint: f.hint ? L(...f.hint) : null,
		type,
		secret: !!f.secret,
		isSet: f.secret ? !!unq(raw) : undefined,
		options: f.options?.map(([v, sv, en]) => ({ value: v, label: L(sv, en) })) ?? null,
		min: f.min,
		max: f.max,
		step: f.step,
		value
	};
}

export function palSaveSettings(values) {
	const p = readIni();
	const present = new Map(p.entries);
	let n = 0;
	for (const [key, v] of Object.entries(values || {})) {
		if (!present.has(key)) continue;
		const f = FIELD_BY_KEY[key] || { sv: key, en: key };
		const type = kindOf(key, present.get(key));
		const name = L(f.sv, f.en);
		let raw;
		if (f.secret) {
			const s = String(v ?? '').trim();
			if (!s) continue; // tomt = behåll
			if (!/^[\x21-\x7e]{4,64}$/.test(s) || s.includes('"')) throw new Error(L(`${name}: 4–64 tecken, inga mellanslag eller "`, `${name}: 4–64 characters, no spaces or "`));
			raw = `"${s}"`;
		} else if (type === 'bool') raw = v === true || v === 'True' ? 'True' : 'False';
		else if (type === 'float' || type === 'int') {
			const num = Number(String(v).replace(',', '.'));
			if (String(v).trim() === '' || !Number.isFinite(num)) throw new Error(L(`${name} måste vara ett tal`, `${name} must be a number`));
			if (f.min !== undefined && num < f.min) throw new Error(L(`${name}: minst ${f.min}`, `${name}: at least ${f.min}`));
			if (f.max !== undefined && num > f.max) throw new Error(L(`${name}: högst ${f.max}`, `${name}: at most ${f.max}`));
			raw = type === 'float' ? num.toFixed(6) : String(Math.round(num));
		} else if (type === 'select') {
			if (f.options && !f.options.some((o) => o[0] === v)) throw new Error(L(`Ogiltigt val för ${name}`, `Invalid value for ${name}`));
			raw = String(v);
		} else if (type === 'list') {
			const list = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter((x) => /^[\w.\-]+$/.test(x));
			raw = `(${list.join(',')})`;
		} else if (type === 'text') raw = `"${String(v ?? '').replace(/["\r\n]/g, '').slice(0, 300)}"`;
		else {
			const s = String(v ?? '').replace(/[\r\n"]/g, '').trim();
			let d = 0;
			for (const c of s) {
				if (c === '(') d++;
				if (c === ')') d--;
				if (d < 0) break;
			}
			if (d !== 0) throw new Error(L(`${name}: parenteserna går inte jämnt ut`, `${name}: unbalanced parentheses`));
			if (/,/.test(s) && !/^\(.*\)$/.test(s)) throw new Error(L(`${name}: en lista skrivs (A,B)`, `${name}: write a list as (A,B)`));
			raw = s;
		}
		if (present.get(key) !== raw) {
			setRaw(p, key, raw);
			n++;
		}
	}
	if (getVal(p, 'RESTAPIEnabled') !== 'True') {
		setRaw(p, 'RESTAPIEnabled', 'True');
		log('warn', L('Palworld: REST API måste vara på för att panelen ska fungera – lät det vara på', 'Palworld: the REST API must stay on for the panel – kept it on'));
	}
	writeIni(p);
	log('config', L(`Palworld: sparade ${n} ändrade inställningar`, `Palworld: saved ${n} changed settings`));
	return { ok: true, changed: n, running: state.running };
}

export function palRawIni() {
	return { ok: true, text: readIniText(), path: palPaths().ini };
}

export function palSaveRawIni(text) {
	const t = String(text || '');
	const p = parseIni(t); // kastar fel om formatet är trasigt
	if (!t.includes('[/Script/Pal.PalGameWorldSettings]')) throw new Error(L('Rubriken [/Script/Pal.PalGameWorldSettings] saknas', 'The [/Script/Pal.PalGameWorldSettings] header is missing'));
	writeIni(p);
	ensureApi();
	log('config', L('Palworld: sparade PalWorldSettings.ini (hela filen)', 'Palworld: saved PalWorldSettings.ini (whole file)'));
	return { ok: true };
}

export function palResetSetting(key) {
	const def = parseIni(defaultIniText());
	const raw = def.entries.find(([k]) => k === key)?.[1];
	if (raw === undefined) throw new Error(L('Hittar inget standardvärde', 'No default value found'));
	if (FIELD_BY_KEY[key]?.secret) throw new Error(L('Adminlösenordet kan inte nollställas här', 'The admin password cannot be reset here'));
	const p = readIni();
	setRaw(p, key, raw);
	writeIni(p);
	return { ok: true };
}

// ------------------------------------------------------------------ REST API mot servern
function pal(method, endpoint, body, timeout = 5000) {
	const p = readIni();
	const port = Number(getVal(p, 'RESTAPIPort')) || 8212;
	const pass = getVal(p, 'AdminPassword') || '';
	return new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : null;
		const req = http.request(
			{
				host: '127.0.0.1',
				port,
				path: `/v1/api/${endpoint}`,
				method,
				timeout,
				headers: {
					Authorization: 'Basic ' + Buffer.from(`admin:${pass}`).toString('base64'),
					Accept: 'application/json',
					...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
				}
			},
			(res) => {
				let txt = '';
				res.on('data', (c) => (txt += c));
				res.on('end', () => {
					if (res.statusCode === 401) return reject(new Error(L('Servern nekade adminlösenordet – starta om servern så läses det nya in', 'The server rejected the admin password – restart it to load the new one')));
					if (res.statusCode >= 400) return reject(new Error(L(`Servern svarade ${res.statusCode}`, `The server answered ${res.statusCode}`)));
					try {
						resolve(txt ? JSON.parse(txt) : {});
					} catch {
						resolve({ text: txt });
					}
				});
			}
		);
		req.on('timeout', () => req.destroy(new Error(L('Servern svarar inte', 'The server is not responding'))));
		req.on('error', () => reject(new Error(L('Ingen kontakt med Palworld-servern (REST API)', 'No contact with the Palworld server (REST API)'))));
		if (data) req.write(data);
		req.end();
	});
}

// ------------------------------------------------------------------ processen
const state = {
	running: false,
	pid: null,
	startedAt: null,
	memBytes: 0,
	busy: null, // starting | stopping | updating | backup | restoring
	expect: false, // panelen tror att servern ska vara igång (för vakthunden)
	apiOk: false,
	lastProbe: 0,
	crashes: [],
	restartAt: null, // nästa schemalagda omstart (ms)
	notice: null // pågående nedräkning, visas i panelen
};
const game = { info: null, metrics: null, players: [], updated: 0 };

function ps(script, timeout = 15000) {
	return new Promise((resolve) => {
		execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
			resolve(err ? null : stdout)
		);
	});
}

async function probe(force = false) {
	if (!isWin) return state;
	if (!force && Date.now() - state.lastProbe < 2000) return state;
	state.lastProbe = Date.now();
	const out = await ps(
		`$p = Get-CimInstance Win32_Process -Filter "Name like 'PalServer-Win64-Shipping%'" | Sort-Object WorkingSetSize -Descending | Select-Object -First 1;` +
			`if ($p) { [pscustomobject]@{ pid=$p.ProcessId; created=$p.CreationDate.ToString('o'); ws=$p.WorkingSetSize } | ConvertTo-Json -Compress }`
	);
	if (out === null) return state; // PowerShell strulade – behåll förra läget
	let proc = null;
	try {
		proc = out.trim() ? JSON.parse(out.trim()) : null;
	} catch {
		/* */
	}
	const was = state.running;
	state.running = !!proc;
	if (was && !state.running) applyPending();
	state.pid = proc?.pid ?? null;
	state.startedAt = proc?.created ?? null;
	state.memBytes = proc?.ws ?? 0;
	if (!state.running) {
		state.apiOk = false;
		game.players = [];
	}
	return state;
}

async function refreshGame() {
	if (!state.running) return;
	try {
		game.metrics = await pal('GET', 'metrics');
		const p = await pal('GET', 'players');
		game.players = (p.players || []).map((x) => ({
			name: x.name,
			accountName: x.accountName,
			playerId: x.playerId,
			userId: x.userId,
			ip: x.ip,
			ping: Math.round(x.ping || 0),
			level: x.level,
			x: x.location_x,
			y: x.location_y,
			buildings: x.building_count
		}));
		if (!game.info) game.info = await pal('GET', 'info');
		game.updated = Date.now();
		state.apiOk = true;
	} catch {
		state.apiOk = false;
	}
}

function launchArgs() {
	const c = palCfg().launch;
	const a = [];
	if (c.port) a.push(`-port=${Number(c.port)}`);
	if (c.players) a.push(`-players=${Number(c.players)}`);
	if (c.publicLobby) a.push('-publiclobby');
	if (c.perf) a.push('-useperfthreads', '-NoAsyncLoadingThread', '-UseMultithreadForDS');
	for (const x of String(c.extra || '').split(/\s+/).filter(Boolean)) if (/^-[\w=.:\-]+$/.test(x)) a.push(x);
	return a;
}

function waitFor(cond, maxMs, every = 2000) {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const tick = async () => {
			if (await cond()) return resolve(true);
			if (Date.now() - t0 > maxMs) return resolve(false);
			setTimeout(tick, every);
		};
		tick();
	});
}

export async function palStart({ reason } = {}) {
	const P = palPaths();
	await probe(true);
	if (state.running) throw new Error(L('Palworld-servern körs redan.', 'The Palworld server is already running.'));
	if (state.busy) throw new Error(L('Vänta, panelen håller på med Palworld just nu.', 'Wait, the panel is busy with Palworld right now.'));
	if (!fs.existsSync(P.exe)) throw new Error(L(`Hittar inte ${P.exe}`, `Cannot find ${P.exe}`));
	applyPending();
	ensureApi();
	const child = spawn(P.exe, launchArgs(), { cwd: P.root, detached: true, stdio: 'ignore', windowsHide: false });
	child.unref();
	state.busy = 'starting';
	state.expect = true;
	game.info = null;
	log('server', reason || L('Palworld: startar servern…', 'Palworld: starting the server…'));
	(async () => {
		const up = await waitFor(async () => (await probe(true)).running, 45000, 3000);
		if (!up) {
			state.busy = null;
			state.expect = false;
			log('error', L('Palworld: servern startade inte', 'Palworld: the server did not start'));
			notify('crash', L('Palworld-servern startade inte', 'The Palworld server did not start'));
			return;
		}
		await waitFor(async () => (await refreshGame(), state.apiOk || !state.running), 300000, 4000);
		if (state.busy === 'starting') state.busy = null;
		if (state.running) {
			log('ok', L('Palworld: servern är igång', 'Palworld: the server is up'));
			notify('start', L('🟢 Palworld-servern är igång', '🟢 The Palworld server is up'));
		}
	})().catch(() => (state.busy = null));
	return { ok: true };
}

// Snäll stopp: spara, varna spelarna, stäng. Tvingar efter en stund om den inte går ner.
async function stopInternal({ countdown, message, kind = 'stop', backup = true } = {}) {
	await probe(true);
	if (!state.running) {
		state.expect = false;
		return true;
	}
	const cfg = palCfg();
	const wait = Math.max(1, Math.min(600, Number(countdown ?? cfg.stopCountdown) || 10));
	state.busy = 'stopping';
	state.expect = false;
	log('server', L(`Palworld: sparar och stänger om ${wait} s…`, `Palworld: saving and shutting down in ${wait} s…`));
	try {
		await pal('POST', 'save', null, 30000);
	} catch {
		/* */
	}
	try {
		await pal('POST', 'shutdown', { waittime: wait, message: message || L(`Servern stängs om ${wait} sekunder`, `Server shutting down in ${wait} seconds`) });
	} catch {
		/* svarar inte API:t tar vi till taskkill nedan */
	}
	let down = await waitFor(async () => !(await probe(true)).running, (wait + 60) * 1000, 2000);
	if (!down && state.pid) {
		log('error', L('Palworld: servern stängdes inte – tvingar stopp', 'Palworld: the server did not stop – forcing it'));
		await new Promise((r) => execFile('taskkill', ['/PID', String(state.pid), '/T', '/F'], { windowsHide: true }, () => r()));
		down = await waitFor(async () => !(await probe(true)).running, 15000, 1500);
	}
	state.busy = null;
	if (down) {
		log('server', L('Palworld: servern är stoppad', 'Palworld: the server is stopped'));
		if (kind === 'stop') notify('stop', L('🔴 Palworld-servern är stoppad', '🔴 The Palworld server is stopped'));
		if (backup && cfg.backup.onStop) await makeBackup('stopp').catch((e) => log('error', `Palworld backup: ${e.message}`));
	}
	return down;
}

export async function palStop(body = {}) {
	if (state.busy === 'stopping') throw new Error(L('Servern håller redan på att stängas.', 'The server is already stopping.'));
	stopInternal({ countdown: body.countdown, message: body.message }).catch((e) => log('error', e.message));
	return { ok: true };
}

export async function palKill() {
	await probe(true);
	state.expect = false;
	if (!state.pid) return { ok: true };
	await new Promise((r) => execFile('taskkill', ['/PID', String(state.pid), '/T', '/F'], { windowsHide: true }, () => r()));
	state.busy = null;
	log('error', L('Palworld: servern tvingades ner (utan att spara)', 'Palworld: the server was killed (without saving)'));
	return { ok: true };
}

async function restartInternal(opts = {}) {
	const down = await stopInternal({ ...opts, kind: 'restart', backup: opts.backup ?? true });
	if (!down) return;
	await new Promise((r) => setTimeout(r, 3000));
	await palStart({ reason: L('Palworld: startar om servern…', 'Palworld: restarting the server…') });
	notify('restart', L('🔄 Palworld-servern startas om', '🔄 The Palworld server is restarting'));
}

export async function palRestart(body = {}) {
	if (state.busy) throw new Error(L('Vänta, panelen håller på med Palworld just nu.', 'Wait, the panel is busy with Palworld right now.'));
	restartInternal({ countdown: body.countdown, message: body.message }).catch((e) => log('error', e.message));
	return { ok: true };
}

// ------------------------------------------------------------------ spelare och kommandon
export async function palSave() {
	await pal('POST', 'save', null, 30000);
	log('ok', L('Palworld: världen sparad', 'Palworld: world saved'));
	return { ok: true };
}

export async function palAnnounce(message) {
	const m = String(message || '').replace(/[\r\n]/g, ' ').trim().slice(0, 200);
	if (!m) throw new Error(L('Tomt meddelande', 'Empty message'));
	await pal('POST', 'announce', { message: m });
	log('cmd', `Palworld: ${m}`);
	return { ok: true };
}

const idOk = (s) => /^[A-Za-z0-9_\-]{3,80}$/.test(String(s || ''));

export async function palPlayer(body = {}) {
	if (!idOk(body.userId)) throw new Error(L('Ogiltigt spelar-id', 'Invalid player id'));
	const msg = String(body.reason || '').replace(/[\r\n]/g, ' ').slice(0, 120);
	const who = body.name || body.userId;
	if (body.action === 'kick') {
		await pal('POST', 'kick', { userid: body.userId, message: msg || L('Kickad av admin', 'Kicked by admin') });
		log('cmd', L(`Palworld: kickade ${who}`, `Palworld: kicked ${who}`));
	} else if (body.action === 'ban') {
		await pal('POST', 'ban', { userid: body.userId, message: msg || L('Bannad av admin', 'Banned by admin') });
		log('cmd', L(`Palworld: bannade ${who}`, `Palworld: banned ${who}`));
	} else if (body.action === 'unban') {
		await probe(true);
		if (state.running && state.apiOk) await pal('POST', 'unban', { userid: body.userId });
		const P = palPaths();
		if (fs.existsSync(P.banlist)) {
			const lines = fs.readFileSync(P.banlist, 'utf8').split(/\r?\n/);
			fs.writeFileSync(P.banlist, lines.filter((l) => l.trim() && l.trim() !== body.userId).join('\r\n') + '\r\n');
		}
		log('cmd', L(`Palworld: tog bort bannet för ${who}`, `Palworld: unbanned ${who}`));
	} else throw new Error(L('Okänd åtgärd', 'Unknown action'));
	setTimeout(refreshGame, 1000);
	return { ok: true };
}

function banlist() {
	const P = palPaths();
	try {
		return fs.readFileSync(P.banlist, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	} catch {
		return [];
	}
}

// ------------------------------------------------------------------ backup
function stamp(d = new Date()) {
	const z = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}

function dirSize(dir) {
	let n = 0;
	try {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
		}
	} catch {
		/* */
	}
	return n;
}

const sizeCache = new Map();
export function palBackups() {
	const dir = palCfg().backup.dir;
	if (!fs.existsSync(dir)) return { ok: true, dir, list: [] };
	const list = fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/.test(e.name))
		.map((e) => {
			const p = path.join(dir, e.name);
			if (!sizeCache.has(p)) sizeCache.set(p, dirSize(p));
			const [, label = ''] = e.name.match(/^\S{19}(?:-(.+))?$/) || [];
			return { name: e.name, label, at: fs.statSync(p).mtime.toISOString(), bytes: sizeCache.get(p) };
		})
		.sort((a, b) => b.name.localeCompare(a.name));
	return { ok: true, dir, list };
}

async function makeBackup(label = 'manuell') {
	const P = palPaths();
	const cfg = palCfg();
	if (!fs.existsSync(P.saves)) throw new Error(L('Hittar ingen sparad värld ännu', 'No saved world found yet'));
	await probe(true);
	if (state.running && state.apiOk) {
		try {
			await pal('POST', 'save', null, 30000);
			await new Promise((r) => setTimeout(r, 3000));
		} catch {
			/* sparar ändå det som finns på disk */
		}
	}
	const safe = String(label).replace(/[^\wåäöÅÄÖ\-]/g, '').slice(0, 30);
	const name = `${stamp()}${safe ? '-' + safe : ''}`;
	const dest = path.join(cfg.backup.dir, name);
	fs.mkdirSync(cfg.backup.dir, { recursive: true });
	fs.cpSync(P.saves, dest, { recursive: true, force: true });
	log('ok', L(`Palworld: backup ${name}`, `Palworld: backup ${name}`));
	notify('backup', L(`💾 Palworld-backup klar: ${name}`, `💾 Palworld backup done: ${name}`));
	prune();
	return name;
}

function prune() {
	const { backup } = palCfg();
	const keep = Math.max(1, Number(backup.keep) || 20);
	// Bara automatiska backuper rensas – de du gör själv blir kvar.
	const auto = palBackups().list.filter((b) => b.label === 'auto' || b.label === 'stopp');
	for (const b of auto.slice(keep)) {
		const p = path.join(backup.dir, b.name);
		fs.rmSync(p, { recursive: true, force: true });
		sizeCache.delete(p);
	}
}

export async function palBackup(label) {
	if (state.busy === 'restoring') throw new Error(L('Vänta tills återställningen är klar', 'Wait until the restore is done'));
	return { ok: true, name: await makeBackup(label || L('manuell', 'manual')) };
}

const okName = (n) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-[\wåäöÅÄÖ\-]+)?$/.test(String(n || ''));

export async function palRestore(name) {
	if (!okName(name)) throw new Error(L('Ogiltigt namn', 'Invalid name'));
	const P = palPaths();
	const src = path.join(palCfg().backup.dir, name);
	if (!fs.existsSync(src)) throw new Error(L('Backupen finns inte', 'The backup does not exist'));
	await probe(true);
	if (state.running) throw new Error(L('Stoppa servern innan du återställer en backup', 'Stop the server before restoring a backup'));
	state.busy = 'restoring';
	try {
		if (fs.existsSync(P.saves)) await makeBackup(L('fore-aterstallning', 'before-restore'));
		fs.rmSync(P.saves, { recursive: true, force: true });
		fs.cpSync(src, P.saves, { recursive: true, force: true });
		log('ok', L(`Palworld: återställde ${name}`, `Palworld: restored ${name}`));
	} finally {
		state.busy = null;
	}
	return { ok: true };
}

export function palDeleteBackup(name) {
	if (!okName(name)) throw new Error(L('Ogiltigt namn', 'Invalid name'));
	const p = path.join(palCfg().backup.dir, name);
	fs.rmSync(p, { recursive: true, force: true });
	sizeCache.delete(p);
	return { ok: true };
}

// ------------------------------------------------------------------ mods
function readText(p) {
	try {
		return fs.readFileSync(p, 'utf8');
	} catch {
		return null;
	}
}

export function palMods() {
	const P = palPaths();
	const modsDir = path.join(P.ue4ss, 'Mods');
	const ue4ssInstalled = fs.existsSync(path.join(P.ue4ss, 'UE4SS.dll')) || fs.existsSync(path.join(P.win64, 'dwmapi.dll'));
	const txt = readText(path.join(modsDir, 'mods.txt')) || '';
	const fromTxt = new Map();
	for (const line of txt.split(/\r?\n/)) {
		const m = line.match(/^\s*([^;:\s][^:]*?)\s*:\s*([01])\s*$/);
		if (m) fromTxt.set(m[1], m[2] === '1');
	}
	let lua = [];
	if (fs.existsSync(modsDir)) {
		lua = fs
			.readdirSync(modsDir, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name !== 'shared')
			.map((e) => ({
				name: e.name,
				enabled: fs.existsSync(path.join(modsDir, e.name, 'enabled.txt')) || fromTxt.get(e.name) === true
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}
	const pakDirs = [
		['~mods', path.join(P.paks, '~mods')],
		['LogicMods', path.join(P.paks, 'LogicMods')]
	];
	const paks = [];
	for (const [where, dir] of pakDirs) {
		if (!fs.existsSync(dir)) continue;
		for (const f of fs.readdirSync(dir)) {
			const m = f.match(/^(.+\.pak)(\.disabled)?$/i);
			if (m) paks.push({ where, name: m[1], enabled: !m[2], bytes: fs.statSync(path.join(dir, f)).size });
		}
	}
	const ms = readText(P.modSettings);
	return {
		ok: true,
		ue4ssInstalled,
		lua,
		paks,
		globalMods: ms === null ? null : /bGlobalEnableMod=True/i.test(ms),
		dirs: { lua: modsDir, paks: path.join(P.paks, '~mods') }
	};
}

export function palToggleMod(body = {}) {
	const P = palPaths();
	const on = !!body.enabled;
	if (body.kind === 'lua') {
		const name = String(body.name || '');
		if (!/^[\w.\- ]{1,80}$/.test(name)) throw new Error(L('Ogiltigt modnamn', 'Invalid mod name'));
		const modsDir = path.join(P.ue4ss, 'Mods');
		if (!fs.existsSync(path.join(modsDir, name))) throw new Error(L('Modden finns inte', 'The mod does not exist'));
		const flag = path.join(modsDir, name, 'enabled.txt');
		if (on) fs.writeFileSync(flag, '');
		else fs.rmSync(flag, { force: true });
		// mods.txt
		const txtPath = path.join(modsDir, 'mods.txt');
		const txt = readText(txtPath);
		if (txt !== null) {
			const lines = txt.split(/\r?\n/);
			const re = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*[01]\\s*$`);
			let hit = false;
			for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) {
				lines[i] = `${name} : ${on ? 1 : 0}`;
				hit = true;
			}
			if (!hit) {
				const kb = lines.findIndex((l) => /^\s*;\s*Built-in keybinds/i.test(l));
				lines.splice(kb >= 0 ? kb : lines.length, 0, `${name} : ${on ? 1 : 0}`);
			}
			fs.writeFileSync(txtPath, lines.join('\r\n'));
		}
		// mods.json (nyare UE4SS)
		const jsonPath = path.join(modsDir, 'mods.json');
		const js = readText(jsonPath);
		if (js !== null) {
			try {
				const arr = JSON.parse(js);
				const e = arr.find((x) => x.mod_name === name);
				if (e) e.mod_enabled = on;
				else arr.push({ mod_name: name, mod_enabled: on });
				fs.writeFileSync(jsonPath, JSON.stringify(arr, null, 4));
			} catch {
				/* trasig json – låt den vara */
			}
		}
	} else if (body.kind === 'pak') {
		const name = String(body.name || '');
		if (!/^[\w.\- ]{1,120}\.pak$/i.test(name)) throw new Error(L('Ogiltigt filnamn', 'Invalid file name'));
		const dir = path.join(P.paks, body.where === 'LogicMods' ? 'LogicMods' : '~mods');
		const a = path.join(dir, name);
		const b = `${a}.disabled`;
		if (on && fs.existsSync(b)) fs.renameSync(b, a);
		if (!on && fs.existsSync(a)) fs.renameSync(a, b);
	} else if (body.kind === 'global') {
		const txt = readText(P.modSettings);
		if (txt === null) throw new Error(L('Hittar inte PalModSettings.ini', 'Cannot find PalModSettings.ini'));
		fs.writeFileSync(P.modSettings, txt.replace(/bGlobalEnableMod=\w+/i, `bGlobalEnableMod=${on ? 'True' : 'False'}`));
	} else throw new Error(L('Okänd modtyp', 'Unknown mod type'));
	log('config', L(`Palworld: ${body.name || 'mods'} ${on ? 'på' : 'av'} (gäller efter omstart)`, `Palworld: ${body.name || 'mods'} ${on ? 'on' : 'off'} (applies after restart)`));
	return { ok: true };
}

// ------------------------------------------------------------------ loggar
function logSources() {
	const P = palPaths();
	const out = [];
	try {
		const files = fs
			.readdirSync(P.logs)
			.filter((f) => f.endsWith('.log'))
			.map((f) => ({ f, t: fs.statSync(path.join(P.logs, f)).mtimeMs }))
			.sort((a, b) => b.t - a.t);
		if (files[0]) out.push({ id: 'server', label: L('Serverlogg', 'Server log'), file: path.join(P.logs, files[0].f) });
	} catch {
		/* */
	}
	const ac = path.join(P.ue4ss, 'Mods', 'AdminCommands', 'Scripts', 'logs');
	const cand = [
		['chat', L('Chatt', 'Chat'), path.join(ac, 'serverlogs', 'chat.txt')],
		['connections', L('In- och utloggningar', 'Joins and leaves'), path.join(ac, 'serverlogs', 'connections.txt')],
		['commands', L('Adminkommandon', 'Admin commands'), path.join(ac, 'commands.txt')],
		['ue4ss', 'UE4SS', path.join(P.ue4ss, 'UE4SS.log')]
	];
	for (const [id, label, file] of cand) if (fs.existsSync(file)) out.push({ id, label, file });
	return out;
}

export function palLog(source, offset) {
	const sources = logSources();
	const src = sources.find((s) => s.id === source) || sources[0];
	const list = sources.map(({ id, label }) => ({ id, label }));
	if (!src) return { ok: true, sources: list, source: null, lines: [], offset: 0 };
	const st = fs.statSync(src.file);
	let start = Number.isFinite(offset) && offset >= 0 && offset <= st.size ? offset : Math.max(0, st.size - 48 * 1024);
	const reset = !(Number.isFinite(offset) && offset >= 0 && offset <= st.size);
	const len = Math.min(st.size - start, 256 * 1024);
	let text = '';
	if (len > 0) {
		const fd = fs.openSync(src.file, 'r');
		const buf = Buffer.alloc(len);
		fs.readSync(fd, buf, 0, len, start);
		fs.closeSync(fd);
		text = buf.toString('utf8');
	}
	if (reset && start > 0) text = text.slice(text.indexOf('\n') + 1);
	return { ok: true, sources: list, source: src.id, reset, offset: start + len, lines: text.split(/\r?\n/).filter(Boolean).slice(-1500) };
}

// ------------------------------------------------------------------ uppdatering via SteamCMD
const upd = { running: false, lines: [], ok: null, startedAt: null, finishedAt: null, check: null, checkedAt: 0 };

function installedBuild() {
	for (const m of palPaths().manifests) {
		const acf = readText(m);
		if (!acf) continue;
		return {
			buildId: (acf.match(/"buildid"\s+"(\d+)"/) || [])[1] || null,
			lastUpdated: Number((acf.match(/"LastUpdated"\s+"(\d+)"/) || [])[1] || 0) * 1000 || null
		};
	}
	return { buildId: null, lastUpdated: null };
}

export async function palCheckUpdate(force = false) {
	if (!force && upd.check && Date.now() - upd.checkedAt < 20 * 60 * 1000) return upd.check;
	const inst = installedBuild();
	const out = { ...inst, latest: null, upToDate: null, error: null };
	try {
		const r = await fetch(`https://api.steamcmd.net/v1/info/${APP_ID}`, { signal: AbortSignal.timeout(10000) });
		const j = await r.json();
		out.latest = j?.data?.[APP_ID]?.depots?.branches?.public?.buildid ?? null;
		if (out.latest && inst.buildId) out.upToDate = String(out.latest) === String(inst.buildId);
	} catch (e) {
		out.error = L('Kunde inte fråga Steam: ', 'Could not reach Steam: ') + e.message;
	}
	upd.check = out;
	upd.checkedAt = Date.now();
	return out;
}

function runSteamCmd(validate) {
	return new Promise((resolve) => {
		const steamcmd = getSettings().steamcmd;
		if (!fs.existsSync(steamcmd)) {
			upd.lines.push(L(`Hittar inte SteamCMD: ${steamcmd} (ändras under CS2 → Inställningar)`, `Cannot find SteamCMD: ${steamcmd} (change it under CS2 → Settings)`));
			return resolve(false);
		}
		const args = ['+force_install_dir', palPaths().root, '+login', 'anonymous', '+app_update', APP_ID];
		if (validate) args.push('validate');
		args.push('+quit');
		const p = spawn(steamcmd, args, { windowsHide: true });
		const onData = (d) => {
			for (const line of d.toString('utf8').split(/\r?\n|\r/)) if (line.trim()) upd.lines.push(line.trim());
			if (upd.lines.length > 600) upd.lines.splice(0, upd.lines.length - 600);
		};
		p.stdout.on('data', onData);
		p.stderr.on('data', onData);
		p.on('close', () => resolve(upd.lines.some((l) => new RegExp(`Success! App '${APP_ID}'`).test(l))));
		p.on('error', (e) => {
			upd.lines.push('FEL: ' + e.message);
			resolve(false);
		});
	});
}

export async function palUpdate({ validate = false, countdown } = {}) {
	if (upd.running) throw new Error(L('En uppdatering pågår redan', 'An update is already running'));
	if (state.busy) throw new Error(L('Vänta, panelen håller på med Palworld just nu.', 'Wait, the panel is busy with Palworld right now.'));
	upd.running = true;
	upd.lines = [];
	upd.ok = null;
	upd.startedAt = Date.now();
	upd.finishedAt = null;
	(async () => {
		await probe(true);
		const wasRunning = state.running;
		if (wasRunning) {
			const down = await stopInternal({ countdown: countdown ?? 60, message: L('Servern uppdateras – tillbaka om en stund', 'Server updating – back shortly'), kind: 'update', backup: true });
			if (!down) throw new Error(L('Servern gick inte att stoppa', 'Could not stop the server'));
		}
		state.busy = 'updating';
		log('update', L('Palworld: uppdaterar via SteamCMD…', 'Palworld: updating via SteamCMD…'));
		const ok = await runSteamCmd(validate);
		state.busy = null;
		upd.ok = ok;
		upd.check = null;
		if (ok) {
			log('ok', L('Palworld: servern är uppdaterad', 'Palworld: the server is up to date'));
			notify('update', L('⬆️ Palworld-servern är uppdaterad', '⬆️ The Palworld server was updated'));
		} else log('error', L('Palworld: uppdateringen misslyckades – se SteamCMD-loggen', 'Palworld: the update failed – see the SteamCMD log'));
		if (wasRunning) await palStart();
	})()
		.catch((e) => {
			upd.lines.push('FEL: ' + e.message);
			upd.ok = false;
			state.busy = null;
		})
		.finally(() => {
			upd.running = false;
			upd.finishedAt = Date.now();
		});
	return { ok: true };
}

export function palUpdateJob() {
	return { ok: true, running: upd.running, success: upd.ok, lines: upd.lines.slice(-300), startedAt: upd.startedAt, finishedAt: upd.finishedAt };
}

// ------------------------------------------------------------------ Discord-notiser
async function notify(event, text) {
	const w = palCfg().webhook;
	if (!w.url || !w[event]) return;
	try {
		await fetch(w.url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'Gamla Skolan – Palworld', content: text }),
			signal: AbortSignal.timeout(8000)
		});
	} catch {
		/* notiser får aldrig stoppa något */
	}
}

export async function palTestWebhook() {
	const w = palCfg().webhook;
	if (!w.url) throw new Error(L('Ingen webhook-adress', 'No webhook URL'));
	const r = await fetch(w.url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: 'Gamla Skolan – Palworld', content: L('✅ Test från Gamla Skolan-panelen', '✅ Test from the Gamla Skolan panel') }),
		signal: AbortSignal.timeout(8000)
	});
	if (!r.ok) throw new Error(L(`Discord svarade ${r.status}`, `Discord answered ${r.status}`));
	return { ok: true };
}

// ------------------------------------------------------------------ panelens Palworld-inställningar
export function palSavePanelCfg(body = {}) {
	const cur = palCfg();
	const next = structuredClone(cur);
	const num = (v, min, max, name) => {
		const n = Number(v);
		if (!Number.isFinite(n) || n < min || n > max) throw new Error(L(`${name}: ${min}–${max}`, `${name}: ${min}–${max}`));
		return n;
	};
	if (body.root !== undefined) {
		const r = String(body.root).trim();
		if (!r) throw new Error(L('Ange mappen där PalServer.exe ligger', 'Enter the folder with PalServer.exe'));
		next.root = r;
	}
	if (body.launch) {
		const l = body.launch;
		next.launch = {
			port: l.port === '' || l.port == null ? '' : num(l.port, 1, 65535, L('Port', 'Port')),
			players: l.players === '' || l.players == null ? '' : num(l.players, 1, 32, L('Spelare', 'Players')),
			publicLobby: !!l.publicLobby,
			perf: !!l.perf,
			extra: String(l.extra || '').replace(/[\r\n"&|<>^]/g, ' ').trim().slice(0, 300)
		};
	}
	for (const k of ['autoStart', 'autoRestart']) if (body[k] !== undefined) next[k] = !!body[k];
	if (body.stopCountdown !== undefined) next.stopCountdown = num(body.stopCountdown, 1, 600, L('Nedräkning', 'Countdown'));
	if (body.schedule) {
		const times = (Array.isArray(body.schedule.times) ? body.schedule.times : String(body.schedule.times || '').split(/[\s,;]+/))
			.map((x) => String(x).trim())
			.filter(Boolean);
		for (const t of times) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(L(`Ogiltig tid: ${t} (skriv t.ex. 06:00)`, `Invalid time: ${t} (e.g. 06:00)`));
		next.schedule = {
			enabled: !!body.schedule.enabled,
			times: [...new Set(times)].sort(),
			warnMinutes: num(body.schedule.warnMinutes ?? 5, 0, 60, L('Varning', 'Warning'))
		};
	}
	if (body.backup) {
		const b = body.backup;
		next.backup = {
			dir: String(b.dir ?? cur.backup.dir).trim() || PAL_DEFAULTS.backup.dir,
			auto: !!b.auto,
			everyHours: num(b.everyHours ?? cur.backup.everyHours, 0.25, 168, L('Intervall', 'Interval')),
			keep: Math.round(num(b.keep ?? cur.backup.keep, 1, 500, L('Antal', 'Count'))),
			onStop: !!b.onStop
		};
	}
	if (body.update) next.update = { auto: !!body.update.auto };
	if (body.webhook) {
		const w = body.webhook;
		const url = String(w.url ?? '').trim();
		if (url && !/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w\-]+$/.test(url)) throw new Error(L('Det ser inte ut som en Discord-webhook', 'That does not look like a Discord webhook'));
		next.webhook = { url };
		for (const k of ['start', 'stop', 'crash', 'restart', 'update', 'backup']) next.webhook[k] = !!w[k];
	}
	savePalCfg(next);
	scheduleNext();
	return { ok: true };
}

// ------------------------------------------------------------------ status
function lanIp() {
	for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254')) return a.address;
	return '127.0.0.1';
}

export async function palStatus() {
	const P = palPaths();
	await probe();
	let ini = null;
	try {
		ini = readIni();
	} catch {
		/* */
	}
	const fresh = state.running && Date.now() - game.updated < 20000;
	const m = fresh ? game.metrics || {} : {};
	const cfg = palCfg();
	const port = cfg.launch.port || (ini && getVal(ini, 'PublicPort')) || '8211';
	return {
		ok: true,
		installed: fs.existsSync(P.exe),
		root: P.root,
		running: state.running,
		busy: state.busy,
		api: state.apiOk,
		pid: state.pid,
		startedAt: state.startedAt,
		memBytes: state.memBytes,
		expect: state.expect,
		serverName: ini ? getVal(ini, 'ServerName') : '',
		version: fresh && game.info ? game.info.version : null,
		players: fresh ? game.players : [],
		maxPlayers: m.maxplayernum || (ini && getVal(ini, 'ServerPlayerMaxNum')) || '',
		metrics: fresh ? { fps: m.serverfps ?? null, frameTime: m.serverframetime ?? null, uptime: m.uptime ?? null, days: m.days ?? null, bases: m.basecampnum ?? null } : null,
		address: `${lanIp()}:${port}`,
		publicIp: ini ? getVal(ini, 'PublicIP') : '',
		port,
		restPort: ini ? getVal(ini, 'RESTAPIPort') : '8212',
		banlist: banlist(),
		nextRestart: state.restartAt,
		notice: state.notice,
		recentCrashes: state.crashes.filter((t) => Date.now() - t < 3600000).length,
		launchArgs: launchArgs().join(' '),
		cfg,
		update: upd.check
	};
}

// ------------------------------------------------------------------ bakgrundsjobb
let monitorStarted = false;
let lastBackupAt = 0;
let lastAutoUpdateCheck = 0;

function scheduleNext() {
	const { schedule } = palCfg();
	if (!schedule.enabled || !schedule.times.length) return (state.restartAt = null);
	const now = new Date();
	let best = null;
	for (const t of schedule.times) {
		const [h, mi] = t.split(':').map(Number);
		const d = new Date(now);
		d.setHours(h, mi, 0, 0);
		if (d.getTime() <= now.getTime() + 30000) d.setDate(d.getDate() + 1);
		if (!best || d < best) best = d;
	}
	state.restartAt = best ? best.getTime() : null;
}

const warned = new Set();
async function tickSchedule() {
	const cfg = palCfg();
	if (!state.restartAt || !cfg.schedule.enabled) return;
	const left = state.restartAt - Date.now();
	if (left <= 0 && !state.running) return scheduleNext(); // servern var avstängd – vänta till nästa tid
	if (!state.running || state.busy) return;
	const warnMs = cfg.schedule.warnMinutes * 60000;
	for (const minutes of [cfg.schedule.warnMinutes, 5, 1]) {
		const key = `${state.restartAt}-${minutes}`;
		if (minutes > 0 && minutes <= cfg.schedule.warnMinutes && left <= minutes * 60000 && left > (minutes - 1) * 60000 && !warned.has(key)) {
			warned.add(key);
			pal('POST', 'announce', { message: L(`Servern startas om om ${minutes} min`, `Server restarts in ${minutes} min`) }).catch(() => {});
		}
	}
	state.notice = left <= warnMs && left > 0 ? { kind: 'restart', at: state.restartAt } : null;
	if (left <= 0) {
		state.notice = null;
		log('server', L('Palworld: schemalagd omstart', 'Palworld: scheduled restart'));
		scheduleNext();
		restartInternal({ countdown: 15, message: L('Schemalagd omstart', 'Scheduled restart') }).catch((e) => log('error', e.message));
	}
}

async function tickBackup() {
	const { backup } = palCfg();
	if (!backup.auto || state.busy) return;
	if (!lastBackupAt) {
		const latest = palBackups().list.find((b) => b.label === 'auto');
		lastBackupAt = latest ? new Date(latest.at).getTime() : Date.now();
	}
	if (Date.now() - lastBackupAt < backup.everyHours * 3600000) return;
	lastBackupAt = Date.now();
	if (!state.running) return; // ingen idé att backa upp en värld som inte ändras
	await makeBackup('auto').catch((e) => {
		log('error', `Palworld backup: ${e.message}`);
		notify('backup', L(`⚠️ Palworld-backup misslyckades: ${e.message}`, `⚠️ Palworld backup failed: ${e.message}`));
	});
}

async function tickAutoUpdate() {
	if (!palCfg().update.auto || state.busy || upd.running) return;
	if (Date.now() - lastAutoUpdateCheck < 30 * 60 * 1000) return;
	lastAutoUpdateCheck = Date.now();
	const c = await palCheckUpdate(true);
	if (c.upToDate === false) {
		log('update', L('Palworld: ny version hittad – uppdaterar automatiskt', 'Palworld: new version found – updating automatically'));
		if (state.running) {
			pal('POST', 'announce', { message: L('Ny Palworld-version – servern uppdateras om 5 min', 'New Palworld version – server updates in 5 min') }).catch(() => {});
			await new Promise((r) => setTimeout(r, 4 * 60000));
		}
		await palUpdate({ countdown: 60 }).catch((e) => log('error', e.message));
	}
}

async function tick() {
	const wasRunning = state.running;
	await probe(true);
	if (state.running) {
		await refreshGame();
		if (!wasRunning && !state.busy) state.expect = true; // startad utanför panelen
	} else if (wasRunning && state.expect && !state.busy) {
		// Servern försvann utan att panelen stängde den = krasch (eller att någon stängde fönstret).
		state.crashes.push(Date.now());
		state.crashes = state.crashes.filter((t) => Date.now() - t < 3600000);
		log('error', L('Palworld: servern stängdes oväntat', 'Palworld: the server stopped unexpectedly'));
		notify('crash', L('💥 Palworld-servern stängdes oväntat', '💥 The Palworld server stopped unexpectedly'));
		if (palCfg().autoRestart && state.crashes.length <= 5) {
			setTimeout(() => palStart({ reason: L('Palworld: startar om efter krasch…', 'Palworld: restarting after crash…') }).catch((e) => log('error', e.message)), 10000);
		} else {
			state.expect = false;
			if (state.crashes.length > 5) log('error', L('Palworld: kraschar för ofta – slutar starta om automatiskt', 'Palworld: crashing too often – stopped auto restart'));
		}
	}
	await tickSchedule().catch(() => {});
	await tickBackup().catch(() => {});
	tickAutoUpdate().catch(() => {});
}

export function startPalworldMonitor() {
	if (monitorStarted || !isWin) return;
	monitorStarted = true;
	scheduleNext();
	(async () => {
		await probe(true);
		state.expect = state.running;
		if (!state.running) applyPending();
		if (state.running) await refreshGame();
		else if (palCfg().autoStart && fs.existsSync(palPaths().exe)) await palStart({ reason: L('Palworld: startar med panelen…', 'Palworld: starting with the panel…') }).catch((e) => log('error', e.message));
		// Slå på REST API:t direkt så att det gäller nästa gång servern startar, hur den än startas.
		try {
			if (fs.existsSync(palPaths().exe)) ensureApi();
		} catch {
			/* */
		}
		setInterval(() => tick().catch(() => {}), 10000);
	})();
}
