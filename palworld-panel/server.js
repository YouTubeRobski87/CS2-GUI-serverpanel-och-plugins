// Gamla Skolan – panel för Palworld.
// Inga beroenden: kör med "node server.js". Lyssnar bara på den här datorn (127.0.0.1).
// Styr servern via Palworlds inbyggda REST API (aktiveras automatiskt av panelen).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');

// ------------------------------------------------------------------ inställningar för panelen
const PANEL_DIR = __dirname;
const DATA_DIR = path.join(PANEL_DIR, 'panel-data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const CFG_FILE = path.join(DATA_DIR, 'panel-settings.json');
const DEFAULTS = {
	serverDir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\PalServer',
	port: 8029,
	launchArgs: ['-useperfthreads', '-NoAsyncLoadingThread', '-UseMultithreadForDS']
};
let cfg = { ...DEFAULTS };
try {
	cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) };
} catch {
	fs.writeFileSync(CFG_FILE, JSON.stringify(DEFAULTS, null, 2));
}
const P = {
	exe: path.join(cfg.serverDir, 'PalServer.exe'),
	ini: path.join(cfg.serverDir, 'Pal', 'Saved', 'Config', 'WindowsServer', 'PalWorldSettings.ini'),
	defaultIni: path.join(cfg.serverDir, 'DefaultPalWorldSettings.ini'),
	logs: path.join(cfg.serverDir, 'Pal', 'Saved', 'Logs')
};
// PalServer.exe startar den riktiga serverprocessen och avslutas själv.
const PROC_RE = /"(PalServer-Win64-Shipping(?:-Cmd)?\.exe|PalServer\.exe)","(\d+)"/gi;

// ------------------------------------------------------------------ händelselogg
const events = [];
function log(kind, text) {
	events.push({ t: Date.now(), kind, text });
	if (events.length > 200) events.shift();
	try {
		fs.appendFileSync(path.join(DATA_DIR, 'panel.log'), `${new Date().toISOString()} [${kind}] ${text}\n`);
	} catch {
		/* loggning får aldrig stoppa panelen */
	}
}

// ------------------------------------------------------------------ PalWorldSettings.ini
// Allt ligger på en rad: OptionSettings=(Nyckel=Värde,Nyckel="text",...)
function readIni() {
	if (!fs.existsSync(P.ini) || fs.statSync(P.ini).size < 100) {
		// Tom fil = standardvärden. Vi utgår från Default-filen så att vi har något att redigera.
		const def = fs.readFileSync(P.defaultIni, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith(';')).join('\r\n');
		fs.mkdirSync(path.dirname(P.ini), { recursive: true });
		fs.writeFileSync(P.ini, def);
	}
	return fs.readFileSync(P.ini, 'utf8');
}
const keyRe = (k) => new RegExp(`([(,])${k}=("[^"]*"|[^,)]*)`);
function getVal(ini, k) {
	const m = ini.match(keyRe(k));
	if (!m) return null;
	return m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
}
function setVal(ini, k, v, kind) {
	let out;
	if (kind === 'text') out = `"${String(v).replace(/["\r\n]/g, '')}"`;
	else if (kind === 'float') out = Number(v).toFixed(6);
	else out = String(v);
	if (keyRe(k).test(ini)) return ini.replace(keyRe(k), (_, pre) => `${pre}${k}=${out}`);
	return ini.replace(/OptionSettings=\(/, `OptionSettings=(${k}=${out},`);
}

// Panelen behöver REST API:t påslaget och ett adminlösenord för att kunna styra servern.
function ensureApi() {
	let ini = readIni();
	let changed = false;
	if (getVal(ini, 'RESTAPIEnabled') !== 'True') {
		ini = setVal(ini, 'RESTAPIEnabled', 'True', 'raw');
		changed = true;
	}
	if (!getVal(ini, 'AdminPassword')) {
		ini = setVal(ini, 'AdminPassword', crypto.randomBytes(9).toString('base64url'), 'text');
		changed = true;
	}
	if (changed) {
		fs.writeFileSync(P.ini, ini);
		log('ok', 'Slog på serverns REST API (behövs för panelen)');
	}
}
const apiPort = () => Number(getVal(readIni(), 'RESTAPIPort')) || 8212;
const adminPass = () => getVal(readIni(), 'AdminPassword') || '';

// ------------------------------------------------------------------ REST API mot servern
function pal(method, endpoint, body) {
	return new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : null;
		const req = http.request(
			{
				host: '127.0.0.1',
				port: apiPort(),
				path: `/v1/api/${endpoint}`,
				method,
				timeout: 4000,
				headers: {
					Authorization: 'Basic ' + Buffer.from(`admin:${adminPass()}`).toString('base64'),
					...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
				}
			},
			(res) => {
				let txt = '';
				res.on('data', (c) => (txt += c));
				res.on('end', () => {
					if (res.statusCode >= 400) return reject(new Error(`Servern svarade ${res.statusCode}`));
					try {
						resolve(txt ? JSON.parse(txt) : {});
					} catch {
						resolve({ text: txt });
					}
				});
			}
		);
		req.on('timeout', () => req.destroy(new Error('Servern svarar inte')));
		req.on('error', () => reject(new Error('Ingen kontakt med servern (REST API).')));
		if (data) req.write(data);
		req.end();
	});
}

