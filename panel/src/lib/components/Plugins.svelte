<script>
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import Icon from './Icon.svelte';
	import { t } from '$lib/i18n.svelte.js';

	let { st, ctx } = $props();
	let data = $state(null);
	let busy = $state(false);

	async function load() {
		try {
			data = await api('plugins');
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	onMount(load);

	async function act(action, name) {
		busy = true;
		try {
			await api('plugin', { action, name });
			ctx.toast(`${name}: ${{ reload: t('omladdad', 'reloaded'), unload: t('urladdad', 'unloaded'), load: t('laddad', 'loaded') }[action]}`);
			setTimeout(load, 800);
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			busy = false;
		}
	}

	// Koppla mappnamn (installerat) till laddad plugin via namnlikhet.
	const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
	function loadedFor(dir) {
		return data?.loaded.find((l) => (l.dir && norm(l.dir) === norm(dir)) || (!l.dir && norm(l.name).includes(norm(dir))));
	}
	const ours = ['GamlaSkolanRank', 'GamlaSkolanAds', 'GamlaSkolanMvp', 'GamlaSkolanPanelBridge'];
</script>

<div class="space-y-4">
	<div class="flex items-center gap-4">
		<h1 class="font-display font-extrabold text-2xl tracking-tight">Plugins</h1>
		<button class="btn btn-sm ml-auto" onclick={load}><Icon name="refresh" class="size-4" /> {t('Uppdatera', 'Refresh')}</button>
	</div>

	{#if !data}
		<div class="text-muted">{t('Laddar…', 'Loading…')}</div>
	{:else}
		{#if st.running && !data.liveOk}
			<div class="card p-4 text-warn text-sm">{t('Väntar på pluginlistan från bryggan… (om det inte dyker upp: starta om servern från Översikt).', 'Waiting for the plugin list from the bridge… (if it doesn’t show up: restart the server from Overview).')}</div>
		{/if}
		<div class="grid md:grid-cols-2 gap-3">
			{#each data.installed as dir}
				{@const l = loadedFor(dir)}
				<div class="card p-4 flex items-center gap-4">
					<div class="grid place-items-center size-10 rounded-lg {ours.includes(dir) ? 'bg-amber/10 text-amber' : 'bg-panel-2 text-muted'}">
						<Icon name="puzzle" class="size-5" />
					</div>
					<div class="min-w-0 flex-1">
						<div class="font-medium truncate">{l?.name ?? dir}</div>
						<div class="text-xs text-muted truncate">
							{#if l}v{l.version}{l.author ? ` · ${l.author}` : ''}{:else}{dir}{/if}
						</div>
					</div>
					{#if !st.running}
						<span class="label !text-[10px]">{t('Installerad', 'Installed')}</span>
					{:else if l}
						<span class="label !text-[10px] {l.state === 'loaded' ? '!text-ok' : '!text-warn'}">{l.state === 'loaded' ? t('Laddad', 'Loaded') : l.state === 'unloaded' ? t('Avlagd', 'Unloaded') : l.state}</span>
						{#if dir === 'GamlaSkolanPanelBridge'}
							<span class="text-xs text-dim">{t('panelens brygga', 'panel bridge')}</span>
						{:else if l.state !== 'loaded'}
							<button class="btn btn-sm" disabled={busy} onclick={() => act('load', dir)}><Icon name="play" class="size-3.5" /> {t('Ladda', 'Load')}</button>
						{:else}
						<button class="btn btn-sm" disabled={busy} onclick={() => act('reload', dir)} title={t('Ladda om', 'Reload')}><Icon name="refresh" class="size-3.5" /></button>
						<button class="btn btn-sm btn-danger" disabled={busy} onclick={() => act('unload', dir)} title={t('Ladda ur', 'Unload')}><Icon name="stop" class="size-3.5" /></button>
						{/if}
					{:else}
						<span class="label !text-[10px] !text-warn">{t('Ej laddad', 'Not loaded')}</span>
						<button class="btn btn-sm" disabled={busy} onclick={() => act('load', dir)}><Icon name="play" class="size-3.5" /> {t('Ladda', 'Load')}</button>
					{/if}
				</div>
			{/each}
		</div>

		{#if data.disabled.length}
			<div class="label pt-4">{t('Avstängda av lägesbytet', 'Disabled by the mode switch')}</div>
			<div class="flex flex-wrap gap-2">
				{#each data.disabled as d}
					<span class="px-3 py-1.5 rounded-lg border border-line text-sm text-muted">{d}</span>
				{/each}
			</div>
			<p class="text-xs text-dim">{t('De slås på automatiskt när du startar ett läge som behöver dem.', 'They are turned back on automatically when you start a mode that needs them.')}</p>
		{/if}
	{/if}
</div>
