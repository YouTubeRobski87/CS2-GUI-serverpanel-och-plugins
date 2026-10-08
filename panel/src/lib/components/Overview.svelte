<script>
	import { onMount, onDestroy } from 'svelte';
	import { api, fmtBytes, fmtDuration } from '$lib/api.js';
	import Icon from './Icon.svelte';
	import Spark from './Spark.svelte';
	import { t } from '$lib/i18n.svelte.js';

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

	const start = () => act('start', { mode }, t(`Startar ${modeInfo?.name}…`, `Starting ${modeInfo?.name}…`));
	const stop = () => act('stop', {}, t('Servern är stoppad', 'Server stopped'));
	const restart = () => act('restart', { mode }, mode !== st.mode ? t(`Startar om i läget ${modeInfo?.name}…`, `Restarting in ${modeInfo?.name} mode…`) : t('Startar om servern…', 'Restarting server…'));

	async function sendSay() {
		if (!say.trim()) return;
		await act('say', { message: say }, t('Meddelandet skickat', 'Message sent'));
		say = '';
	}
	async function changeMap(m) {
		if (!m) return;
		await act('map', { map: m }, t(`Byter karta till ${m}…`, `Changing map to ${m}…`));
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
				<div class="label mb-2">{t('CS2-server', 'CS2 server')}</div>
				<h1 class="font-display font-extrabold text-3xl md:text-4xl tracking-tight">
					{#if st.running}
						{activeMode?.name ?? t('Okänt läge', 'Unknown mode')}
					{:else}
						{t('Servern är avstängd', 'Server is offline')}
					{/if}
				</h1>
				<div class="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
					{#if st.running}
						<span class="flex items-center gap-2"><Icon name="map" class="size-4" /> <span class="mono text-text">{live?.map ?? '…'}</span></span>
						<span class="flex items-center gap-2"><Icon name="users" class="size-4" /> <span class="text-text">{humans.length}</span> {t('spelare', 'players')} · {bots.length} {t('bottar', 'bots')}</span>
						<span class="flex items-center gap-2"><Icon name="clock" class="size-4" /> {t('upp', 'up')} {fmtDuration(Date.now() - new Date(st.startedAt).getTime())}</span>
						<span class="mono text-dim">PID {st.pid}</span>
					{:else if st.lastError}
						<span class="text-bad flex items-center gap-2"><Icon name="alert" class="size-4" /> {st.lastError}</span>
					{:else}
						<span>{t('Välj läge och tryck Starta.', 'Choose a mode and press Start.')}</span>
					{/if}
				</div>
			</div>
			<div class="flex flex-wrap gap-2.5">
				{#if !st.running}
					<button class="btn btn-primary !px-6 !py-3 !text-[15px]" disabled={busy || transitioning} onclick={start}>
						<Icon name="play" class="size-4" /> {t('Starta', 'Start')} {modeInfo?.name}
					</button>
				{:else}
					<button class="btn !px-5 !py-3" disabled={busy || transitioning} onclick={restart}>
						<Icon name="restart" class="size-4" /> {mode !== st.mode ? t(`Starta om som ${modeInfo?.name}`, `Restart as ${modeInfo?.name}`) : t('Starta om', 'Restart')}
					</button>
					<button class="btn btn-danger !px-5 !py-3" disabled={busy || transitioning} onclick={stop}>
						<Icon name="stop" class="size-4" /> {t('Stoppa', 'Stop')}
					</button>
				{/if}
			</div>
		</div>

		<!-- lägesväljare -->
		<div class="mt-6 grid sm:grid-cols-2 xl:grid-cols-4 gap-3 relative">
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
							<span class="ml-auto label !text-[10px] !text-ok">{st.running ? t('Körs', 'Running') : t('Aktiv', 'Active')}</span>
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
			{ label: t('Dator CPU', 'Host CPU'), value: `${st.system.cpuPercent}%`, series: hist.map((h) => h.cpu), max: 100, icon: 'cpu', color: '#9b917f' },
			{ label: t('Dator RAM', 'Host RAM'), value: `${fmtBytes(st.system.memUsed)} / ${fmtBytes(st.system.memTotal)}`, series: hist.map((h) => h.mem / 1024 ** 3), max: st.system.memTotal / 1024 ** 3, icon: 'memory', color: '#9b917f' }
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
				<h2 class="font-display font-bold tracking-wide">{t('Spelare online', 'Players online')}</h2>
				<button class="btn btn-sm" onclick={() => ctx.go('players')}>{t('Hantera', 'Manage')}</button>
			</div>
			{#if !st.running}
				<p class="text-muted text-sm">{t('Servern är avstängd.', 'Server is offline.')}</p>
			{:else if live?.reason === 'bridge'}
				<p class="text-sm text-warn">{t('Bryggpluginet är inte igång än. Tryck', 'The bridge plugin is not running yet. Press')} <b>{t('Starta om', 'Restart')}</b> {t('så laddas det – sedan visas spelare, karta och statistik här.', 'to load it – players, map and stats will then show up here.')}</p>
			{:else if !live?.players?.length}
				<p class="text-muted text-sm">{t('Ingen inne just nu.', 'Nobody online right now.')}</p>
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
				<div class="label mb-2">{t('Byt karta', 'Change map')}</div>
				<div class="flex gap-2">
					<select class="input" bind:value={mapPick} disabled={!st.running}>
						<option value="">{t('Välj karta…', 'Choose map…')}</option>
						{#each activeMode?.maps ?? [] as m}{@const [label, id] = m.split('=')}<option value={id ?? m}>{label}</option>{/each}
					</select>
					<button class="btn" disabled={!st.running || !mapPick || busy} onclick={() => changeMap(mapPick)}>{t('Byt', 'Change')}</button>
				</div>
				<div class="flex gap-2 mt-2">
					<input class="input" placeholder={t('Workshop-ID', 'Workshop ID')} bind:value={workshop} disabled={!st.running} />
					<button class="btn" disabled={!st.running || !workshop || busy} onclick={() => changeMap(workshop)}>{t('Ladda', 'Load')}</button>
				</div>
			</div>
			<div>
				<div class="label mb-2">{t('Meddelande till alla', 'Message to all')}</div>
				<form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); sendSay(); }}>
					<input class="input" placeholder={t('Skriv i chatten…', 'Type in chat…')} bind:value={say} disabled={!st.running} maxlength="200" />
					<button class="btn" disabled={!st.running || !say.trim() || busy}><Icon name="send" class="size-4" /></button>
				</form>
			</div>
			<div class="grid grid-cols-2 gap-2 text-sm">
				<button class="card !rounded-lg p-3 text-left hover:!border-amber/50 transition" onclick={() => ctx.go('update')}>
					<div class="label !text-[10px]">{t('CS2-version', 'CS2 version')}</div>
					<div class="mt-1 font-medium {update?.upToDate === false ? 'text-warn' : update?.upToDate ? 'text-ok' : 'text-muted'}">
						{update?.upToDate === false ? t('Uppdatering finns', 'Update available') : update?.upToDate ? t('Senaste', 'Latest') : t('Okänd', 'Unknown')}
					</div>
				</button>
				<div class="card !rounded-lg p-3">
					<div class="label !text-[10px]">MariaDB</div>
					<div class="mt-1 font-medium {st.mariadb ? 'text-ok' : 'text-muted'}">{st.mariadb ? t('Igång', 'Running') : t('Av', 'Off')}</div>
				</div>
			</div>
		</section>
	</div>

	<!-- händelser -->
	<section class="card p-5">
		<h2 class="font-display font-bold tracking-wide mb-3">{t('Händelser', 'Events')}</h2>
		{#if !events.length}
			<p class="text-sm text-muted">{t('Inget har hänt sedan panelen startade.', 'Nothing has happened since the panel started.')}</p>
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