// ------------------------------------------------------------------ serverprocessen
const state = { running: false, pid: null, busy: null, apiOk: false, stopTimer: null };
const game = { info: null, metrics: null, players: [], updated: 0 };

function probe() {
	return new Promise((resolve) => {
		execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
			if (err) return resolve();
			const found = [...String(out).matchAll(PROC_RE)];
			const main = found.find((m) => /Shipping/i.test(m[1])) || found[0];
			const was = state.running;
			state.running = !!main;
			state.pid = main ? Number(main[2]) : null;
			if (was && !state.running) {
				log('server', 'Servern har stängts');
				// Servern stängde själv – avbryt nödstoppet så att det inte träffar en ny server.
				clearTimeout(state.stopTimer);
				state.stopTimer = null;
				state.apiOk = false;
				if (state.busy === 'stopping') state.busy = null;
			}
			resolve();
		});
	});
}
setInterval(probe, 3000);
probe();

async function refreshGame() {
	if (!state.running) return;
	try {
		game.metrics = await pal('GET', 'metrics');
		const p = await pal('GET', 'players');
		game.players = (p.players || []).map((x) => ({
			name: x.name,
			level: x.level,
			ping: Math.round(x.ping || 0),
			userId: x.userId,
			buildings: x.building_count
		}));
		if (!game.info) game.info = await pal('GET', 'info');
		game.updated = Date.now();
		if (!state.apiOk) {
			state.apiOk = true;
			if (state.busy === 'starting') {
				state.busy = null;
				log('ok', 'Servern är igång');
			}
		}
	} catch {
		state.apiOk = false;
	}
}
setInterval(refreshGame, 5000);

async function startServer() {
	clearTimeout(state.stopTimer);
	state.stopTimer = null;
	await probe();
	if (state.running) throw new Error('Servern är redan igång.');
	if (state.busy) throw new Error('Vänta, panelen håller på med något annat.');
	if (!fs.existsSync(P.exe)) throw new Error(`Hittar inte servern: ${P.exe}`);
	ensureApi();
	const child = spawn(P.exe, cfg.launchArgs, { cwd: cfg.serverDir, detached: true, stdio: 'ignore', windowsHide: false });
	child.unref();
	state.busy = 'starting';
	game.info = null;
	log('server', 'Startar servern…');
	const t0 = Date.now();
	const iv = setInterval(async () => {
		await probe();
		if (state.busy !== 'starting') return clearInterval(iv);
		if (!state.running && Date.now() - t0 > 30000) {
			clearInterval(iv);
			state.busy = null;
			log('error', 'Servern startade inte');
		} else if (Date.now() - t0 > 300000) {
			clearInterval(iv);
			state.busy = null;
		}
	}, 3000);
}

