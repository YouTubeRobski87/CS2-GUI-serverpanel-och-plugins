<script>
	import { onMount, onDestroy } from 'svelte';
	import { api, fmtDuration } from '$lib/api.js';
	import Overview from '$lib/components/Overview.svelte';
	import Console from '$lib/components/Console.svelte';
	import Players from '$lib/components/Players.svelte';
	import Leaderboard from '$lib/components/Leaderboard.svelte';
	import Plugins from '$lib/components/Plugins.svelte';
	import Settings from '$lib/components/Settings.svelte';
	import Update from '$lib/components/Update.svelte';
	import Icon from '$lib/components/Icon.svelte';

	const tabs = [
		{ id: 'overview', label: 'Översikt', icon: 'grid' },
		{ id: 'console', label: 'Konsol', icon: 'terminal' },
		{ id: 'players', label: 'Spelare', icon: 'users' },
		{ id: 'leaderboard', label: 'Topplista', icon: 'trophy' },
		{ id: 'plugins', label: 'Plugins', icon: 'puzzle' },
		{ id: 'settings', label: 'Inställningar', icon: 'sliders' },
		{ id: 'update', label: 'Uppdatering', icon: 'download' }
	];

	let tab = $state('overview');
	let st = $state(null);
	let live = $state(null);
	let update = $state(null);
	let toasts = $state([]);
	let offline = $state(false);
	let timers = [];

	function toast(text, kind = 'ok') {
		const id = Math.random();
		toasts = [...toasts, { id, text, kind }];
		setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 4500);
	}

	async function refreshState() {
		try {
			st = await api('state');
			offline = false;
		} catch {
			offline = true;
		}
	}
	async function refreshLive() {
		if (!st?.running) {
			live = null;
			return;
		}
		try {
			live = await api('live');
		} catch {
			/* */
		}
	}
	async function refreshUpdate(force = false) {
		try {
			update = await api(`update/check${force ? '?force=1' : ''}`);
		} catch {
			/* */
		}
	}

	onMount(() => {
		try {
			const saved = localStorage.getItem('gs-tab');
			if (saved && tabs.some((t) => t.id === saved)) tab = saved;
		} catch {
			/* */
		}
		refreshState();
		refreshUpdate();
		timers.push(setInterval(refreshState, 2500));
		timers.push(setInterval(refreshLive, 8000));
		timers.push(setInterval(() => refreshUpdate(), 10 * 60 * 1000));
		setTimeout(refreshLive, 800);
	});
	onDestroy(() => timers.forEach(clearInterval));

	function go(id) {
		tab = id;
		try {
			localStorage.setItem('gs-tab', id);
		} catch {
			/* */
		}
	}

	let status = $derived(
		!st ? 'loading' : st.busy === 'starting' ? 'starting' : st.busy === 'stopping' ? 'stopping' : st.busy === 'updating' ? 'updating' : st.running ? 'online' : 'offline'
	);
	const statusText = { loading: 'Ansluter…', starting: 'Startar…', stopping: 'Stoppar…', updating: 'Uppdaterar…', online: 'Online', offline: 'Offline' };
	let humans = $derived(live?.players?.filter((p) => !p.bot).length ?? 0);
	let modeName = $derived(st?.modes?.find((m) => m.id === st?.mode)?.name ?? 'Okänt läge');

	const ctx = {
		toast,
		refreshState,
		refreshLive,
		refreshUpdate,
		go
	};
</script>

