<script>
	import { onMount } from 'svelte';
	import { api, chatPreview, CHAT_COLORS } from '$lib/api.js';
	import Icon from './Icon.svelte';

	let { st, ctx } = $props();
	let cfg = $state(null);
	let panel = $state(null);
	let saving = $state('');
	let focusIdx = $state(0);

	async function load() {
		try {
			cfg = await api('config');
			panel = await api('settings');
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	onMount(load);

	async function save(name) {
		saving = name;
		try {
			const r = await api('config', { name, values: cfg[name].values });
			cfg[name].values = r.saved;
			ctx.toast(r.reloaded ? `${cfg[name].title}: sparat och omladdat` : `${cfg[name].title}: sparat – gäller vid nästa start`);
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = '';
		}
	}

	async function savePanel() {
		saving = 'panel';
		try {
			await api('settings', panel);
			ctx.toast('Panelinställningar sparade');
			await load();
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = '';
		}
	}

	function insertColor(c) {
		const msgs = cfg.GamlaSkolanAds.values.Messages;
		msgs[focusIdx] = (msgs[focusIdx] ?? '') + `{${c}}`;
	}
	const colorKeys = ['default', 'green', 'lightgreen', 'red', 'gold', 'yellow', 'blue', 'lightblue', 'purple', 'grey'];
</script>

<div class="space-y-6">
	<h1 class="font-display font-extrabold text-2xl tracking-tight">Inställningar</h1>

	{#if !cfg}
		<div class="text-muted">Laddar…</div>
	{:else}
		<!-- Servernamn -->
		<section class="card p-6 space-y-4">
			<div class="flex items-center gap-3">
				<Icon name="crosshair" class="size-5 text-amber" />
				<h2 class="font-display font-bold text-lg">Servernamn</h2>
				<span class="text-sm text-muted">Syns i serverlistan i CS2</span>
			</div>
			{#if cfg.GamlaSkolanLage}
				{@const v = cfg.GamlaSkolanLage.values}
				<div class="flex flex-col sm:flex-row gap-3">
					<input class="input flex-1" bind:value={v.Hostname} maxlength="63" placeholder="[Gamla Skolan] …" />
					<button class="btn btn-primary" disabled={saving === 'GamlaSkolanLage' || !v.Hostname?.trim()} onclick={() => save('GamlaSkolanLage')}><Icon name="check" class="size-4" /> Spara namn</button>
				</div>
				<p class="text-xs text-dim">Gäller i alla lägen och används direkt när du sparar (servern behöver inte startas om). Max 63 tecken.</p>
			{/if}
		</section>

		<!-- Tips i chatten -->
		<section class="card p-6 space-y-4">
			<div class="flex items-center gap-3">
				<Icon name="message" class="size-5 text-amber" />
				<h2 class="font-display font-bold text-lg">Tips i chatten</h2>
				<span class="text-sm text-muted">GamlaSkolanAds</span>
			</div>
			{#if cfg.GamlaSkolanAds}
				{@const v = cfg.GamlaSkolanAds.values}
				<div class="grid sm:grid-cols-[1fr_200px] gap-4">
					<div>
						<div class="label mb-1.5">Prefix</div>
						<input class="input mono" bind:value={v.Prefix} />
					</div>
					<div>
						<div class="label mb-1.5">Var … sekund</div>
						<input class="input num" type="number" min="15" max="3600" bind:value={v.IntervalSeconds} />
					</div>
				</div>
				<div>
					<div class="flex items-center gap-2 mb-2 flex-wrap">
						<span class="label mr-2">Meddelanden</span>
						{#each colorKeys as c}
							<button class="px-2 py-0.5 rounded text-xs mono border border-line hover:border-amber" style="color:{CHAT_COLORS[c]}" onclick={() => insertColor(c)} title="Lägg till färg i markerat meddelande">{c}</button>
						{/each}
					</div>
					<div class="space-y-3">
						{#each v.Messages as _, i}
							<div class="rounded-xl border p-3 {focusIdx === i ? 'border-amber/50' : 'border-line'}">
								<div class="flex gap-2">
									<input class="input mono text-[13px]" bind:value={v.Messages[i]} onfocus={() => (focusIdx = i)} maxlength="250" />
									<button class="btn btn-sm btn-danger" onclick={() => v.Messages.splice(i, 1)} title="Ta bort"><Icon name="trash" class="size-3.5" /></button>
								</div>
								<div class="mt-2 px-3 py-2 rounded-lg bg-black/50 text-[13px] font-medium" style="font-family:Verdana,Arial,sans-serif">
									{@html chatPreview(`${v.Prefix} ${v.Messages[i]}`)}
								</div>
							</div>
						{/each}
					</div>
					<button class="btn btn-sm mt-3" onclick={() => { v.Messages.push(''); focusIdx = v.Messages.length - 1; }}><Icon name="plus" class="size-3.5" /> Nytt meddelande</button>
				</div>
				<div class="flex justify-end">
					<button class="btn btn-primary" disabled={saving === 'GamlaSkolanAds'} onclick={() => save('GamlaSkolanAds')}><Icon name="check" class="size-4" /> Spara tips</button>
				</div>
			{/if}
		</section>

		<div class="grid lg:grid-cols-2 gap-6">
			<!-- MVP -->
			<section class="card p-6 space-y-4">
				<div class="flex items-center gap-3">
					<Icon name="trophy" class="size-5 text-amber" />
					<h2 class="font-display font-bold text-lg">MVP & killgräns</h2>
				</div>
				{#if cfg.GamlaSkolanMvp}
					{@const v = cfg.GamlaSkolanMvp.values}
					<div class="grid grid-cols-2 gap-4">
						<div>
							<div class="label mb-1.5">Kills för vinst</div>
							<input class="input num" type="number" min="5" max="1000" bind:value={v.KillLimit} />
						</div>
						<div>
							<div class="label mb-1.5">Firande (sek)</div>
							<input class="input num" type="number" min="3" max="30" bind:value={v.CelebrationSeconds} />
						</div>
					</div>
					<p class="text-sm text-muted">Gäller bara i deathmatch. Kom ihåg att tipset "Först till 100 kills" i chatten också behöver ändras om du byter siffra.</p>
					<div class="flex justify-end">
						<button class="btn btn-primary" disabled={saving === 'GamlaSkolanMvp'} onclick={() => save('GamlaSkolanMvp')}><Icon name="check" class="size-4" /> Spara</button>
					</div>
				{/if}
			</section>

			<!-- Rank -->
			<section class="card p-6 space-y-4">
				<div class="flex items-center gap-3">
					<Icon name="crosshair" class="size-5 text-amber" />
					<h2 class="font-display font-bold text-lg">Rank</h2>
				</div>
				{#if cfg.GamlaSkolanRank}
					{@const v = cfg.GamlaSkolanRank.values}
					<div class="grid grid-cols-2 gap-4">
						<div>
							<div class="label mb-1.5">Poäng per kill</div>
							<input class="input num" type="number" min="0" max="1000" bind:value={v.PointsPerKill} />
						</div>
						<div>
							<div class="label mb-1.5">Poäng bort per död</div>
							<input class="input num" type="number" min="0" max="1000" bind:value={v.PointsLostPerDeath} />
						</div>
						<div>
							<div class="label mb-1.5">Minst antal människor</div>
							<input class="input num" type="number" min="1" max="64" bind:value={v.MinimumHumanPlayers} />
						</div>
						<div>
							<div class="label mb-1.5">Antal i !top</div>
							<input class="input num" type="number" min="3" max="15" bind:value={v.TopCount} />
						</div>
					</div>
					<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" bind:checked={v.ShowPointMessages} class="accent-amber-500" /> Visa poäng i chatten vid varje kill</label>
					<p class="text-sm text-muted">Bottar ger halva poängen.</p>
					<div class="flex justify-end">
						<button class="btn btn-primary" disabled={saving === 'GamlaSkolanRank'} onclick={() => save('GamlaSkolanRank')}><Icon name="check" class="size-4" /> Spara</button>
					</div>
				{/if}
			</section>
		</div>

		<!-- Panel -->
		{#if panel}
			<section class="card p-6 space-y-4">
				<div class="flex items-center gap-3">
					<Icon name="sliders" class="size-5 text-amber" />
					<h2 class="font-display font-bold text-lg">Panelen</h2>
				</div>
				<div class="grid md:grid-cols-2 gap-4">
					<div>
						<div class="label mb-1.5">Servermapp</div>
						<input class="input mono text-[13px]" bind:value={panel.serverRoot} />
					</div>
					<div>
						<div class="label mb-1.5">SteamCMD</div>
						<input class="input mono text-[13px]" bind:value={panel.steamcmd} />
					</div>
					<div>
						<div class="label mb-1.5">MariaDB-startfil</div>
						<input class="input mono text-[13px]" bind:value={panel.mariadbBat} />
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<div class="label mb-1.5">Port</div>
							<input class="input num" type="number" bind:value={panel.port} />
						</div>
						<div>
							<div class="label mb-1.5">Standardläge</div>
							<select class="input" bind:value={panel.defaultMode}>
								{#each st.modes as m}<option value={m.id}>{m.name}</option>{/each}
							</select>
						</div>
					</div>
				</div>
				<div class="flex flex-wrap gap-4 text-sm">
					<span class="flex items-center gap-2 {panel.checks.gslt ? 'text-ok' : 'text-bad'}"><Icon name={panel.checks.gslt ? 'check' : 'alert'} class="size-4" /> GSLT-token {panel.checks.gslt ? 'hittad' : 'saknas'}</span>
					<span class="flex items-center gap-2 {panel.checks.rcon ? 'text-ok' : 'text-bad'}"><Icon name={panel.checks.rcon ? 'check' : 'alert'} class="size-4" /> RCON-lösenord {panel.checks.rcon ? 'hittat' : 'saknas'}</span>
				</div>
				<p class="text-xs text-dim">Token och lösenord läses direkt från dina startfiler och server.cfg och sparas aldrig av panelen.</p>
				<div class="flex justify-end">
					<button class="btn btn-primary" disabled={saving === 'panel'} onclick={savePanel}><Icon name="check" class="size-4" /> Spara</button>
				</div>
			</section>
		{/if}
	{/if}
</div>