async function stopServer() {
	await probe();
	if (!state.running) throw new Error('Servern är inte igång.');
	state.busy = 'stopping';
	log('server', 'Sparar världen och stoppar servern…');
	try {
		await pal('POST', 'save');
		await pal('POST', 'shutdown', { waittime: 10, message: 'Servern startas om / stängs om 10 sekunder' });
	} catch {
		/* svarar inte API:t tar vi till taskkill nedan */
	}
	clearTimeout(state.stopTimer);
	state.stopTimer = setTimeout(async () => {
		state.stopTimer = null;
		await probe();
		if (state.running && state.pid) {
			log('error', 'Servern stängdes inte – tvingar stopp');
			execFile('taskkill', ['/PID', String(state.pid), '/T', '/F'], { windowsHide: true }, () => probe());
		}
		state.busy = null;
	}, 60000);
}

function waitStopped(maxMs) {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const iv = setInterval(async () => {
			await probe();
			if (!state.running || Date.now() - t0 > maxMs) {
				clearInterval(iv);
				resolve(!state.running);
			}
		}, 2000);
	});
}

// ------------------------------------------------------------------ inställningar som visas i panelen
const FIELDS = [
	// group: rubriken i panelen. Flyttal visas som reglage (min–max) med sifferruta bredvid.
	{ group: 'Server', key: 'ServerName', label: 'Servernamn', type: 'text' },
	{ group: 'Server', key: 'ServerDescription', label: 'Beskrivning', type: 'text' },
	{ group: 'Server', key: 'ServerPassword', label: 'Lösenord (tomt = öppen)', type: 'text' },
	{ group: 'Server', key: 'ServerPlayerMaxNum', label: 'Max spelare', type: 'int' },
	{ group: 'Server', key: 'bIsPvP', label: 'PvP', type: 'bool' },
	{ group: 'Server', key: 'DeathPenalty', label: 'När man dör tappar man', type: 'select', options: [['None', 'Ingenting'], ['Item', 'Föremål'], ['ItemAndEquipment', 'Föremål och utrustning'], ['All', 'Allt, även pals']] },
	{ group: 'Server', key: 'bEnableInvaderEnemy', label: 'Räder mot baser', type: 'bool' },
	{ group: 'Spelare', key: 'ExpRate', label: 'XP', type: 'float', min: 0.1, max: 20 },
	{ group: 'Spelare', key: 'PlayerStomachDecreaceRate', label: 'Hunger (lägre = långsammare)', type: 'float', min: 0.1, max: 5 },
	{ group: 'Spelare', key: 'PlayerStaminaDecreaceRate', label: 'Stamina-förbrukning', type: 'float', min: 0.1, max: 5 },
	{ group: 'Spelare', key: 'PlayerDamageRateAttack', label: 'Skada spelaren gör', type: 'float', min: 0.1, max: 5 },
	{ group: 'Spelare', key: 'PlayerDamageRateDefense', label: 'Skada spelaren tar', type: 'float', min: 0.1, max: 5 },
	{ group: 'Spelare', key: 'ItemWeightRate', label: 'Vikt på föremål', type: 'float', min: 0, max: 5 },
	{ group: 'Pals', key: 'PalCaptureRate', label: 'Fångstchans', type: 'float', min: 0.5, max: 5 },
	{ group: 'Pals', key: 'PalSpawnNumRate', label: 'Antal pals i världen', type: 'float', min: 0.5, max: 3 },
	{ group: 'Pals', key: 'WorkSpeedRate', label: 'Arbetshastighet i basen', type: 'float', min: 0.1, max: 5 },
	{ group: 'Pals', key: 'PalStomachDecreaceRate', label: 'Hunger pals', type: 'float', min: 0.1, max: 5 },
	{ group: 'Pals', key: 'PalStaminaDecreaceRate', label: 'Stamina pals', type: 'float', min: 0.1, max: 5 },
	{ group: 'Pals', key: 'PalDamageRateAttack', label: 'Skada pals gör', type: 'float', min: 0.1, max: 5 },
	{ group: 'Pals', key: 'PalDamageRateDefense', label: 'Skada pals tar', type: 'float', min: 0.1, max: 5 },
	{ group: 'Pals', key: 'PalEggDefaultHatchingTime', label: 'Kläcktid ägg (timmar)', type: 'float', min: 0, max: 240 },
	{ group: 'Pals', key: 'BaseCampWorkerMaxNum', label: 'Pals som jobbar per bas', type: 'int' },
	{ group: 'Världen', key: 'DayTimeSpeedRate', label: 'Dagens hastighet', type: 'float', min: 0.1, max: 5 },
	{ group: 'Världen', key: 'NightTimeSpeedRate', label: 'Nattens hastighet', type: 'float', min: 0.1, max: 5 },
	{ group: 'Världen', key: 'CollectionDropRate', label: 'Resurser från insamling', type: 'float', min: 0.5, max: 5 },
	{ group: 'Världen', key: 'CollectionObjectRespawnSpeedRate', label: 'Hur snabbt träd/sten växer tillbaka (lägre = snabbare)', type: 'float', min: 0.5, max: 3 },
	{ group: 'Världen', key: 'EnemyDropItemRate', label: 'Loot från fiender', type: 'float', min: 0.5, max: 5 },
	{ group: 'Världen', key: 'BuildObjectDeteriorationDamageRate', label: 'Förfall på byggen (0 = inget)', type: 'float', min: 0, max: 10 }
];

