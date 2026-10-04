// Source RCON över TCP. CS2:s rcon-kommando i spelkonsolen är trasigt, men själva
// protokollet fungerar utifrån – precis som ditt gamla Python-skript använde det.
//
// CS2:s RCON tål dåligt att man öppnar många nya anslutningar tätt efter varandra,
// så panelen skickar kommandona ett i taget, i kö, med en kort paus mellan anslutningarna.
import net from 'node:net';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { getSettings, readRconPassword } from './settings.js';

const AUTH = 3;
const EXEC = 2;

function packet(id, type, body) {
	const b = Buffer.from(body, 'utf8');
	const buf = Buffer.alloc(14 + b.length);
	buf.writeInt32LE(10 + b.length, 0);
	buf.writeInt32LE(id, 4);
	buf.writeInt32LE(type, 8);
	b.copy(buf, 12);
	buf.writeInt16LE(0, 12 + b.length);
	return buf;
}

// Servern lyssnar ibland bara på en viss adress, inte 127.0.0.1. Kolla netstat som Python-skriptet gjorde.
function findHosts() {
	const port = getSettings().port;
	return new Promise((resolve) => {
		const hosts = new Set(['127.0.0.1']);
		const done = () => {
			for (const list of Object.values(os.networkInterfaces()))
				for (const a of list || []) if (a.family === 'IPv4' && !a.internal) hosts.add(a.address);
			resolve([...hosts]);
		};
		if (process.platform !== 'win32') return done();
		execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true }, (err, out) => {
			if (!err) {
				for (const line of out.split(/\r?\n/)) {
					if (line.includes(`:${port} `) && line.includes('LISTENING')) {
						const h = line.trim().split(/\s+/)[1].replace(/:\d+$/, '').replace(/[[\]]/g, '');
						if (h && h !== '0.0.0.0' && h !== '::') hosts.add(h);
					}
				}
			}
			done();
		});
	});
}

// ---------------- en ihållande anslutning ----------------
let conn = null; // { sock, host, authed, buf, onPacket }
let connecting = null;
let lastHost = null;
let lastErrors = [];

function openOn(host, password) {
	const port = getSettings().port;
	return new Promise((resolve, reject) => {
		const sock = net.createConnection({ host, port });
		const c = { sock, host, authed: false, buf: Buffer.alloc(0), onPacket: null };
		let settled = false;
		const fail = (msg) => {
			if (settled) return;
			settled = true;
			clearTimeout(t);
			sock.destroy();
			reject(new Error(msg));
		};
		const t = setTimeout(() => fail(c.connected ? 'anslöt men fick inget inloggningssvar' : 'ingen anslutning'), 3500);
		sock.setNoDelay(true);
		sock.on('connect', () => {
			c.connected = true;
			sock.write(packet(1, AUTH, password));
		});
		sock.on('error', (e) => fail(e.code === 'ECONNREFUSED' ? 'nekad' : e.message));
		sock.on('close', () => {
			if (conn === c) conn = null;
			fail('anslutningen stängdes');
			c.onPacket?.(null);
		});
		sock.on('data', (chunk) => {
			c.buf = Buffer.concat([c.buf, chunk]);
			while (c.buf.length >= 4) {
				const size = c.buf.readInt32LE(0);
				if (c.buf.length < size + 4) break;
				const id = c.buf.readInt32LE(4);
				const type = c.buf.readInt32LE(8);
				const body = c.buf.toString('utf8', 12, 4 + size - 2);
				c.buf = c.buf.subarray(size + 4);
				if (!c.authed) {
					if (type === 2) {
						if (id === -1) return fail('Fel RCON-lösenord');
						c.authed = true;
						settled = true;
						clearTimeout(t);
						resolve(c);
					}
				} else if (type === 0) {
					c.onPacket?.(body);
				}
			}
		});
	});
}

async function getConn() {
	if (conn && !conn.sock.destroyed) return conn;
	if (connecting) return connecting;
	connecting = (async () => {
		const password = readRconPassword();
		if (!password) throw new Error('Hittade inget rcon_password i server.cfg');
		const all = await findHosts();
		const hosts = lastHost ? [lastHost, ...all.filter((h) => h !== lastHost)] : all;
		const errors = [];
		for (const h of hosts) {
			try {
				const c = await openOn(h, password);
				lastHost = h;
				conn = c;
				lastErrors = [];
				return c;
			} catch (e) {
				errors.push(`${h}: ${e.message}`);
				if (e.message === 'Fel RCON-lösenord') throw e;
			}
		}
		lastErrors = errors;
		throw new Error(`RCON svarar inte (${errors.join(' · ')})`);
	})();
	try {
		return await connecting;
	} finally {
		connecting = null;
	}
}

// Kör ett kommando på anslutningen och samla svaret tills servern varit tyst en stund.
function execOn(c, command, timeoutMs) {
	return new Promise((resolve, reject) => {
		let out = '';
		let idle = null;
		const end = (err) => {
			clearTimeout(idle);
			clearTimeout(hard);
			c.onPacket = null;
			err ? reject(err) : resolve(out);
		};
		const hard = setTimeout(() => end(), timeoutMs);
		c.onPacket = (body) => {
			if (body === null) return end(out ? null : new Error('RCON-anslutningen bröts'));
			out += body;
			clearTimeout(idle);
			idle = setTimeout(() => end(), 300);
		};
		// Kommandon utan output: vänta en kort stund och returnera tomt.
		idle = setTimeout(() => end(), 3000);
		c.sock.write(packet(2, EXEC, command));
	});
}

// Kö så att bara ett kommando i taget går på anslutningen.
let chain = Promise.resolve();
let lastClose = 0;

export function rcon(command, timeoutMs = 4000) {
	const run = async () => {
		// CS2 svarar ibland bara på det första kommandot på en anslutning, så varje kommando
		// får en egen anslutning – men i kö och med paus emellan så att servern inte översvämmas.
		const wait = 250 - (Date.now() - lastClose);
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		const c = await getConn();
		try {
			return await execOn(c, command, Math.max(timeoutMs, 3500));
		} finally {
			conn = null;
			c.sock.end();
			setTimeout(() => c.sock.destroy(), 500);
			lastClose = Date.now();
		}
	};
	const p = chain.then(run, run);
	chain = p.catch(() => {});
	return p;
}

export function rconInfo() {
	return { connected: !!(conn && !conn.sock.destroyed), host: conn?.host ?? lastHost, lastErrors };
}
