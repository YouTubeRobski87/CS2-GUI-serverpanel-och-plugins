<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { api } from '$lib/api.js';
	import { t } from '$lib/i18n.svelte.js';
	import Icon from './Icon.svelte';

	let { ps, ctx, reload } = $props();

	let check = $state(null);
	let job = $state(null);
	let checking = $state(false);
	let auto = $state(!!ps.cfg.update.auto);
	let box;
	let timer;

	async function doCheck(force = false) {
		checking = true;
		try {
			check = await api(`palworld/update/check${force ? '?force=1' : ''}`);
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			checking = false;
		}
	}
	async function loadJob() {
		try {
			job = await api('palworld/update/job');
			await tick();
			if (box) box.scrollTop = box.scrollHeight;
		} catch {
			/* */
		}
	}
	onMount(() => {
		doCheck();
		loadJob();
		timer = setInterval(loadJob, 2000);
	});
	onDestroy(() => clearInterval(timer));

	async function run(validate) {
		const q = ps.running
			? t('Servern stängs (spelarna får 60 sekunders varning), uppdateras och startas igen. Fortsätta?', 'The server will shut down (players get 60 seconds warning), update and start again. Continue?')
			: t('Uppdatera Palworld-servern nu?', 'Update the Palworld server now?');
		if (!confirm(q)) return;
		try {
			await api('palworld/update', { validate });
			ctx.toast(t('Uppdateringen har startat', 'Update started'));
			loadJob();
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	async function saveAuto() {
		try {
			await api('palworld/panel', { update: { auto } });
			ctx.toast(t('Sparat', 'Saved'));
			reload();
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	const when = (ms) => (ms ? new Date(ms).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
</script>

<div class="grid lg:grid-cols-3 gap-6">
	<section class="card p-5 space-y-4">
		<div class="label">{t('Version', 'Version')}</div>
		{#if check}
			<div class="text-sm space-y-1.5">
				<div class="flex justify-between gap-3"><span class="text-dim">{t('Installerad build', 'Installed build')}</span><span class="num">{check.buildId ?? '–'}</span></div>
				<div class="flex justify-between gap-3"><span class="text-dim">{t('Senaste på Steam', 'Latest on Steam')}</span><span class="num">{check.latest ?? '–'}</span></div>
				<div class="flex justify-between gap-3"><span class="text-dim">{t('Senast uppdaterad', 'Last updated')}</span><span>{when(check.lastUpdated)}</span></div>
				{#if ps.version}<div class="flex justify-between gap-3"><span class="text-dim">{t('Spelversion', 'Game version')}</span><span class="mono">{ps.version}</span></div>{/if}
			</div>
			{#if check.upToDate === true}
				<div class="text-ok text-sm flex items-center gap-2"><Icon name="check" class="size-4" /> {t('Senaste versionen', 'Up to date')}</div>
			{:else if check.upToDate === false}
				<div class="text-warn text-sm flex items-center gap-2"><Icon name="alert" class="size-4" /> {t('Ny version finns', 'New version available')}</div>
			{:else if check.error}
				<div class="text-warn text-xs">{check.error}</div>
			{/if}
		{:else}
			<div class="text-muted text-sm">{t('Kollar…', 'Checking…')}</div>
		{/if}
		<button class="btn w-full justify-center" disabled={checking} onclick={() => doCheck(true)}><Icon name="refresh" class="size-4" /> {t('Kolla igen', 'Check again')}</button>
		<div class="border-t border-line pt-4 space-y-3">
			<label class="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500 mt-1" bind:checked={auto} onchange={saveAuto} /> <span>{t('Uppdatera automatiskt när en ny version kommer', 'Update automatically when a new version is out')}<span class="block text-xs text-dim">{t('Kollar var 30:e minut. Spelarna varnas 5 minuter innan.', 'Checks every 30 minutes. Players are warned 5 minutes before.')}</span></span></label>
		</div>
	</section>

	<section class="card p-5 space-y-4 lg:col-span-2">
		<div class="flex items-center justify-between gap-3 flex-wrap">
			<div class="label">{t('Uppdatera via SteamCMD', 'Update via SteamCMD')}</div>
			<div class="flex gap-2">
				<button class="btn" disabled={job?.running} onclick={() => run(true)}>{t('Uppdatera och verifiera filer', 'Update and verify files')}</button>
				<button class="btn btn-primary" disabled={job?.running} onclick={() => run(false)}><Icon name="download" class="size-4" /> {t('Uppdatera nu', 'Update now')}</button>
			</div>
		</div>
		<p class="text-xs text-dim">{t('Använder samma SteamCMD som CS2 (CS2 → Inställningar). Är servern igång sparas världen, en backup görs och servern startas igen efteråt.', 'Uses the same SteamCMD as CS2 (CS2 → Settings). If the server is running, the world is saved and backed up, and the server is started again afterwards.')}</p>
		{#if job?.lines?.length}
			<div bind:this={box} class="bg-ink border border-line rounded-lg p-3 h-80 overflow-auto mono text-xs text-muted">
				{#each job.lines as l}<div class="whitespace-pre-wrap break-all">{l}</div>{/each}
			</div>
			{#if !job.running && job.success === true}<div class="text-ok text-sm">{t('Klart!', 'Done!')}</div>{/if}
			{#if !job.running && job.success === false}<div class="text-bad text-sm">{t('Uppdateringen misslyckades – se loggen ovan.', 'The update failed – see the log above.')}</div>{/if}
		{/if}
	</section>
</div>
