// Panelens egen händelselogg (start, stopp, uppdateringar, fel) som visas i gränssnittet.
const events = [];
let seq = 0;

export function log(kind, text) {
	events.push({ id: ++seq, t: Date.now(), kind, text });
	if (events.length > 300) events.shift();
	console.log(`[${kind}] ${text}`);
}

export function getEvents(since = 0) {
	return events.filter((e) => e.id > since);
}