function readSettings() {
	const ini = readIni();
	const values = {};
	for (const f of FIELDS) values[f.key] = getVal(ini, f.key) ?? '';
	return { fields: FIELDS, values };
}

function writeSettings(values) {
	let ini = readIni();
	fs.writeFileSync(P.ini + '.bak', ini);
	for (const f of FIELDS) {
		if (!(f.key in values)) continue;
		const v = String(values[f.key]).trim().replace(',', '.');
		if (f.type === 'int' && !/^\d+$/.test(v)) throw new Error(`${f.label} måste vara ett heltal.`);
		if (f.type === 'float' && !/^\d+(\.\d+)?$/.test(v)) throw new Error(`${f.label} måste vara ett tal, t.ex. 1 eller 0.5.`);
		if (f.type === 'bool' && !['True', 'False'].includes(v)) throw new Error(`Ogiltigt val för ${f.label}.`);
		if (f.type === 'select' && !f.options.some((o) => o[0] === v)) throw new Error(`Ogiltigt val för ${f.label}.`);
		ini = setVal(ini, f.key, v, f.type === 'text' ? 'text' : f.type === 'float' ? 'float' : 'raw');
	}
	fs.writeFileSync(P.ini, ini);
	log('ok', 'Inställningarna sparade – gäller vid nästa start');
}

// ------------------------------------------------------------------ loggen
function newestLog() {
	try {
		const files = fs
			.readdirSync(P.logs)
			.filter((f) => f.endsWith('.log'))
			.map((f) => ({ f, t: fs.statSync(path.join(P.logs, f)).mtimeMs }))
			.sort((a, b) => b.t - a.t);
		return files[0] ? path.join(P.logs, files[0].f) : null;
	} catch {
		return null;
	}
}

function readLog(file, offset) {
	const current = newestLog();
	if (!current) return { file: null, offset: 0, lines: [], reset: true, mtime: null };
	const name = path.basename(current);
	let reset = false;
	if (name !== file || offset < 0) {
		reset = true;
		offset = -1;
	}
	const st = fs.statSync(current);
	let start = offset;
	if (start < 0 || start > st.size) start = Math.max(0, st.size - 32 * 1024);
	const len = Math.min(st.size - start, 256 * 1024);
	let text = '';
	if (len > 0) {
		// Servern har filen öppen; läs med delad åtkomst.
		const fd = fs.openSync(current, 'r');
		const buf = Buffer.alloc(len);
		fs.readSync(fd, buf, 0, len, start);
		fs.closeSync(fd);
		text = buf.toString('utf8');
	}
	if (reset && start > 0) text = text.slice(text.indexOf('\n') + 1);
	const nl = text.lastIndexOf('\n');
	let used = len;
	if (nl >= 0 && nl < text.length - 1) {
		used -= Buffer.byteLength(text.slice(nl + 1), 'utf8');
		text = text.slice(0, nl + 1);
	}
	return { file: name, offset: start + used, lines: text.split(/\r?\n/).filter(Boolean).slice(-1000), reset, mtime: st.mtimeMs };
}

// ------------------------------------------------------------------ HTTP
function send(res, code, body, type = 'application/json; charset=utf-8') {
	res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
	res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (c) => {
			data += c;
			if (data.length > 1e6) req.destroy();
		});
		req.on('end', () => {
			try {
				resolve(data ? JSON.parse(data) : {});
			} catch {
				reject(new Error('Felaktig JSON'));
			}
		});
	});
}
const idOk = (s) => /^[A-Za-z0-9_\-]+$/.test(String(s || ''));

