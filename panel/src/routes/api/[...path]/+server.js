import { json } from '@sveltejs/kit';
import { getState, startServer, stopServer, restartServer, applyMode } from '$lib/server/server.js';
import { rcon } from '$lib/server/rcon.js';
import { bridgeAlive, exec, send } from '$lib/server/bridge.js';
import { readConsole } from '$lib/server/logs.js';
import { getEvents } from '$lib/server/events.js';
import { checkForUpdate, getJob, runUpdate, installedVersion } from '$lib/server/update.js';
import { getSettings, updateSettings, readGslt, readRconPassword, paths } from '$lib/server/settings.js';
import {
	liveStatus, playerAction, pluginList, pluginAction, rankings,
	EDITABLE, readPluginConfig, writePluginConfig, mapCycle, changeMap
} from '$lib/server/game.js';

const fail = (e, status = 400) => json({ ok: false, error: e?.message || String(e) }, { status });

export async function GET({ params, url }) {
	try {
		switch (params.path) {
			case 'state':
				return json({ ok: true, ...getState(), bridge: bridgeAlive(), version: installedVersion() });
			case 'live':
				return json(await liveStatus());
			case 'console':
				return json(readConsole(url.searchParams.get('source') || 'server', url.searchParams.get('file'), Number(url.searchParams.get('offset') ?? -1)));
			case 'events':
				return json(getEvents(Number(url.searchParams.get('since') || 0)));
			case 'update/check':
				return json(await checkForUpdate(url.searchParams.get('force') === '1'));
			case 'update/job':
				return json(getJob());
			case 'plugins':
				return json(await pluginList());
			case 'rankings':
				return json(rankings());
			case 'maps':
				return json(mapCycle());
			case 'config': {
				const out = {};
				for (const [name, d] of Object.entries(EDITABLE)) out[name] = { title: d.title, values: readPluginConfig(name) };
				return json(out);
			}
			case 'settings': {
				const s = getSettings();
				return json({
					serverRoot: s.serverRoot, steamcmd: s.steamcmd, mariadbBat: s.mariadbBat, port: s.port, defaultMode: s.defaultMode,
					checks: { gslt: !!readGslt(), rcon: !!readRconPassword(), dataDir: paths().dataDir }
				});
			}
			default:
				return fail('Okänd endpoint', 404);
		}
	} catch (e) {
		return fail(e, 500);
	}
}

export async function POST({ params, request }) {
	let body = {};
	try { body = await request.json(); } catch { /* tom body */ }
	try {
		switch (params.path) {
			case 'start':
				startServer(body.mode).catch(() => {});
				return json({ ok: true });
			case 'stop':
				await stopServer();
				return json({ ok: true });
			case 'restart':
				restartServer(body.mode).catch(() => {});
				return json({ ok: true });
			case 'mode':
				return json({ ok: true, changes: applyMode(body.mode) });
			case 'rcon': {
				const cmd = String(body.command || '').trim();
				if (!cmd) return fail('Tomt kommando');
				// Via bryggan om den är igång, annars RCON som reserv (kan få CS2 att hacka).
				if (bridgeAlive()) return json({ ok: true, output: await exec(cmd), via: 'bridge' });
				return json({ ok: true, output: await rcon(cmd, 5000), via: 'rcon' });
			}
			case 'say': {
				const msg = String(body.message || '').replace(/["\r\n;]/g, '').slice(0, 200);
				await send({ type: 'say', arg: msg });
				return json({ ok: true });
			}
			case 'player':
				return json({ ok: true, output: await playerAction(body.action, body.slot, body) });
			case 'plugin':
				return json({ ok: true, output: await pluginAction(body.action, body.name) });
			case 'map':
				return json({ ok: true, output: await changeMap(body.map) });
			case 'update':
				await runUpdate({ validate: !!body.validate });
				return json({ ok: true });
			case 'config':
				return json({ ok: true, ...(await writePluginConfig(body.name, body.values || {})) });
			case 'settings':
				updateSettings(body);
				return json({ ok: true });
			default:
				return fail('Okänd endpoint', 404);
		}
	} catch (e) {
		return fail(e);
	}
}
