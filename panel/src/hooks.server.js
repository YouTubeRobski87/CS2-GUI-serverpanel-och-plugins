import { startMonitor } from '$lib/server/server.js';
import { getSettings, readGslt } from '$lib/server/settings.js';
import { log } from '$lib/server/events.js';
import { syncPluginLanguage } from '$lib/server/game.js';

getSettings();
readGslt(); // sparar en egen kopia av GSLT-token direkt
startMonitor();
log('ok', getSettings().lang === 'sv' ? 'Panelen startade' : 'Panel started');
// Pluginens språk följer panelens. Kollas även med jämna mellanrum, eftersom pluginen skapar
// sina config-filer först när servern startat första gången.
const sync = () => syncPluginLanguage().catch(() => {});
setTimeout(sync, 3000);
setInterval(sync, 60 * 1000);

export async function handle({ event, resolve }) {
	// Panelen ska bara nås från den egna datorn.
	const host = event.request.headers.get('host') || '';
	if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
		return new Response('Local access only / Endast lokal åtkomst', { status: 403 });
	}
	return resolve(event);
}
