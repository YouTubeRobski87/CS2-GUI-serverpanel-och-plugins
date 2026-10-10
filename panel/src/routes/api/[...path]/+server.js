import { json } from '@sveltejs/kit';
import { getState, startServer, stopServer, restartServer, applyMode } from '$lib/server/server.js';
import { rcon } from '$lib/server/rcon.js';
import { bridgeAlive, exec, send } from '$lib/server/bridge.js';
import { readConsole } from '$lib/server/logs.js';
import { getEvents } from '$lib/server/events.js';
import { checkForUpdate, getJob, runUpdate, installedVersion } from '$lib/server/update.js';
import { getSettings, updateSettings, readRconPassword, paths, saveGslt, maskedGslt, saveMode, deleteMode, resetMode, BUILTIN_MODES, L } from '$lib/server/settings.js';
import {
	liveStatus, playerAction, pluginList, pluginAction, rankings,
	EDITABLE, titleOf, readPluginConfig, writePluginConfig, mapCycle, changeMap,
	setChatPrefix, syncPluginLanguage, setupCheck, readZombieConfig, writeZombieConfig
} from '$lib/server/game.js';

const fail = (e, status = 400) => json({ ok: false, error: e?.message || String(e) }, { status });

export async function GET({ params, url }) {
	try {
		switch (params.path) {
			case 'state':
				return json({ ok: true, ...getState(), bridge: bridgeAlive(), version: installedVersion(), lang: getSettings().lang, setup: setupCheck() });
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
				for (const name of Object.keys(EDITABLE)) out[name] = { title: titleOf(name), values: readPluginConfig(name) };
				return json(out);
			}
			case 'settings': {
				const s = getSettings();
				return json({
					serverRoot: s.serverRoot, steamcmd: s.steamcmd, mariadbBat: s.mariadbBat, port: s.port, defaultMode: s.defaultMode, lang: s.lang,
					gslt: maskedGslt(),
					checks: { gslt: !!maskedGslt(), rcon: !!readRconPassword(), dataDir: paths().dataDir },
					setup: setupCheck()
				});
			}
			case 'zombie':
				return json(readZombieConfig());
			case 'modes': {
				const s = getSettings();
				return json({ modes: s.modes, builtin: BUILTIN_MODES });
			}
			default:
				return fail(L('Okänd endpoint', 'Unknown endpoint'), 404);
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
				if (!cmd) return fail(L('Tomt kommando', 'Empty command'));
				// Via bryggan om den är igång, annars RCON som reserv (kan få CS2 att hacka).
				if (bridgeAlive()) return json({ ok: true, output: await exec(cmd), via: 'bridge' });
				return json({ ok: true, output: await rcon(cmd, 5000), via: 'rcon' });
			}
			case 'say': {
				const msg = String(body.message || '').replace(/["\r\n;]/g, '').slice(0, 200);
				await send({ type: 'say', arg: msg, command: String(readPluginConfig('GamlaSkolanLage').Prefix || '') });
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
			case 'settings': {
				const before = getSettings().lang;
				const next = updateSettings(body);
				if (next.lang !== before) await syncPluginLanguage();
				return json({ ok: true, lang: next.lang });
			}
			case 'gslt':
				saveGslt(body.token);
				return json({ ok: true, gslt: maskedGslt() });
			case 'prefix':
				return json({ ok: true, ...(await setChatPrefix(body.prefix)) });
			case 'zombie':
				return json({ ok: true, ...writeZombieConfig(body.values || {}) });
			case 'modes/save':
				return json({ ok: true, mode: saveMode(body.id, body.mode || {}) });
			case 'modes/delete':
				deleteMode(body.id);
				return json({ ok: true });
			case 'modes/reset':
				resetMode(body.id);
				return json({ ok: true });
			default:
				return fail(L('Okänd endpoint', 'Unknown endpoint'), 404);
		}
	} catch (e) {
		return fail(e);
	}
}
