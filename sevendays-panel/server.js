// Gamla Skolan – panel för 7 Days to Die.
// Inga beroenden: kör med "node server.js". Lyssnar bara på den här datorn (127.0.0.1).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');

// ------------------------------------------------------------------ inställningar för panelen
const PANEL_DIR = __dirname;
const DATA_DIR = path.join(PANEL_DIR, 'panel-data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const CFG_FILE = path.join(DATA_DIR, 'panel-settings.json');
const DEFAULTS = {
	sevenDir: 'C:\\GameServers\\7DaysToDie',
	steamcmd: 'C:\\SteamCMD\\steamcmd.exe',
	port: 8028,
	telnetPort: 8081,
	configName: 'serverconfig-gamlaskolan.xml'
};
let cfg = { ...DEFAULTS };
try {
	cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) };
} catch {
	fs.writeFileSync(CFG_FILE, JSON.stringify(DEFAULTS, null, 2));
}
const P = {
	root: cfg.sevenDir,
	server: path.join(cfg.sevenDir, 'server'),
	exe: path.join(cfg.sevenDir, 'server', '7DaysToDieServer.exe'),
	config: path.join(cfg.sevenDir, cfg.configName),
	logs: path.join(cfg.sevenDir, 'loggar')
};
const EXE_NAME = '7DaysToDieServer.exe';

// ------------------------------------------------------------------ händelselogg (visas i panelen)
const events = [];
function log(kind, text) {
	const line = { t: Date.now(), kind, text };
	events.push(line);
	if (events.length > 200) events.shift();
	try {
		fs.appendFileSync(path.join(DATA_DIR, 'panel.log'), `${new Date().toISOString()} [${kind}] ${text}\n`);
	} catch {
		/* loggning får aldrig stoppa panelen */
	}
}

// ------------------------------------------------------------------ serverprocessen
const state = { running: false, pid: null, busy: null, startedAt: null, stopTimer: null };

