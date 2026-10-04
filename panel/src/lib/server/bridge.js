// Filbryggan till pluginet GamlaSkolanPanelBridge. Ersätter CS2:s RCON, som både tappar svar
// och får servern att frysa i flera sekunder per kommando.
//
//   counterstrikesharp/data/gs_panel/status.json      <- skrivs av pluginet varje sekund
//   counterstrikesharp/data/gs_panel/commands/<id>.json -> panelens kommandon
//   counterstrikesharp/data/gs_panel/results/<id>.json  <- pluginets svar
//
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, L } from './settings.js';

function dirs() {
	const base = path.join(paths().css, 'data', 'gs_panel');
	return { base, status: path.join(base, 'status.json'), cmd: path.join(base, 'commands'), res: path.join(base, 'results') };
}

// Är bryggan igång? (status.json uppdaterad de senaste sekunderna)
export function bridgeAlive(maxAgeMs = 5000) {
	try {
		return Date.now() - fs.statSync(dirs().status).mtimeMs < maxAgeMs;
	} catch {
		return false;
	}
}

export function readStatus() {
	try {
		return { ...JSON.parse(fs.readFileSync(dirs().status, 'utf8')), bridge: true };
	} catch {
		return null;
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function send(cmd, timeoutMs = 4000) {
	const d = dirs();
	if (!bridgeAlive()) throw new Error(L('Bryggpluginet svarar inte – starta om servern från panelen så laddas det.', 'The bridge plugin is not responding – restart the server from the panel to load it.'));
	fs.mkdirSync(d.cmd, { recursive: true });
	const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
	const tmp = path.join(d.cmd, `${id}.tmp`);
	fs.writeFileSync(tmp, JSON.stringify({ id, ...cmd }), 'utf8');
	fs.renameSync(tmp, path.join(d.cmd, `${id}.json`));
	const resFile = path.join(d.res, `${id}.json`);
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		await sleep(120);
		try {
			const r = JSON.parse(fs.readFileSync(resFile, 'utf8'));
			try {
				fs.unlinkSync(resFile);
			} catch {
				/* */
			}
			if (!r.ok) throw new Error(r.msg || L('Kommandot misslyckades', 'The command failed'));
			return r.msg;
		} catch (e) {
			if (e instanceof SyntaxError || e.code === 'ENOENT') continue;
			throw e;
		}
	}
	throw new Error(L('Servern svarade inte på kommandot i tid.', 'The server did not answer the command in time.'));
}

// CS2 låter inte plugins läsa serverkonsolen, så vanliga kommandon svarar med "Kört"
// (eller cvarens nya värde). "status" och "css_plugins list" besvaras från bryggans statusfil.
function statusText() {
	const st = readStatus();
	if (!st) return L('Ingen status från servern.', 'No status from the server.');
	const out = [`Karta: ${st.map}   Spelare: ${st.players.filter((p) => !p.bot).length} + ${st.players.filter((p) => p.bot).length} bottar / ${st.maxPlayers}`, ''];
	out.push('slot  lag   K/D       ping  namn');
	for (const p of st.players)
		out.push(`${String(p.slot).padEnd(5)} ${p.team.padEnd(5)} ${`${p.kills}/${p.deaths}`.padEnd(9)} ${String(p.bot ? 'BOT' : p.ping).padEnd(5)} ${p.name}${p.steamid ? `  (${p.steamid})` : ''}`);
	if (!st.players.length) out.push('(ingen inne)');
	return out.join('\n');
}

function pluginsText() {
	const list = readStatus()?.plugins ?? [];
	if (!list.length) return 'Inga plugins rapporterade.';
	return list.map((p) => `[#${p.id}:${p.state}] ${p.name} (${p.version})${p.author ? ` av ${p.author}` : ''}`).join('\n');
}

export async function exec(command) {
	const c = String(command).trim();
	if (/^status$/i.test(c)) return statusText();
	if (/^css_plugins\s+list$/i.test(c) || /^meta\s+list$/i.test(c)) return pluginsText();
	const r = await send({ type: 'exec', command: c });
	return r === 'Kort' ? L('✓ Kört på servern', '✓ Ran on the server') : r;
}
