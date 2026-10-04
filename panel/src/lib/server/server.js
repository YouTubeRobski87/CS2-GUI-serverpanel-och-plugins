// Start/stopp, lägesbyte och övervakning av CS2-servern.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { getSettings, paths, readGslt } from './settings.js';
import { bridgeAlive, send } from './bridge.js';
import { log } from './events.js';

const isWin = process.platform === 'win32';

// ---------------- övervakning ----------------
const state = {
	running: false,
	pid: null,
	startedAt: null,
	commandLine: '',
	memBytes: 0,
	cpuPercent: 0,
	mariadb: false,
	busy: null, // 'starting' | 'stopping' | 'updating' | null
	lastError: null,
	system: { cpuPercent: 0, memUsed: 0, memTotal: os.totalmem() },
	history: [] // [{t, cpu, mem}]
};

let lastProcCpu = null; // {t, cpuSec}
let lastSysCpu = null;

function sysCpuSample() {
	const cpus = os.cpus();
	let idle = 0,
		total = 0;
	for (const c of cpus) {
		for (const v of Object.values(c.times)) total += v;
		idle += c.times.idle;
	}
	return { idle, total };
}

function ps(script) {
	return new Promise((resolve) => {
		execFile(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
			{ windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
			(err, stdout) => resolve(err ? null : stdout)
		);
	});
}

async function probe() {
	// systemets CPU/RAM
	const s = sysCpuSample();
	if (lastSysCpu) {
		const dt = s.total - lastSysCpu.total;
		const di = s.idle - lastSysCpu.idle;
		state.system.cpuPercent = dt > 0 ? Math.round((1 - di / dt) * 1000) / 10 : 0;
	}
	lastSysCpu = s;
	state.system.memTotal = os.totalmem();
	state.system.memUsed = os.totalmem() - os.freemem();

	if (process.env.GSP_DEMO) {
		// Endast för test utanför Windows: låtsas att servern kör.
		Object.assign(state, { running: true, pid: 4242, startedAt: new Date(Date.now() - 3723000).toISOString(), memBytes: 1.7e9, cpuPercent: 6 + Math.round(Math.random() * 40) / 10 });
		return;
	}
	if (!isWin) return;
	const out = await ps(
		"$p = Get-CimInstance Win32_Process -Filter \"Name='cs2.exe'\" | Where-Object { $_.CommandLine -match '-dedicated' } | Select-Object -First 1;" +
			"$m = [bool](Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue);" +
			"if ($p) { [pscustomobject]@{ pid=$p.ProcessId; created=$p.CreationDate.ToString('o'); cmd=$p.CommandLine; ws=$p.WorkingSetSize; cpu=($p.KernelModeTime + $p.UserModeTime)/1e7; mariadb=$m } | ConvertTo-Json -Compress }" +
			" else { [pscustomobject]@{ pid=$null; mariadb=$m } | ConvertTo-Json -Compress }"
	);
	if (!out) return;
	let j;
	try {
		j = JSON.parse(out.trim());
	} catch {
		return;
	}
	state.mariadb = !!j.mariadb;
	if (j.pid) {
		const now = Date.now();
		if (lastProcCpu && lastProcCpu.pid === j.pid) {
			const dCpu = j.cpu - lastProcCpu.cpuSec;
			const dT = (now - lastProcCpu.t) / 1000;
			state.cpuPercent = dT > 0 ? Math.max(0, Math.round((dCpu / dT / os.cpus().length) * 1000) / 10) : 0;
		}
		lastProcCpu = { pid: j.pid, t: now, cpuSec: j.cpu };
		state.running = true;
		state.pid = j.pid;
		state.startedAt = j.created;
		state.commandLine = (j.cmd || '').replace(/(sv_setsteamaccount\s+)"?[A-Fa-f0-9]+"?/i, '$1<dold>');
		state.memBytes = j.ws;
	} else {
		state.running = false;
		state.pid = null;
		state.startedAt = null;
		state.memBytes = 0;
		state.cpuPercent = 0;
		lastProcCpu = null;
	}
}

let loopStarted = false;
// Lägesbyte som spelarna röstat fram i spelet (pluginet GamlaSkolanLage skriver
// data/gs_panel/requests/mode.json). Panelen startar då om servern i det nya läget.
let handlingRequest = false;
function checkModeRequest() {
	if (handlingRequest || state.busy) return;
	const file = path.join(paths().css, 'data', 'gs_panel', 'requests', 'mode.json');
	let req;
	try {
		req = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
	} catch {
		return;
	}
	try {
		fs.unlinkSync(file);
	} catch {
		/* */
	}
	const modes = getSettings().modes;
	if (!req?.mode || !modes[req.mode]) {
		log('warn', `Okänt läge i omröstningen: ${req?.mode}`);
		return;
	}
	if (req.t && Date.now() - new Date(req.t).getTime() > 2 * 60 * 1000) return; // för gammal
	if (!state.running || req.mode === currentMode()) return;
	handlingRequest = true;
	log('mode', `Spelarna röstade för ${modes[req.mode].name} – servern startar om i det läget`);
	restartServer(req.mode)
		.catch((e) => log('error', `Lägesbytet misslyckades: ${e.message}`))
		.finally(() => (handlingRequest = false));
}

export function startMonitor() {
	if (loopStarted) return;
	loopStarted = true;
	const tick = async () => {
		try {
			await probe();
			checkModeRequest();
			state.history.push({
				t: Date.now(),
				cpu: state.system.cpuPercent,
				mem: state.system.memUsed,
				srvCpu: state.cpuPercent,
				srvMem: state.memBytes
			});
			if (state.history.length > 120) state.history.shift();
		} catch (e) {
			console.error(e);
		}
		setTimeout(tick, 3000);
	};
	tick();
}

export function getState() {
	return { ...state, mode: currentMode(), modes: modeList() };
}

// ---------------- lägen ----------------
function modeList() {
	const m = getSettings().modes;
	return Object.entries(m).map(([id, v]) => ({ id, name: v.name, description: v.description, maps: v.maps || [] }));
}

function exists(p) {
	try {
		fs.accessSync(p);
		return true;
	} catch {
		return false;
	}
}

export function currentMode() {
	const P = paths();
	const modes = getSettings().modes;
	for (const [id, m] of Object.entries(modes)) {
		const allOn = m.enable.every((rel) => exists(path.join(P.css, rel)));
		const allOff = m.disable.every((rel) => !exists(path.join(P.css, rel)));
		if (allOn && allOff) return id;
	}
	return null;
}

function stamp() {
	return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

// Var en avstängd plugin kan ligga. Panelen flyttar själv till _panel_disabled,
// men tittar även i dina gamla mappar så att lägesbytet fungerar direkt.
function findDisabled(rel) {
	const P = paths();
	const name = path.basename(rel);
	const candidates = [
		path.join(P.panelDisabled, rel),
		path.join(P.root, '_disabled_for_classic_dm', name),
		path.join(P.root, '_disabled_mods', name)
	];
	for (const c of candidates) if (exists(c)) return { dir: c, copy: false };
	// sista utväg: kopiera från backupen som gjordes när classic DM sattes upp
	try {
		const backups = fs
			.readdirSync(P.root)
			.filter((d) => d.startsWith('_backup_final_classic_dm') || d.startsWith('_backup_before_classic_dm'))
			.sort()
			.reverse();
		for (const b of backups) {
			const sub = rel.startsWith('shared/') ? 'css_shared' : 'css_plugins';
			const c = path.join(P.root, b, sub, name);
			if (exists(c)) return { dir: c, copy: true };
		}
	} catch {
		/* ingen backup */
	}
	return null;
}

function moveDir(from, to) {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	if (exists(to)) fs.renameSync(to, `${to}.old-${stamp()}`);
	fs.renameSync(from, to);
}

export function applyMode(id) {
	const mode = getSettings().modes[id];
	if (!mode) throw new Error(`Okänt läge: ${id}`);
	if (state.running) throw new Error('Stoppa servern innan du byter läge.');
	const P = paths();
	const changes = [];
	for (const rel of mode.disable) {
		const live = path.join(P.css, rel);
		if (exists(live)) {
			moveDir(live, path.join(P.panelDisabled, rel));
			changes.push(`Stängde av ${rel}`);
		}
	}
	for (const rel of mode.enable) {
		const live = path.join(P.css, rel);
		if (exists(live)) continue;
		const src = findDisabled(rel);
		if (!src) throw new Error(`Hittar inte ${rel} någonstans – kan inte slå på läget ${mode.name}.`);
		if (src.copy) fs.cpSync(src.dir, live, { recursive: true });
		else moveDir(src.dir, live);
		changes.push(`Slog på ${rel}`);
	}
	log('mode', `Läge: ${mode.name}${changes.length ? ' – ' + changes.join(', ') : ''}`);
	return changes;
}

// Samma sak som repair_metamod.ps1: se till att Metamod-raden finns i gameinfo.gi efter uppdateringar.
export function repairMetamod() {
	const file = paths().gameinfo;
	if (!exists(file)) return false;
	let txt = fs.readFileSync(file, 'utf8');
	if (txt.includes('csgo/addons/metamod')) return false;
	const next = txt.replace(/(Game_LowViolence\s+csgo_lv[^\r\n]*)/, '$1\r\n\t\t\tGame\t\tcsgo/addons/metamod');
	if (next === txt) return false;
	fs.writeFileSync(file, next, 'utf8');
	log('server', 'Lade tillbaka Metamod-raden i gameinfo.gi');
	return true;
}

function startMariaDb() {
	const bat = getSettings().mariadbBat;
	if (!exists(bat)) return Promise.resolve(false);
	return new Promise((resolve) => {
		const p = spawn('cmd.exe', ['/c', bat], { windowsHide: true });
		p.on('exit', (code) => resolve(code === 0));
		p.on('error', () => resolve(false));
	});
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

export async function startServer(modeId) {
	if (state.busy) throw new Error('Panelen håller redan på med något – vänta lite.');
	await probe();
	if (state.running) throw new Error('Servern körs redan.');
	const s = getSettings();
	const id = modeId || currentMode() || s.defaultMode;
	const mode = s.modes[id];
	if (!mode) throw new Error(`Okänt läge: ${id}`);
	const gslt = readGslt();
	if (!gslt) throw new Error('Hittade ingen GSLT-token (sv_setsteamaccount) i dina startfiler.');
	const P = paths();
	if (!exists(P.exe)) throw new Error(`Hittar inte ${P.exe}`);

	state.busy = 'starting';
	state.lastError = null;
	try {
		applyMode(id);
		repairMetamod();
		if (mode.mariadb) {
			log('server', 'Startar MariaDB…');
			const ok = await startMariaDb();
			if (!ok) log('warn', 'MariaDB startade inte – K4-Arenas kan inte spara vapenval.');
		}
		let args = mode.args.replace('{port}', String(s.port)).replace('{gslt}', gslt);
		// Starta i ett eget konsolfönster, precis som bat-filerna. Panelen kan stängas utan att servern dör.
		const cmdline = `/c start "Gamla Skolan CS2 - ${mode.name}" /D "${P.bin}" cs2.exe ${args}`;
		const child = spawn('cmd.exe', [cmdline], {
			windowsVerbatimArguments: true,
			detached: true,
			stdio: 'ignore',
			windowsHide: false
		});
		child.unref();
		log('server', `Startar servern i läget ${mode.name}…`);
		for (let i = 0; i < 20; i++) {
			await sleep(1500);
			await probe();
			if (state.running) break;
		}
		if (!state.running) throw new Error('Servern startade inte – kolla konsolfönstret som öppnades.');
		log('ok', `Servern är igång (PID ${state.pid})`);
	} catch (e) {
		state.lastError = e.message;
		log('error', e.message);
		throw e;
	} finally {
		state.busy = null;
	}
}

export async function stopServer() {
	if (state.busy === 'stopping') return;
	await probe();
	if (!state.running) return;
	state.busy = 'stopping';
	try {
		log('server', 'Stoppar servern…');
		try {
			if (bridgeAlive()) await send({ type: 'exec', command: 'quit' }, 2500);
		} catch {
			/* faller tillbaka på taskkill */
		}
		for (let i = 0; i < 10; i++) {
			await sleep(1000);
			await probe();
			if (!state.running) break;
		}
		if (state.running && state.pid) {
			await new Promise((r) => execFile('taskkill', ['/PID', String(state.pid), '/T', '/F'], { windowsHide: true }, () => r()));
			await sleep(1500);
			await probe();
		}
		if (state.running) throw new Error('Kunde inte stoppa servern.');
		log('ok', 'Servern är stoppad');
	} finally {
		state.busy = null;
	}
}

export async function restartServer(modeId) {
	const mode = modeId || currentMode();
	await stopServer();
	await sleep(1000);
	await startServer(mode);
}

export function setBusy(v) {
	state.busy = v;
}
export function isRunning() {
	return state.running;
}
export { probe };
