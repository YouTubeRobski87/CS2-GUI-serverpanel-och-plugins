<script>
	import { onMount, onDestroy } from 'svelte';
	import { api, fmtBytes, fmtDuration } from '$lib/api.js';
	import { t } from '$lib/i18n.svelte.js';
	import Icon from './Icon.svelte';
	import PalSettings from './PalSettings.svelte';
	import PalOps from './PalOps.svelte';
	import PalBackups from './PalBackups.svelte';
	import PalMods from './PalMods.svelte';
	import PalLog from './PalLog.svelte';
	import PalUpdate from './PalUpdate.svelte';

	let { ctx } = $props();

	let ps = $state(null); // status från /api/palworld
	let busy = $state(false);
	let sub = $state('overview');
	let announce = $state('');
	let reason = $state('');
	let banId = $state('');
	let timer;

	const SUBS = ['overview', 'players', 'settings', 'ops', 'backups', 'mods', 'log', 'update'];
	let subs = $derived([
		{ id: 'overview', label: t('Översikt', 'Overview'), icon: 'grid' },
		{ id: 'players', label: t('Spelare', 'Players'), icon: 'users' },
		{ id: 'settings', label: t('Världsinställningar', 'World settings'), icon: 'sliders' },
		{ id: 'ops', label: t('Start och schema', 'Startup and schedule'), icon: 'clock' },
		{ id: 'backups', label: 'Backup', icon: 'database' },
		{ id: 'mods', label: 'Mods', icon: 'puzzle' },
		{ id: 'log', label: t('Logg', 'Log'), icon: 'terminal' },
		{ id: 'update', label: t('Uppdatering', 'Update'), icon: 'download' }
	]);

	async function load() {
		try {
			ps = await api('palworld');
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	onMount(() => {
		try {
			const s = localStorage.getItem('gs-pal-sub');
			if (s && SUBS.includes(s)) sub = s;
		} catch {
			/* */
		}
		load();
		timer = setInterval(load, 4000);
	});
	onDestroy(() => clearInterval(timer));

	function go(id) {
		sub = id;
		try {
			localStorage.setItem('gs-pal-sub', id);
		} catch {
			/* */
		}
	}

	async function act(path, body = {}, okText) {
		busy = true;
		try {
			await api(path, body);
			if (okText) ctx.toast(okText);
			setTimeout(load, 1500);
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			busy = false;
		}
	}

	function kill() {
		if (confirm(t('Tvinga ner servern utan att spara? Det som hänt sedan senaste sparningen försvinner.', 'Kill the server without saving? Progress since the last save is lost.'))) act('palworld/kill', {}, t('Servern tvingades ner', 'Server killed'));
	}
	function player(p, action) {
		const q = action === 'ban' ? t(`Banna ${p.name}?`, `Ban ${p.name}?`) : t(`Kicka ${p.name}?`, `Kick ${p.name}?`);
		if (!confirm(q)) return;
		act('palworld/player', { action, userId: p.userId, name: p.name, reason }, action === 'ban' ? t('Bannad', 'Banned') : t('Kickad', 'Kicked'));
	}
	async function send() {
		if (!announce.trim()) return;
		await act('palworld/announce', { message: announce }, t('Meddelandet skickat', 'Message sent'));
		announce = '';
	}

	const busyText = $derived({
		starting: t('Startar…', 'Starting…'),
		stopping: t('Stänger…', 'Stopping…'),
		updating: t('Uppdaterar…', 'Updating…'),
		restoring: t('Återställer backup…', 'Restoring backup…')
	});
	const when = (ms) => new Date(ms).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
</script>

<div class="space-y-6">
	<section class="card p-6 md:p-7 relative overflow-hidden">
		<div class="absolute -right-10 -top-16 size-64 rounded-full bg-ok/5 blur-3xl pointer-events-none"></div>
		<div class="flex flex-col lg:flex-row lg:items-end gap-6 justify-between relative">
			<div class="min-w-0">
				<div class="label mb-2">{t('Annat spel', 'Other game')}</div>
				<h1 class="font-display font-extrabold text-3xl md:text-4xl tracking-tight">Palworld</h1>
				{#if ps?.serverName}<div class="text-muted mt-1 truncate">{ps.serverName}</div>{/if}
				<div class="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
					{#if !ps}
						<span>{t('Laddar…', 'Loading…')}</span>
					{:else if !ps.installed}
						<span class="text-warn flex items-center gap-2"><Icon name="alert" class="size-4" /> {t(`Hittar inte PalServer.exe i ${ps.root}`, `PalServer.exe not found in ${ps.root}`)}</span>
					{:else if ps.busy}
						<span class="flex items-center gap-2"><span class="size-2.5 rounded-full bg-warn animate-pulse"></span> <span class="text-text">{busyText[ps.busy] || ps.busy}</span></span>
					{:else if ps.running}
						<span class="flex items-center gap-2"><span class="size-2.5 rounded-full bg-ok dot-live"></span> <span class="text-text">Online</span></span>
						<span class="flex items-center gap-2"><Icon name="users" class="size-4" /> {ps.players.length}/{ps.maxPlayers}</span>
						{#if ps.startedAt}<span class="flex items-center gap-2"><Icon name="clock" class="size-4" /> {t('upp', 'up')} {fmtDuration(Date.now() - new Date(ps.startedAt).getTime())}</span>{/if}
						<span class="flex items-center gap-2"><Icon name="memory" class="size-4" /> {fmtBytes(ps.memBytes)}</span>
						{#if ps.metrics?.fps != null}<span class="flex items-center gap-2"><Icon name="cpu" class="size-4" /> {ps.metrics.fps} FPS</span>{/if}
						{#if ps.version}<span class="mono text-dim">{ps.version}</span>{/if}
						{#if !ps.api}<span class="text-warn">{t('REST API svarar inte än', 'REST API not answering yet')}</span>{/if}
					{:else}
						<span class="flex items-center gap-2"><span class="size-2.5 rounded-full bg-bad"></span> {t('Servern är avstängd', 'Server is offline')}</span>
					{/if}
				</div>
			</div>
			{#if ps?.installed}
				<div class="flex flex-wrap gap-2.5">
					{#if !ps.running}
						<button class="btn btn-primary !px-6 !py-3 !text-[15px]" disabled={busy || !!ps.busy} onclick={() => act('palworld/start', {}, t('Startar Palworld…', 'Starting Palworld…'))}>
							<Icon name="play" class="size-4" /> {t('Starta', 'Start')}
						</button>
					{:else}
						<button class="btn !px-5 !py-3" disabled={busy || !ps.api} onclick={() => act('palworld/save', {}, t('Världen sparad', 'World saved'))}>
							<Icon name="check" class="size-4" /> {t('Spara världen', 'Save world')}
						</button>
						<button class="btn !px-5 !py-3" disabled={busy || !!ps.busy} onclick={() => act('palworld/restart', {}, t('Startar om – spelarna varnas först', 'Restarting – players are warned first'))}>
							<Icon name="restart" class="size-4" /> {t('Starta om', 'Restart')}
						</button>
						<button class="btn btn-danger !px-5 !py-3" disabled={busy || ps.busy === 'stopping'} onclick={() => act('palworld/stop', {}, t('Sparar och stänger…', 'Saving and stopping…'))}>
							<Icon name="stop" class="size-4" /> {t('Stoppa', 'Stop')}
						</button>
						<button class="btn btn-danger !px-3 !py-3" title={t('Tvinga ner utan att spara', 'Kill without saving')} disabled={busy} onclick={kill}>
							<Icon name="x" class="size-4" />
						</button>
					{/if}
				</div>
			{/if}
		</div>
		{#if ps?.notice?.kind === 'restart'}
			<p class="mt-5 text-sm text-warn relative">{t('Schemalagd omstart', 'Scheduled restart')} {when(ps.notice.at)} – {t('spelarna har varnats.', 'players have been warned.')}</p>
		{:else if ps?.running}
			<p class="mt-5 text-xs text-dim relative">
				{t(
					`Stoppa och Starta om sparar världen och varnar spelarna i ${ps.cfg.stopCountdown} sekunder innan servern går ner.`,
					`Stop and Restart save the world and warn players ${ps.cfg.stopCountdown} seconds before the server goes down.`
				)}
				{#if ps.cfg.autoRestart}{t(' Kraschar den startar panelen om den.', ' If it crashes, the panel restarts it.')}{/if}
			</p>
		{/if}
	</section>

	<nav class="flex flex-wrap gap-1.5">
		{#each subs as s}
			<button
				class="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium border transition-colors {sub === s.id ? 'bg-amber/10 text-amber-2 border-amber/30' : 'text-muted hover:text-text border-line hover:bg-panel-2'}"
				onclick={() => go(s.id)}
			>
				<Icon name={s.icon} class="size-4" /> {s.label}
				{#if s.id === 'players' && ps?.players?.length}<span class="num text-xs text-ok">{ps.players.length}</span>{/if}
				{#if s.id === 'update' && ps?.update?.upToDate === false}<span class="size-2 rounded-full bg-warn"></span>{/if}
			</button>
		{/each}
	</nav>

	{#if !ps}
		<div class="text-muted">{t('Laddar…', 'Loading…')}</div>
	{:else if sub === 'overview'}
		<div class="grid lg:grid-cols-3 gap-6">
			<section class="card p-5 space-y-4">
				<div class="label">{t('Anslut', 'Connect')}</div>
				<div>
					<div class="text-xs text-dim mb-1">{t('Hemma (samma nätverk)', 'At home (same network)')}</div>
					<div class="mono text-text">{ps.address}</div>
				</div>
				{#if ps.publicIp}
					<div>
						<div class="text-xs text-dim mb-1">{t('Över internet', 'Over the internet')}</div>
						<div class="mono text-text">{ps.publicIp}:{ps.port}</div>
					</div>
				{/if}
				<div class="text-sm text-muted space-y-1">
					<div>{t('Port att öppna i routern:', 'Port to open in the router:')} <span class="mono text-text">{ps.port} UDP</span></div>
					<div class="text-xs text-dim">{t(`REST API (bara lokalt): ${ps.restPort}`, `REST API (local only): ${ps.restPort}`)}</div>
				</div>
				<p class="text-xs text-dim">{t('I spelet: Join Multiplayer Game → skriv in adressen längst ner, eller sök på servernamnet i Community Servers.', 'In game: Join Multiplayer Game → enter the address at the bottom, or search the server name in Community Servers.')}</p>
				<div class="border-t border-line pt-4 text-xs text-dim">
					{t('Startargument', 'Launch arguments')}: <span class="mono text-muted break-all">{ps.launchArgs || '–'}</span>
				</div>
			</section>

			<section class="card p-5 space-y-4">
				<div class="label">{t('Servern just nu', 'Server right now')}</div>
				{#if ps.running && ps.metrics}
					<div class="grid grid-cols-2 gap-4">
						<div><div class="text-xs text-dim">FPS</div><div class="num text-2xl">{ps.metrics.fps ?? '–'}</div></div>
						<div><div class="text-xs text-dim">{t('Frametid', 'Frame time')}</div><div class="num text-2xl">{ps.metrics.frameTime != null ? ps.metrics.frameTime.toFixed(1) : '–'} <span class="text-sm text-dim">ms</span></div></div>
						<div><div class="text-xs text-dim">{t('Dag i spelet', 'In-game day')}</div><div class="num text-2xl">{ps.metrics.days ?? '–'}</div></div>
						<div><div class="text-xs text-dim">{t('Baser', 'Bases')}</div><div class="num text-2xl">{ps.metrics.bases ?? '–'}</div></div>
					</div>
				{:else}
					<p class="text-sm text-muted">{ps.running ? t('Väntar på svar från servern…', 'Waiting for the server…') : t('Servern är avstängd.', 'The server is offline.')}</p>
				{/if}
				<div class="border-t border-line pt-4 text-sm space-y-1.5">
					<div class="flex justify-between gap-3"><span class="text-dim">{t('Krascher senaste timmen', 'Crashes last hour')}</span><span class="num {ps.recentCrashes ? 'text-bad' : ''}">{ps.recentCrashes}</span></div>
					<div class="flex justify-between gap-3"><span class="text-dim">{t('Nästa schemalagda omstart', 'Next scheduled restart')}</span><span>{ps.nextRestart ? when(ps.nextRestart) : t('ingen', 'none')}</span></div>
					<div class="flex justify-between gap-3"><span class="text-dim">{t('Automatisk backup', 'Automatic backup')}</span><span>{ps.cfg.backup.auto ? t(`var ${ps.cfg.backup.everyHours}:e timme`, `every ${ps.cfg.backup.everyHours} h`) : t('av', 'off')}</span></div>
				</div>
			</section>

			<section class="card p-5 space-y-3">
				<div class="label">{t('Meddelande till alla', 'Message to everyone')}</div>
				<textarea class="input min-h-24" maxlength="200" placeholder={t('Visas i chatten för alla spelare', 'Shown in chat for all players')} bind:value={announce} disabled={!ps.running}></textarea>
				<button class="btn btn-primary w-full justify-center" disabled={busy || !ps.running || !ps.api || !announce.trim()} onclick={send}><Icon name="send" class="size-4" /> {t('Skicka', 'Send')}</button>
			</section>
		</div>
	{:else if sub === 'players'}
		<div class="grid lg:grid-cols-3 gap-6">
			<section class="card p-5 lg:col-span-2 space-y-4">
				<div class="flex items-center justify-between gap-3 flex-wrap">
					<div class="label">{t('Inne nu', 'Online now')} ({ps.players.length})</div>
					<input class="input !w-64" placeholder={t('Anledning vid kick/ban (valfritt)', 'Reason for kick/ban (optional)')} bind:value={reason} />
				</div>
				{#if !ps.players.length}
					<p class="text-sm text-muted">{ps.running ? t('Ingen är inne just nu.', 'Nobody is online.') : t('Servern är avstängd.', 'The server is offline.')}</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead class="text-xs text-dim text-left">
								<tr><th class="py-2 pr-3">{t('Namn', 'Name')}</th><th class="pr-3">{t('Nivå', 'Level')}</th><th class="pr-3">Ping</th><th class="pr-3">{t('Byggen', 'Buildings')}</th><th class="pr-3">{t('Position', 'Position')}</th><th class="pr-3">ID</th><th></th></tr>
							</thead>
							<tbody>
								{#each ps.players as p (p.userId)}
									<tr class="border-t border-line">
										<td class="py-2 pr-3"><div class="text-text">{p.name}</div><div class="text-xs text-dim">{p.accountName}</div></td>
										<td class="pr-3 num">{p.level}</td>
										<td class="pr-3 num">{p.ping}</td>
										<td class="pr-3 num">{p.buildings ?? '–'}</td>
										<td class="pr-3 mono text-xs text-dim">{p.x != null ? `${Math.round(p.x)}, ${Math.round(p.y)}` : '–'}</td>
										<td class="pr-3 mono text-xs text-dim break-all">{p.userId}</td>
										<td class="text-right whitespace-nowrap">
											<button class="btn btn-sm" disabled={busy} onclick={() => player(p, 'kick')}>Kick</button>
											<button class="btn btn-sm btn-danger" disabled={busy} onclick={() => player(p, 'ban')}><Icon name="ban" class="size-3.5" /> Ban</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
			<section class="card p-5 space-y-4">
				<div class="label">{t('Bannade', 'Banned')} ({ps.banlist.length})</div>
				{#if ps.banlist.length}
					<ul class="space-y-2">
						{#each ps.banlist as id}
							<li class="flex items-center justify-between gap-2 text-sm">
								<span class="mono text-xs break-all">{id}</span>
								<button class="btn btn-sm" disabled={busy} onclick={() => act('palworld/player', { action: 'unban', userId: id }, t('Bannet borttaget', 'Unbanned'))}>{t('Ta bort ban', 'Unban')}</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-muted">{t('Ingen är bannad.', 'Nobody is banned.')}</p>
				{/if}
				<div class="border-t border-line pt-4 space-y-2">
					<div class="text-xs text-dim">{t('Banna med ID (t.ex. steam_7656…), servern måste vara igång', 'Ban by ID (e.g. steam_7656…), server must be running')}</div>
					<div class="flex gap-2">
						<input class="input mono" placeholder="steam_…" bind:value={banId} />
						<button class="btn btn-danger" disabled={busy || !ps.api || !banId.trim()} onclick={async () => { await act('palworld/player', { action: 'ban', userId: banId.trim(), reason }, t('Bannad', 'Banned')); banId = ''; }}>Ban</button>
					</div>
				</div>
			</section>
		</div>
	{:else if sub === 'settings'}
		<PalSettings {ps} {ctx} />
	{:else if sub === 'ops'}
		<PalOps {ps} {ctx} reload={load} />
	{:else if sub === 'backups'}
		<PalBackups {ps} {ctx} />
	{:else if sub === 'mods'}
		<PalMods {ps} {ctx} />
	{:else if sub === 'log'}
		<PalLog {ctx} />
	{:else if sub === 'update'}
		<PalUpdate {ps} {ctx} reload={load} />
	{/if}
</div>
