<script>
	import { onMount, onDestroy } from 'svelte';
	import { api, fmtBytes, fmtDuration } from '$lib/api.js';
	import Icon from './Icon.svelte';
	import Spark from './Spark.svelte';

	let { st, live, update, ctx } = $props();

	let selectedMode = $state(null);
	let busy = $state(false);
	let say = $state('');
	let mapPick = $state('');
	let workshop = $state('');
	let events = $state([]);
	let lastEvent = 0;
	let evTimer;

	let mode = $derived(selectedMode ?? st.mode ?? st.modes[0]?.id);
	let modeInfo = $derived(st.modes.find((m) => m.id === mode));
	let activeMode = $derived(st.modes.find((m) => m.id === st.mode));
	let humans = $derived(live?.players?.filter((p) => !p.bot) ?? []);
	let bots = $derived(live?.players?.filter((p) => p.bot) ?? []);
	let hist = $derived(st.history ?? []);

	async function pollEvents() {
		try {
			const ev = await api(`events?since=${lastEvent}`);
			if (ev.length) {
				lastEvent = ev[ev.length - 1].id;
				events = [...events, ...ev].slice(-40);
			}
		} catch {
			/* */
		}
	}
	onMount(() => {
		pollEvents();
		evTimer = setInterval(pollEvents, 2500);
	});
	onDestroy(() => clearInterval(evTimer));

	async function act(path, body, okText) {
		busy = true;
		try {
			await api(path, body);
			if (okText) ctx.toast(okText);
			await ctx.refreshState();
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			busy = false;
		}
	}

	const start = () => act('start', { mode }, `Startar ${modeInfo?.name}…`);
	const stop = () => act('stop', {}, 'Servern är stoppad');
	const restart = () => act('restart', { mode }, mode !== st.mode ? `Startar om i läget ${modeInfo?.name}…` : 'Startar om servern…');

	async function sendSay() {
		if (!say.trim()) return;
		await act('say', { message: say }, 'Meddelandet skickat');
		say = '';
	}
	async function changeMap(m) {
		if (!m) return;
		await act('map', { map: m }, `Byter karta till ${m}…`);
		workshop = '';
	}

	const kindColor = { ok: 'text-ok', error: 'text-bad', warn: 'text-warn', update: 'text-amber', mode: 'text-amber' };
	const time = (t) => new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	let transitioning = $derived(!!st.busy);
</script>

