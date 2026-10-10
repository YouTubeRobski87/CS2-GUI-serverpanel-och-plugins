// Läser serverns loggfiler som en levande konsol.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './settings.js';

function newest(dir, filter) {
	try {
		const files = fs
			.readdirSync(dir)
			.filter(filter)
			.map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs, size: fs.statSync(path.join(dir, f)).size }))
			.filter((x) => x.size > 600) // hoppa över tomma "log started"-filer
			.sort((a, b) => b.t - a.t);
		return files[0] ? path.join(dir, files[0].f) : null;
	} catch {
		return null;
	}
}

const SOURCES = {
	server: () => newest(paths().logs, (f) => f.endsWith('.log')),
	plugins: () => newest(paths().cssLogs, (f) => f.startsWith('log-all') && f.endsWith('.txt')),
	console: () => {
		const f = path.join(paths().csgo, 'console.log');
		return fs.existsSync(f) ? f : null;
	}
};

// Returnerar nya rader sedan "offset" i aktuell fil. Byter fil automatiskt när servern skapar en ny logg.
export function readConsole(source = 'server', file = null, offset = -1) {
	const pick = SOURCES[source] || SOURCES.server;
	const current = pick();
	if (!current) return { file: null, offset: 0, lines: [], reset: true };
	const name = path.basename(current);
	let reset = false;
	if (name !== file || offset < 0) {
		reset = true;
		offset = -1;
	}
	const size = fs.statSync(current).size;
	let start = offset;
	if (start < 0 || start > size) start = Math.max(0, size - 24 * 1024);
	const len = Math.min(size - start, 256 * 1024);
	let text = '';
	if (len > 0) {
		const fd = fs.openSync(current, 'r');
		const buf = Buffer.alloc(len);
		fs.readSync(fd, buf, 0, len, start);
		fs.closeSync(fd);
		text = buf.toString('utf8');
	}
	// Klipp bort en halv rad i början om vi började mitt i filen.
	if (reset && start > 0) text = text.slice(text.indexOf('\n') + 1);
	// Spara en ofullständig sista rad till nästa gång.
	const lastNl = text.lastIndexOf('\n');
	let consumed = len;
	if (lastNl >= 0 && lastNl < text.length - 1) {
		const tail = Buffer.byteLength(text.slice(lastNl + 1), 'utf8');
		consumed -= tail;
		text = text.slice(0, lastNl + 1);
	}
	const lines = text
		.split(/\r?\n/)
		.filter((l) => l.length)
		.slice(-800);
	return { file: name, offset: start + consumed, lines, reset };
}