<div class="flex min-h-screen">
	<!-- sidomeny -->
	<aside class="hidden md:flex w-60 shrink-0 flex-col border-r border-line bg-panel/60 backdrop-blur sticky top-0 h-screen">
		<div class="px-5 pt-6 pb-5 border-b border-line">
			<div class="flex items-center gap-3">
				<div class="grid place-items-center size-10 rounded-xl bg-amber/10 border border-amber/40">
					<svg viewBox="0 0 64 64" class="size-7"><path d="M32 8 54 20v24L32 56 10 44V20z" fill="none" stroke="currentColor" stroke-width="4" class="text-amber" /><text x="32" y="40" font-family="Oxanium,Arial" font-weight="800" font-size="19" text-anchor="middle" fill="currentColor" class="text-amber">GS</text></svg>
				</div>
				<div>
					<div class="font-display font-extrabold tracking-wide text-[15px] leading-tight">GAMLA SKOLAN</div>
					<div class="label !text-[10px] !tracking-[0.2em]">CS2 Serverpanel</div>
				</div>
			</div>
		</div>
		<nav class="flex-1 p-3 space-y-1">
			{#each tabs as t}
				<button
					onclick={() => go(t.id)}
					class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-medium transition-colors {tab === t.id
						? 'bg-amber/10 text-amber-2 border border-amber/30'
						: 'text-muted hover:text-text hover:bg-panel-2 border border-transparent'}"
				>
					<Icon name={t.icon} class="size-[18px]" />
					{t.label}
					{#if t.id === 'update' && update && update.upToDate === false}
						<span class="ml-auto size-2 rounded-full bg-warn"></span>
					{/if}
					{#if t.id === 'players' && humans > 0}
						<span class="ml-auto num text-xs text-ok">{humans}</span>
					{/if}
				</button>
			{/each}
		</nav>
		<div class="p-4 border-t border-line text-xs text-dim space-y-1">
			<div>Patch <span class="num text-muted">{st?.version?.patch ?? '–'}</span></div>
			<div class="flex items-center gap-2">
				<span class="size-1.5 rounded-full {st?.mariadb ? 'bg-ok' : 'bg-dim'}"></span> MariaDB {st?.mariadb ? 'igång' : 'av'}
			</div>
		</div>
	</aside>

	<main class="flex-1 min-w-0">
		<!-- toppfält -->
		<header class="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur px-4 md:px-8 py-3.5 flex items-center gap-4 flex-wrap">
			<div class="flex items-center gap-3">
				<span
					class="size-2.5 rounded-full {status === 'online' ? 'bg-ok dot-live' : status === 'offline' ? 'bg-bad' : 'bg-warn animate-pulse'}"
				></span>
				<span class="font-display font-bold tracking-wide">{statusText[status]}</span>
				{#if st?.running}
					<span class="text-muted text-sm">· {modeName} · <span class="mono">{live?.map ?? '…'}</span> · {humans} spelare · upp {fmtDuration(Date.now() - new Date(st.startedAt).getTime())}</span>
				{/if}
			</div>
			<!-- mobilmeny -->
			<select class="input md:hidden !w-auto ml-auto" value={tab} onchange={(e) => go(e.currentTarget.value)}>
				{#each tabs as t}<option value={t.id}>{t.label}</option>{/each}
			</select>
			{#if update?.upToDate === false}
				<button class="ml-auto hidden md:inline-flex btn btn-sm !border-warn/60 !text-warn" onclick={() => go('update')}>
					<Icon name="download" class="size-4" /> Ny CS2-patch finns
				</button>
			{/if}
		</header>

		{#if offline}
			<div class="mx-4 md:mx-8 mt-4 card !border-bad/50 p-4 text-sm text-bad">Tappade kontakten med panelen. Körs fönstret "Gamla Skolan Panel" fortfarande?</div>
		{/if}

		<div class="p-4 md:p-8 max-w-[1400px]">
			{#if !st}
				<div class="text-muted">Laddar…</div>
			{:else if tab === 'overview'}
				<Overview {st} {live} {update} {ctx} />
			{:else if tab === 'console'}
				<Console {st} {ctx} />
			{:else if tab === 'players'}
				<Players {st} {live} {ctx} />
			{:else if tab === 'leaderboard'}
				<Leaderboard />
			{:else if tab === 'plugins'}
				<Plugins {st} {ctx} />
			{:else if tab === 'settings'}
				<Settings {st} {ctx} />
			{:else if tab === 'update'}
				<Update {st} {update} {ctx} />
			{/if}
		</div>
	</main>
</div>

<div class="fixed bottom-5 right-5 z-50 space-y-2 w-[min(380px,calc(100vw-2.5rem))]">
	{#each toasts as t (t.id)}
		<div class="card px-4 py-3 text-sm shadow-2xl {t.kind === 'error' ? '!border-bad/60 text-bad' : '!border-amber/40'}">{t.text}</div>
	{/each}
</div>