function probe() {
	return new Promise((resolve) => {
		execFile('tasklist', ['/FI', `IMAGENAME eq ${EXE_NAME}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
			if (err) return resolve();
			const m = String(out).match(/"7DaysToDieServer\.exe","(\d+)"/i);
			const was = state.running;
			state.running = !!m;
			state.pid = m ? Number(m[1]) : null;
			if (was && !state.running) {
				log('server', 'Servern har stängts');
				if (state.busy === 'stopping') state.busy = null;
				telnet.close();
			}
			if (!was && state.running && !state.startedAt) state.startedAt = Date.now();
			if (!state.running) state.startedAt = null;
			resolve();
		});
	});
}
setInterval(probe, 3000);
probe();

function stamp() {
	const d = new Date();
	const z = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

async function startServer() {
	await probe();
	if (state.running) throw new Error('Servern är redan igång.');
	if (state.busy) throw new Error('Vänta, panelen håller på med något annat.');
	if (!fs.existsSync(P.exe)) throw new Error('Servern är inte installerad. Kör Uppdatera först.');
	if (!fs.existsSync(P.config)) throw new Error(`Hittar inte ${P.config}`);
	// Vår config kopieras in varje start så att en uppdatering aldrig skriver över den.
	fs.copyFileSync(P.config, path.join(P.server, cfg.configName));
	fs.mkdirSync(P.logs, { recursive: true });
	const logfile = path.join(P.logs, `server_${stamp()}.txt`);
	const args = ['-quit', '-batchmode', '-nographics', '-dedicated', `-configfile=${cfg.configName}`, '-logfile', logfile];
	const child = spawn(P.exe, args, { cwd: P.server, detached: true, stdio: 'ignore', windowsHide: false });
	child.unref();
	state.busy = 'starting';
	state.startedAt = Date.now();
	log('server', 'Startar servern…');
	// Räkna starten som klar när telnet svarar, eller efter 5 minuter.
	const t0 = Date.now();
	const iv = setInterval(async () => {
		await probe();
		if (!state.running && Date.now() - t0 > 20000) {
			clearInterval(iv);
			state.busy = null;
			log('error', 'Servern startade inte – se loggen');
		} else if (telnet.connected || Date.now() - t0 > 300000) {
			clearInterval(iv);
			state.busy = null;
			if (telnet.connected) log('ok', 'Servern är igång');
		}
	}, 3000);
}

async function stopServer() {
	await probe();
	if (!state.running) throw new Error('Servern är inte igång.');
	state.busy = 'stopping';
	log('server', 'Stoppar servern (sparar världen)…');
	try {
		await telnet.command('shutdown', 1500);
	} catch {
		/* om telnet inte svarar tar vi till taskkill nedan */
	}
	// Ge servern tid att spara. Hänger den sig dödar vi processen.
	clearTimeout(state.stopTimer);
	state.stopTimer = setTimeout(async () => {
		await probe();
		if (state.running && state.pid) {
			log('error', 'Servern svarade inte på shutdown – tvingar stopp');
			execFile('taskkill', ['/PID', String(state.pid), '/F'], { windowsHide: true }, () => probe());
		}
		state.busy = null;
	}, 90000);
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

async function restartServer() {
	await stopServer();
	const ok = await waitStopped(100000);
	if (!ok) throw new Error('Servern stängdes inte i tid.');
	clearTimeout(state.stopTimer);
	state.busy = null;
	await startServer();
}

// ------------------------------------------------------------------ telnet (kommandon till servern)
// Tomt telnet-lösenord betyder att servern bara tar emot anslutningar från den här datorn.
const telnet = {
	sock: null,
	connected: false,
	buf: '',
	waiters: [],
	queue: Promise.resolve(),
	connect() {
		if (this.sock || !state.running) return;
		const s = net.createConnection({ host: '127.0.0.1', port: cfg.telnetPort });
		this.sock = s;
		s.setEncoding('utf8');
		s.on('connect', () => {
			this.connected = true;
		});
		s.on('data', (d) => {
			this.buf += d;
			const parts = this.buf.split(/\r?\n/);
			this.buf = parts.pop();
			for (const line of parts) for (const w of this.waiters) w(line);
		});
		const done = () => {
			this.sock = null;
			this.connected = false;
		};
		s.on('error', done);
		s.on('close', done);
	},
	close() {
		if (this.sock) this.sock.destroy();
		this.sock = null;
		this.connected = false;
	},
	// Skickar ett kommando och samlar svarsraderna (rader utan tidsstämpel) tills det blir tyst.
	command(cmd, quietMs = 800) {
		const run = () =>
			new Promise((resolve, reject) => {
				if (!this.connected) return reject(new Error('Ingen kontakt med servern (telnet).'));
				const lines = [];
				let timer;
				const finish = () => {
					this.waiters = this.waiters.filter((w) => w !== onLine);
					resolve(lines);
				};
				const onLine = (line) => {
					if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(line)) return; // vanlig loggrad, inte svaret
					if (!line.trim()) return;
					lines.push(line);
					clearTimeout(timer);
					timer = setTimeout(finish, quietMs);
				};
				this.waiters.push(onLine);
				timer = setTimeout(finish, quietMs + 1500);
				this.sock.write(cmd.replace(/[\r\n]/g, ' ') + '\r\n');
			});
		const p = this.queue.then(run, run);
		this.queue = p.catch(() => {});
		return p;
	}
};
setInterval(() => telnet.connect(), 5000);

// ------------------------------------------------------------------ status från spelet
const game = { day: null, time: null, players: [], updated: 0 };

function parsePlayers(lines) {
	const out = [];
	for (const l of lines) {
		const m = l.match(/^\s*\d+\.\s+id=(\d+),\s+(.*?),\s+pos=/);
		if (!m) continue;
		const get = (k) => (l.match(new RegExp(`\\b${k}=([^,]+)`)) || [])[1] || '';
		out.push({
			entityId: m[1],
			name: m[2],
			level: get('level'),
			health: get('health'),
			deaths: get('deaths'),
			zombies: get('zombies'),
			ping: get('ping'),
			platformId: get('pltfmid')
		});
	}
	return out;
}

async function refreshGame() {
	if (!telnet.connected) return;
	try {
		const t = await telnet.command('gettime', 600);
		const m = t.join(' ').match(/Day\s+(\d+),\s*(\d+:\d+)/i);
		if (m) {
			game.day = Number(m[1]);
			game.time = m[2];
		}
		game.players = parsePlayers(await telnet.command('listplayers', 600));
		game.updated = Date.now();
	} catch {
		/* nästa varv försöker vi igen */
	}
}
setInterval(refreshGame, 10000);

// ------------------------------------------------------------------ serverconfig (XML)
const FIELDS = [
	{ key: 'ServerName', label: 'Servernamn', type: 'text' },
	{ key: 'ServerDescription', label: 'Beskrivning', type: 'text' },
	{ key: 'ServerPassword', label: 'Lösenord (tomt = öppen)', type: 'text' },
	{ key: 'ServerMaxPlayerCount', label: 'Max spelare', type: 'number' },
	{ key: 'ServerVisibility', label: 'Synlighet', type: 'select', options: [['2', 'Publik'], ['1', 'Bara vänner'], ['0', 'Dold']] },
	{ key: 'Language', label: 'Språk', type: 'text' },
	{ key: 'GameDifficulty', label: 'Svårighetsgrad', type: 'select', options: [['0', 'Scavenger'], ['1', 'Adventurer'], ['2', 'Nomad'], ['3', 'Warrior'], ['4', 'Survivalist'], ['5', 'Insane']] },
	{ key: 'PlayerKillingMode', label: 'PvP', type: 'select', options: [['0', 'Ingen PvP'], ['1', 'Bara allierade'], ['2', 'Bara främlingar'], ['3', 'Alla mot alla']] },
	{ key: 'BloodMoonFrequency', label: 'Horde var X:e natt', type: 'number' },
	{ key: 'BloodMoonEnemyCount', label: 'Zombies per spelare i horden', type: 'number' },
	{ key: 'DayNightLength', label: 'Minuter per speldygn', type: 'number' },
	{ key: 'MaxSpawnedZombies', label: 'Max zombies samtidigt', type: 'number' },
	{ key: 'LootAbundance', label: 'Loot-mängd (%)', type: 'number' },
	{ key: 'LootRespawnDays', label: 'Dagar tills loot fylls på', type: 'number' },
	{ key: 'XPMultiplier', label: 'XP (%)', type: 'number' },
	{ key: 'LandClaimCount', label: 'Land claims per spelare', type: 'number' }
];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const propRe = (k) => new RegExp(`(<property\\s+name="${k}"\\s+value=")([^"]*)(")`);

function readSettings() {
	const xml = fs.readFileSync(P.config, 'utf8');
	const values = {};
	for (const f of FIELDS) {
		const m = xml.match(propRe(f.key));
		values[f.key] = m ? unesc(m[2]) : '';
	}
	return { fields: FIELDS, values };
}

function writeSettings(values) {
	let xml = fs.readFileSync(P.config, 'utf8');
	fs.writeFileSync(P.config + '.bak', xml);
	for (const f of FIELDS) {
		if (!(f.key in values)) continue;
		let v = String(values[f.key]).trim();
		if (f.type === 'number' && !/^\d+$/.test(v)) throw new Error(`${f.label} måste vara ett heltal.`);
		if (f.type === 'select' && !f.options.some((o) => o[0] === v)) throw new Error(`Ogiltigt val för ${f.label}.`);
		if (propRe(f.key).test(xml)) xml = xml.replace(propRe(f.key), (_, a, _b, c) => a + esc(v) + c);
		else xml = xml.replace('</ServerSettings>', `\t<property name="${f.key}" value="${esc(v)}" />\n</ServerSettings>`);
	}
	fs.writeFileSync(P.config, xml);
	log('ok', 'Inställningarna sparade – gäller vid nästa start');
}

// ------------------------------------------------------------------ loggen
function newestLog() {
	try {
		const files = fs
			.readdirSync(P.logs)
			.filter((f) => f.endsWith('.txt'))
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
	const lines = text.split(/\r?\n/).filter(Boolean).slice(-1000);
	return { file: name, offset: start + used, lines, reset, mtime: st.mtimeMs };
}

// ------------------------------------------------------------------ uppdatering via SteamCMD
const job = { running: false, lines: [], ok: null, finishedAt: null };
async function runUpdate() {
	await probe();
	if (job.running) throw new Error('En uppdatering pågår redan.');
	if (state.running) throw new Error('Stoppa servern innan du uppdaterar.');
	if (!fs.existsSync(cfg.steamcmd)) throw new Error(`Hittar inte SteamCMD: ${cfg.steamcmd}`);
	Object.assign(job, { running: true, lines: [], ok: null, finishedAt: null });
	state.busy = 'updating';
	log('server', 'Uppdaterar servern via SteamCMD…');
	const p = spawn(cfg.steamcmd, ['+force_install_dir', P.server, '+login', 'anonymous', '+app_update', '294420', 'validate', '+quit'], { windowsHide: true });
	const onData = (d) => {
		for (const l of String(d).split(/\r?\n|\r/)) if (l.trim()) job.lines.push(l.trim());
		if (job.lines.length > 500) job.lines.splice(0, job.lines.length - 500);
	};
	p.stdout.on('data', onData);
	p.stderr.on('data', onData);
	p.on('close', () => {
		job.ok = job.lines.some((l) => /Success! App '294420'/.test(l));
		job.running = false;
		job.finishedAt = Date.now();
		state.busy = null;
		log(job.ok ? 'ok' : 'error', job.ok ? 'Servern är uppdaterad' : 'Uppdateringen misslyckades – se SteamCMD-utskriften');
	});
	p.on('error', (e) => {
		job.lines.push('FEL: ' + e.message);
		job.running = false;
		state.busy = null;
	});
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
		let serverName = '';
		let maxPlayers = '';
		let horde = 7;
		try {
			const s = readSettings().values;
			serverName = s.ServerName;
			maxPlayers = s.ServerMaxPlayerCount;
			horde = Number(s.BloodMoonFrequency) || 7;
		} catch {
			/* configen saknas */
		}
		const fresh = state.running && Date.now() - game.updated < 30000;
		const day = fresh ? game.day : null;
		return {
			installed: fs.existsSync(P.exe),
			running: state.running,
			pid: state.pid,
			busy: state.busy,
			telnet: telnet.connected,
			startedAt: state.startedAt,
			serverName,
			maxPlayers,
			day,
			time: fresh ? game.time : null,
			nextHorde: day ? Math.ceil(day / horde) * horde : null,
			players: fresh ? game.players : [],
			events: events.slice(-30)
		};
	},
	'POST /api/start': async () => (await startServer(), { ok: true }),
	'POST /api/stop': async () => (await stopServer(), { ok: true }),
	'POST /api/restart': async () => {
		restartServer().catch((e) => log('error', e.message));
		return { ok: true };
	},
	'GET /api/log': async (q) => readLog(q.get('file'), Number(q.get('offset') ?? -1)),
	'POST /api/command': async (_q, body) => {
		const cmd = String(body.cmd || '').trim();
		if (!cmd) throw new Error('Tomt kommando.');
		log('cmd', cmd);
		return { lines: await telnet.command(cmd, 900) };
	},
	'POST /api/player': async (_q, body) => {
		const id = body.platformId || body.entityId;
		if (!idOk(id)) throw new Error('Ogiltigt spelar-id.');
		const reason = String(body.reason || '').replace(/"/g, "'").slice(0, 100);
		let cmd;
		if (body.action === 'kick') cmd = `kick ${id} "${reason || 'Kickad av admin'}"`;
		else if (body.action === 'ban') cmd = `ban add ${id} 10 years "${reason || 'Bannad av admin'}"`;
		else if (body.action === 'admin') cmd = `admin add ${id} 0`;
		else throw new Error('Okänd åtgärd.');
		log('cmd', cmd);
		return { lines: await telnet.command(cmd, 900) };
	},
	'GET /api/settings': async () => readSettings(),
	'POST /api/settings': async (_q, body) => (writeSettings(body.values || {}), { ok: true, running: state.running }),
	'POST /api/update': async () => (await runUpdate(), { ok: true }),
	'GET /api/update': async () => job
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
server.listen(cfg.port, '127.0.0.1', () => {
	log('ok', `Panelen startade på http://127.0.0.1:${cfg.port}`);
	console.log(`Gamla Skolan 7DTD-panel: http://127.0.0.1:${cfg.port}`);
});