const routes = {
	'GET /api/status': async () => {
		let s = {};
		try {
			s = readSettings().values;
		} catch {
			/* configen saknas */
		}
		const fresh = state.running && Date.now() - game.updated < 20000;
		const m = fresh ? game.metrics || {} : {};
		return {
			installed: fs.existsSync(P.exe),
			running: state.running,
			busy: state.busy,
			api: state.apiOk,
			serverName: s.ServerName || '',
			version: fresh && game.info ? game.info.version : null,
			playerCount: fresh ? game.players.length : null,
			maxPlayers: m.maxplayernum || s.ServerPlayerMaxNum || '',
			day: m.days ?? null,
			fps: m.serverfps ?? null,
			uptime: m.uptime ?? null,
			players: fresh ? game.players : [],
			events: events.slice(-30)
		};
	},
	'POST /api/start': async () => (await startServer(), { ok: true }),
	'POST /api/stop': async () => (await stopServer(), { ok: true }),
	'POST /api/restart': async () => {
		(async () => {
			await stopServer();
			if (await waitStopped(70000)) {
				state.busy = null;
				await startServer();
			}
		})().catch((e) => log('error', e.message));
		return { ok: true };
	},
	'POST /api/save': async () => {
		await pal('POST', 'save');
		log('ok', 'Världen sparad');
		return { ok: true };
	},
	'POST /api/announce': async (_q, body) => {
		const message = String(body.message || '').trim().slice(0, 200);
		if (!message) throw new Error('Tomt meddelande.');
		await pal('POST', 'announce', { message });
		log('cmd', `Meddelande: ${message}`);
		return { ok: true };
	},
	'POST /api/player': async (_q, body) => {
		if (!idOk(body.userId)) throw new Error('Ogiltigt spelar-id.');
		const message = String(body.reason || '').slice(0, 100);
		if (body.action === 'kick') await pal('POST', 'kick', { userid: body.userId, message: message || 'Kickad av admin' });
		else if (body.action === 'ban') await pal('POST', 'ban', { userid: body.userId, message: message || 'Bannad av admin' });
		else throw new Error('Okänd åtgärd.');
		log('cmd', `${body.action === 'kick' ? 'Kickade' : 'Bannade'} ${body.name || body.userId}`);
		return { ok: true };
	},
	'GET /api/log': async (q) => readLog(q.get('file'), Number(q.get('offset') ?? -1)),
	'GET /api/settings': async () => readSettings(),
	'POST /api/settings': async (_q, body) => (writeSettings(body.values || {}), { ok: true, running: state.running })
};

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://localhost');
	if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
		return send(res, 200, fs.readFileSync(path.join(PANEL_DIR, 'index.html')), 'text/html; charset=utf-8');
	}
	const handler = routes[`${req.method} ${url.pathname}`];
	if (!handler) return send(res, 404, { error: 'Finns inte' });
	// Skydd mot att andra webbsidor skickar kommandon: POST kräver vår egen header.
	if (req.method === 'POST' && req.headers['x-panel'] !== '1') return send(res, 403, { error: 'Nekad' });
	try {
		const body = req.method === 'POST' ? await readBody(req) : {};
		send(res, 200, await handler(url.searchParams, body));
	} catch (e) {
		send(res, 400, { error: e.message });
	}
});
server.on('error', (e) => {
	if (e.code === 'EADDRINUSE') {
		console.log(`Panelen kör redan på port ${cfg.port}.`);
		process.exit(0);
	}
	throw e;
});
// Slå på REST API:t direkt, så att det gäller nästa gång servern startar (oavsett hur den startas).
try {
	ensureApi();
} catch (e) {
	log('error', `Kunde inte läsa PalWorldSettings.ini: ${e.message}`);
}
server.listen(cfg.port, '127.0.0.1', () => {
	log('ok', `Panelen startade på http://127.0.0.1:${cfg.port}`);
	console.log(`Gamla Skolan Palworld-panel: http://127.0.0.1:${cfg.port}`);
});
