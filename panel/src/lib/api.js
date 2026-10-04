import { t } from './i18n.svelte.js';

export async function api(path, body) {
	const res = await fetch(`/api/${path}`, body === undefined ? undefined : {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await res.json().catch(() => ({ ok: false, error: t('Ogiltigt svar', 'Invalid response') }));
	if (!res.ok || data?.ok === false) throw new Error(data?.error || t(`Fel ${res.status}`, `Error ${res.status}`));
	return data;
}

export function fmtBytes(b) {
	if (!b) return '0 MB';
	const gb = b / 1024 ** 3;
	return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;
}

export function fmtDuration(ms) {
	if (!ms || ms < 0) return '–';
	const s = Math.floor(ms / 1000);
	const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
	if (d) return `${d}d ${h}h`;
	if (h) return `${h}h ${m}m`;
	return `${m}m ${s % 60}s`;
}

// CS2-färgkoder i chattmeddelanden → HTML-färger för förhandsvisning.
export const CHAT_COLORS = {
	default: '#ffffff', white: '#ffffff', darkred: '#ff0000', red: '#ff4040', green: '#40ff40',
	lime: '#a2ff47', lightgreen: '#99ff99', yellow: '#ece423', gold: '#e4ae39', orange: '#e4ae39',
	blue: '#5e98d9', lightblue: '#99ccff', purple: '#be6eff', grey: '#b0c3d9'
};

export function chatPreview(text) {
	const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
	let html = '';
	let color = CHAT_COLORS.default;
	for (const part of text.split(/(\{\w+\})/)) {
		const m = part.match(/^\{(\w+)\}$/);
		if (m && CHAT_COLORS[m[1]]) color = CHAT_COLORS[m[1]];
		else if (part) html += `<span style="color:${color}">${esc(part)}</span>`;
	}
	return html;
}