<div class="space-y-6">
	<!-- huvudkort -->
	<section class="card p-6 md:p-7 relative overflow-hidden">
		<div class="absolute -right-10 -top-16 size-64 rounded-full bg-amber/5 blur-3xl pointer-events-none"></div>
		<div class="flex flex-col lg:flex-row lg:items-end gap-6 justify-between relative">
			<div>
				<div class="label mb-2">[Gamla Skolan] Server</div>
				<h1 class="font-display font-extrabold text-3xl md:text-4xl tracking-tight">
					{#if st.running}
						{activeMode?.name ?? 'Okänt läge'}
					{:else}
						Servern är avstängd
					{/if}
				</h1>
				<div class="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
					{#if st.running}
						<span class="flex items-center gap-2"><Icon name="map" class="size-4" /> <span class="mono text-text">{live?.map ?? '…'}</span></span>
						<span class="flex items-center gap-2"><Icon name="users" class="size-4" /> <span class="text-text">{humans.length}</span> spelare · {bots.length} bottar</span>
						<span class="flex items-center gap-2"><Icon name="clock" class="size-4" /> upp {fmtDuration(Date.now() - new Date(st.startedAt).getTime())}</span>
						<span class="mono text-dim">PID {st.pid}</span>
					{:else if st.lastError}
						<span class="text-bad flex items-center gap-2"><Icon name="alert" class="size-4" /> {st.lastError}</span>
					{:else}
						<span>Välj läge och tryck Starta.</span>
					{/if}
				</div>
			</div>
			<div class="flex flex-wrap gap-2.5">
				{#if !st.running}
					<button class="btn btn-primary !px-6 !py-3 !text-[15px]" disabled={busy || transitioning} onclick={start}>
						<Icon name="play" class="size-4" /> Starta {modeInfo?.name}
					</button>
				{:else}
					<button class="btn !px-5 !py-3" disabled={busy || transitioning} onclick={restart}>
						<Icon name="restart" class="size-4" /> {mode !== st.mode ? `Starta om som ${modeInfo?.name}` : 'Starta om'}
					</button>
					<button class="btn btn-danger !px-5 !py-3" disabled={busy || transitioning} onclick={stop}>
						<Icon name="stop" class="size-4" /> Stoppa
					</button>
				{/if}
			</div>
		</div>

		<!-- lägesväljare -->
		<div class="mt-6 grid sm:grid-cols-2 xl:grid-cols-3 gap-3 relative">
			{#each st.modes as m}
				<button
					onclick={() => (selectedMode = m.id)}
					class="text-left rounded-xl border p-4 transition-all {mode === m.id ? 'border-amber/70 bg-amber/[0.06]' : 'border-line hover:border-line-2 bg-ink/40'}"
				>
					<div class="flex items-center gap-2">
						<span class="size-3.5 rounded-full border-2 grid place-items-center {mode === m.id ? 'border-amber' : 'border-dim'}">
							{#if mode === m.id}<span class="size-1.5 rounded-full bg-amber"></span>{/if}
						</span>
						<span class="font-display font-bold tracking-wide">{m.name}</span>
						{#if st.mode === m.id}
							<span class="ml-auto label !text-[10px] !text-ok">{st.running ? 'Körs' : 'Aktiv'}</span>
						{/if}
					</div>
					<p class="text-sm text-muted mt-1.5 pl-5.5">{m.description}</p>
				</button>
			{/each}
		</div>
	</section>

	<!-- resurser -->
	<section class="grid grid-cols-2 xl:grid-cols-4 gap-4">
		{#each [
			{ label: 'Server CPU', value: st.running ? `${st.cpuPercent}%` : '–', series: hist.map((h) => h.srvCpu), max: 100, icon: 'cpu', color: '#f5a524' },
			{ label: 'Server RAM', value: st.running ? fmtBytes(st.memBytes) : '–', series: hist.map((h) => h.srvMem / 1024 ** 2), max: 1024, icon: 'memory', color: '#ffc35c' },
			{ label: 'Dator CPU', value: `${st.system.cpuPercent}%`, series: hist.map((h) => h.cpu), max: 100, icon: 'cpu', color: '#9b917f' },
			{ label: 'Dator RAM', value: `${fmtBytes(st.system.memUsed)} / ${fmtBytes(st.system.memTotal)}`, series: hist.map((h) => h.mem / 1024 ** 3), max: st.system.memTotal / 1024 ** 3, icon: 'memory', color: '#9b917f' }
		] as tile}
			<div class="card p-4 pb-2">
				<div class="flex items-center justify-between">
					<span class="label">{tile.label}</span>
					<Icon name={tile.icon} class="size-4 text-dim" />
				</div>
				<div class="num text-2xl font-bold mt-1.5">{tile.value}</div>
				<Spark values={tile.series} max={tile.max} color={tile.color} />
			</div>
		{/each}
	</section>

	<div class="grid lg:grid-cols-3 gap-6">
		<!-- spelare -->
		<section class="card p-5 lg:col-span-2">
			<div class="flex items-center justify-between mb-4">
				<h2 class="font-display font-bold tracking-wide">Spelare online</h2>
				<button class="btn btn-sm" onclick={() => ctx.go('players')}>Hantera</button>
			</div>
			{#if !st.running}
				<p class="text-muted text-sm">Servern är avstängd.</p>
			{:else if live?.reason === 'bridge'}
				<p class="text-sm text-warn">Bryggpluginet är inte igång än. Tryck <b>Starta om</b> så laddas det – sedan visas spelare, karta och statistik här.</p>
			{:else if !live?.players?.length}
				<p class="text-muted text-sm">Ingen inne just nu.</p>
			{:else}
				<div class="divide-y divide-line">
					{#each live.players.slice(0, 10) as p, i}
						<div class="flex items-center gap-3 py-2 text-sm">
							<span class="num w-5 text-dim">{i + 1}</span>
							<span class="w-9 text-[11px] font-display font-bold {p.team === 'CT' ? 'text-ct' : p.team === 'T' ? 'text-t' : 'text-dim'}">{p.team}</span>
							<span class="truncate {p.bot ? 'text-muted' : 'text-text font-medium'}">{p.name}</span>
							{#if p.bot}<span class="label !text-[9px] !tracking-wider px-1.5 py-0.5 rounded bg-panel-2">BOT</span>{/if}
							<span class="ml-auto num text-muted">{p.kills ?? '–'} / {p.deaths ?? '–'}</span>
							<span class="num w-14 text-right text-dim">{p.bot ? '' : `${p.ping} ms`}</span>
						</div>
					{/each}
				</div>

			{/if}
		</section>

		<!-- snabbåtgärder -->
		<section class="card p-5 space-y-5">
			<div>
				<div class="label mb-2">Byt karta</div>
				<div class="flex gap-2">
					<select class="input" bind:value={mapPick} disabled={!st.running}>
						<option value="">Välj karta…</option>
						{#each activeMode?.maps ?? [] as m}<option value={m}>{m}</option>{/each}
					</select>
					<button class="btn" disabled={!st.running || !mapPick || busy} onclick={() => changeMap(mapPick)}>Byt</button>
				</div>
				<div class="flex gap-2 mt-2">
					<input class="input" placeholder="Workshop-ID" bind:value={workshop} disabled={!st.running} />
					<button class="btn" disabled={!st.running || !workshop || busy} onclick={() => changeMap(workshop)}>Ladda</button>
				</div>
			</div>
			<div>
				<div class="label mb-2">Meddelande till alla</div>
				<form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); sendSay(); }}>
					<input class="input" placeholder="Skriv i chatten…" bind:value={say} disabled={!st.running} maxlength="200" />
					<button class="btn" disabled={!st.running || !say.trim() || busy}><Icon name="send" class="size-4" /></button>
				</form>
			</div>
			<div class="grid grid-cols-2 gap-2 text-sm">
				<button class="card !rounded-lg p-3 text-left hover:!border-amber/50 transition" onclick={() => ctx.go('update')}>
					<div class="label !text-[10px]">CS2-version</div>
					<div class="mt-1 font-medium {update?.upToDate === false ? 'text-warn' : update?.upToDate ? 'text-ok' : 'text-muted'}">
						{update?.upToDate === false ? 'Uppdatering finns' : update?.upToDate ? 'Senaste' : 'Okänd'}
					</div>
				</button>
				<div class="card !rounded-lg p-3">
					<div class="label !text-[10px]">MariaDB</div>
					<div class="mt-1 font-medium {st.mariadb ? 'text-ok' : 'text-muted'}">{st.mariadb ? 'Igång' : 'Av'}</div>
				</div>
			</div>
		</section>
	</div>

	<!-- händelser -->
	<section class="card p-5">
		<h2 class="font-display font-bold tracking-wide mb-3">Händelser</h2>
		{#if !events.length}
			<p class="text-sm text-muted">Inget har hänt sedan panelen startade.</p>
		{:else}
			<div class="space-y-1.5 max-h-56 overflow-auto pr-2">
				{#each [...events].reverse() as e (e.id)}
					<div class="flex gap-3 text-sm">
						<span class="mono text-dim text-xs pt-0.5">{time(e.t)}</span>
						<span class={kindColor[e.kind] ?? 'text-text'}>{e.text}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
