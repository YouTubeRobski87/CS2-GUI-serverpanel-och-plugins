// CS2-uppdateringar via SteamCMD + koll mot Steam om en ny patch finns.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { getSettings, paths, L } from './settings.js';
import { isRunning, probe, setBusy, repairMetamod } from './server.js';
import { log } from './events.js';

export function installedVersion() {
	const P = paths();
	const out = { patch: null, buildId: null, versionDate: null, lastUpdated: null };
	try {
		const inf = fs.readFileSync(P.steamInf, 'utf8');
		out.patch = (inf.match(/PatchVersion=([\d.]+)/) || [])[1] || null;
		out.versionDate = (inf.match(/VersionDate=(.+)/) || [])[1]?.trim() || null;
	} catch {
		/* */
	}
	try {
		const acf = fs.readFileSync(P.manifest, 'utf8');
		out.buildId = (acf.match(/"buildid"\s+"(\d+)"/) || [])[1] || null;
		const lu = (acf.match(/"LastUpdated"\s+"(\d+)"/) || [])[1];
		out.lastUpdated = lu ? Number(lu) * 1000 : null;
	} catch {
		/* */
	}
	return out;
}

let checkCache = null;
export async function checkForUpdate(force = false) {
	if (!force && checkCache && Date.now() - checkCache.t < 10 * 60 * 1000) return checkCache.data;
	const v = installedVersion();
	let data = { ...v, upToDate: null, required: null, error: null };
	if (!v.patch) data.error = 'Hittade ingen steam.inf';
	else {
		try {
			const res = await fetch(
				`https://api.steampowered.com/ISteamApps/UpToDateCheck/v1/?appid=730&version=${encodeURIComponent(v.patch)}`,
				{ signal: AbortSignal.timeout(8000) }
			);
			const j = await res.json();
			data.upToDate = !!j?.response?.up_to_date;
			data.required = j?.response?.required_version ?? null;
		} catch (e) {
			data.error = L('Kunde inte fråga Steam: ', 'Could not reach Steam: ') + e.message;
		}
	}
	checkCache = { t: Date.now(), data };
	return data;
}

const job = { running: false, lines: [], startedAt: null, finishedAt: null, ok: null };

export function getJob() {
	return job;
}

export async function runUpdate({ validate = false } = {}) {
	if (job.running) throw new Error(L('En uppdatering pågår redan.', 'An update is already running.'));
	await probe();
	if (isRunning()) throw new Error(L('Stoppa servern innan du uppdaterar.', 'Stop the server before updating.'));
	const s = getSettings();
	if (!fs.existsSync(s.steamcmd)) throw new Error(L(`Hittar inte SteamCMD: ${s.steamcmd}`, `Cannot find SteamCMD: ${s.steamcmd}`));
	job.running = true;
	job.lines = [];
	job.startedAt = Date.now();
	job.finishedAt = null;
	job.ok = null;
	setBusy('updating');
	log('update', L('Startar uppdatering via SteamCMD…', 'Starting update via SteamCMD…'));
	const args = ['+force_install_dir', s.serverRoot, '+login', 'anonymous', '+app_update', '730'];
	if (validate) args.push('validate');
	args.push('+quit');
	const p = spawn(s.steamcmd, args, { windowsHide: true });
	const onData = (d) => {
		for (const line of d.toString('utf8').split(/\r?\n|\r/)) {
			const l = line.trim();
			if (l) job.lines.push(l);
		}
		if (job.lines.length > 600) job.lines.splice(0, job.lines.length - 600);
	};
	p.stdout.on('data', onData);
	p.stderr.on('data', onData);
	p.on('close', () => {
		const ok = job.lines.some((l) => /Success! App '730'/.test(l));
		job.running = false;
		job.finishedAt = Date.now();
		job.ok = ok;
		setBusy(null);
		checkCache = null;
		if (ok) {
			repairMetamod();
			log('ok', L('CS2-servern är uppdaterad', 'The CS2 server is up to date'));
		} else log('error', L('Uppdateringen misslyckades – se SteamCMD-loggen', 'The update failed – see the SteamCMD log'));
	});
	p.on('error', (e) => {
		job.lines.push('FEL: ' + e.message);
		job.running = false;
		job.ok = false;
		setBusy(null);
	});
	return true;
}
