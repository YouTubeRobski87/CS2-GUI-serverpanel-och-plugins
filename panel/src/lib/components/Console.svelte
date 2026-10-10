<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { api } from '$lib/api.js';
	import Icon from './Icon.svelte';
	import { t } from '$lib/i18n.svelte.js';

	let { st, ctx } = $props();

	let source = $state('server');
	let lines = $state([]);
	let file = $state(null);
	let hideHits = $state(true);
	let offset = -1;
	let filter = $state('');
	let cmd = $state('');
	let history = [];
	let hIdx = -1;
	let autoscroll = $state(true);
	let box;
	let timer;
	let sending = $state(false);

	const quick = () => [
		{ label: 'status', cmd: 'status' },
		{ label: 'Plugins', cmd: 'css_plugins list' },
		{ label: t('Starta om match', 'Restart match'), cmd: 'mp_restartgame 1' },
		{ label: t('Lägg till bott', 'Add bot'), cmd: 'bot_add' },
		{ label: t('Kicka bottar', 'Kick bots'), cmd: 'bot_kick' },
		{ label: t('Avsluta warmup', 'End warmup'), cmd: 'mp_warmup_end' }
	];

	async function poll() {
		try {
			const r = await api(`console?source=${source}&offset=${offset}${file ? `&file=${encodeURIComponent(file)}` : ''}`);
			if (r.reset) lines = [];
			file = r.file;
			offset = r.offset;
			if (r.lines.length) {
				lines = [...lines, ...r.lines.map((t) => ({ t, kind: classify(t) }))].slice(-1500);
				if (autoscroll) {
					await tick();
					box?.scrollTo({ top: box.scrollHeight });
				}
			}
		} catch {
			/* */
		}
	}

	function classify(t) {
		if (/GSPANEL|^> /.test(t)) return 'cmd';
		if (/" say(_team)? "/.test(t)) return 'chat';
		if (/ killed "/.test(t)) return 'kill';
		if (/ attacked "| purchased "| threw | assisted killing | blinded /.test(t)) return 'dim';
		if (/\[(ERROR|ERR|FATAL)\]|\b(error|exception|failed)\b/i.test(t)) return 'error';
		if (/\[WARN/i.test(t)) return 'warn';
		if (/connected|entered the game|disconnected/.test(t)) return 'join';
		if (/Loading map|Started map|changelevel/i.test(t)) return 'map';
		return '';
	}

	const colors = {
		cmd: 'text-amber-2',
		error: 'text-bad',
		warn: 'text-warn',
		chat: 'text-sky-300',
		kill: 'text-text',
		join: 'text-ok',
		map: 'text-amber',
		dim: 'text-dim',
		'': 'text-muted'
	};

	function switchSource(s) {
		source = s;
		file = null;
		offset = -1;
		lines = [];
		poll();
	}

	async function send(c = cmd) {
		const command = c.trim();
		if (!command) return;
		sending = true;
		history = [command, ...history.filter((h) => h !== command)].slice(0, 50);
		hIdx = -1;
		lines = [...lines, { t: `> ${command}`, kind: 'cmd' }];
		try {
			const r = await api('rcon', { command });
			const out = (r.output || '').trim();
			for (const l of (out || t('(inget svar)', '(no response)')).split(/\r?\n/)) lines = [...lines, { t: l, kind: 'cmd' }];
		} catch (e) {
			lines = [...lines, { t: t(`Fel: ${e.message}`, `Error: ${e.message}`), kind: 'error' }];
		} finally {
			sending = false;
			if (c === cmd) cmd = '';
			await tick();
			box?.scrollTo({ top: box.scrollHeight });
		}
	}

	function keydown(e) {
		if (e.key === 'ArrowUp' && history.length) {
			hIdx = Math.min(hIdx + 1, history.length - 1);
			cmd = history[hIdx];
			e.preventDefault();
		} else if (e.key === 'ArrowDown') {
			hIdx = Math.max(hIdx - 1, -1);
			cmd = hIdx >= 0 ? history[hIdx] : '';
			e.preventDefault();
		}
	}

	function onScroll() {
		if (!box) return;
		autoscroll = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
	}

	// Ta bort "L 10/03/2026 - " så att raderna blir lättare att läsa.
	const pretty = (t) => t.replace(/^L \d\d\/\d\d\/\d{4} - /, '').replace(/^\d{4}-\d\d-\d\d (\d\d:\d\d:\d\d)\.\d+ [+-]\d\d:\d\d /, '$1 ');

	let shown = $derived(
		lines.filter((l) => (!hideHits || l.kind !== 'dim') && (!filter || l.t.toLowerCase().includes(filter.toLowerCase())))
	);

	onMount(() => {
		poll();
		timer = setInterval(poll, 1500);
	});
	onDestroy(() => clearInterval(timer));
</script>

<div class="flex flex-col gap-4 h-[calc(100vh-9.5rem)] min-h-[480px]">
	<div class="flex flex-wrap items-center gap-3">
		<div class="flex rounded-lg border border-line-2 overflow-hidden">
			{#each [['server', t('Spellogg', 'Game log')], ['plugins', t('Pluginlogg', 'Plugin log')]] as [id, label]}
				<button class="px-4 py-2 text-sm font-display font-semibold {source === id ? 'bg-amber text-ink' : 'text-muted hover:text-text'}" onclick={() => switchSource(id)}>{label}</button>
			{/each}
		</div>
		<input class="input !w-56" placeholder={t('Filtrera…', 'Filter…')} bind:value={filter} />
		<label class="flex items-center gap-2 text-sm text-muted cursor-pointer">
			<input type="checkbox" bind:checked={hideHits} class="accent-amber-500" /> {t('Dölj träffar och köp', 'Hide hits and purchases')}
		</label>
		<span class="text-xs text-dim mono truncate">{file ?? t('ingen loggfil', 'no log file')}</span>
		{#if !autoscroll}
			<button class="btn btn-sm ml-auto" onclick={() => { autoscroll = true; box?.scrollTo({ top: box.scrollHeight }); }}>↓ {t('Till senaste', 'Jump to latest')}</button>
		{/if}
	</div>

	<div bind:this={box} onscroll={onScroll} class="card flex-1 overflow-auto p-4 mono text-[12.5px] leading-relaxed !bg-[#0a0908]">
		{#each shown as l}
			<div class="whitespace-pre-wrap break-all {colors[l.kind]}">{pretty(l.t)}</div>
		{:else}
			<div class="text-dim">
				{t('Väntar på loggrader… Skriv ett kommando nedan så visas svaret här.', 'Waiting for log lines… Type a command below and the response will appear here.')}
			</div>
		{/each}
	</div>

	<div class="flex flex-wrap gap-2">
		{#each quick() as q}
			<button class="btn btn-sm" disabled={!st.running || sending} onclick={() => send(q.cmd)}>{q.label}</button>
		{/each}
	</div>
	<form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); send(); }}>
		<div class="relative flex-1">
			<span class="absolute left-3 top-1/2 -translate-y-1/2 text-amber mono">›</span>
			<input class="input mono !pl-7" placeholder={st.running ? t('Serverkommando, t.ex. mp_timelimit 30 (↑ för historik)', 'Server command, e.g. mp_timelimit 30 (↑ for history)') : t('Servern är avstängd', 'Server is offline')} bind:value={cmd} onkeydown={keydown} disabled={!st.running} />
		</div>
		<button class="btn btn-primary" disabled={!st.running || sending || !cmd.trim()}><Icon name="send" class="size-4" /> {t('Skicka', 'Send')}</button>
	</form>
</div>
