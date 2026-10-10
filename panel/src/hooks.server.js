import { startMonitor } from '$lib/server/server.js';
import { getSettings, readGslt } from '$lib/server/settings.js';
import { log } from '$lib/server/events.js';

getSettings();
readGslt(); // sparar en egen kopia av GSLT-token direkt
startMonitor();
log('ok', 'Panelen startade');

export async function handle({ event, resolve }) {
	// Panelen ska bara nås från den egna datorn.
	const host = event.request.headers.get('host') || '';
	if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
		return new Response('Endast lokal åtkomst', { status: 403 });
	}
	return resolve(event);
}
