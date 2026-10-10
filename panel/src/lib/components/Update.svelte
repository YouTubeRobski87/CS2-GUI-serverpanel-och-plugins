<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { api } from '$lib/api.js';
	import Icon from './Icon.svelte';
	import { t } from '$lib/i18n.svelte.js';

	let { st, update, ctx } = $props();
	let job = $state(null);
	let validate = $state(false);
	let checking = $state(false);
	let box;
	let timer;

	async function pollJob() {
		try {
			const j = await api('update/job');
			const grew = (j.lines?.length ?? 0) !== (job?.lines?.length ?? 0);
			job = j;
			if (grew) {
				await tick();
				box?.scrollTo({ top: box.scrollHeight });
			}
		} catch {
			/* */
		}
	}
	onMount(() => {
		pollJob();
		timer = setInterval(pollJob, 1200);
	});
	onDestroy(() => clearInterval(timer));

	async function check() {
		checking = true;
		await ctx.refreshUpdate(true);
		checking = false;
	}

	async function run() {
		try {
			await api('update', { validate });
			ctx.toast(t('Uppdateringen har startat', 'The update has started'));
			pollJob();
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}

	let progress = $derived.by(() => {
		const l = [...(job?.lines ?? [])].reverse().find((x) => /progress:\s*[\d.]+/.test(x));
		const m = l?.match(/progress:\s*([\d.]+)/);
		return m ? Number(m[1]) : null;
	});
	const date = (d) => (d ? new Date(d).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
</script>

<div class="space-y-6">
	<h1 class="font-display font-extrabold text-2xl tracking-tight">{t('Uppdatering', 'Update')}</h1>

	<section class="card p-6">
		<div class="flex flex-col md:flex-row md:items-center gap-6">
			<div class="grid place-items-center size-16 rounded-2xl {update?.upToDate === false ? 'bg-warn/10 text-warn' : update?.upToDate ? 'bg-ok/10 text-ok' : 'bg-panel-2 text-muted'}">
				<Icon name={update?.upToDate === false ? 'download' : update?.upToDate ? 'check' : 'alert'} class="size-8" />
			</div>
			<div class="flex-1">
				<div class="font-display font-bold text-xl">
					{#if update?.upToDate === false}
						{t('Ny CS2-patch finns', 'New CS2 patch available')}
					{:else if update?.upToDate}
						{t('Servern har senaste versionen', 'The server is up to date')}
					{:else}
						{t('Okänt läge', 'Unknown status')}
					{/if}
				</div>
				<div class="text-sm text-muted mt-1">
					{t('Installerad:', 'Installed:')} <span class="num text-text">{st.version?.patch ?? '–'}</span> (build {st.version?.buildId ?? '–'}) · {t('uppdaterad', 'updated')} {date(st.version?.lastUpdated)}
					{#if update?.upToDate === false && update.required}
						· {t('Steam kräver', 'Steam requires')} <span class="num text-warn">{update.required}</span>
					{/if}
				</div>
				{#if update?.error}<div class="text-sm text-bad mt-1">{update.error}</div>{/if}
			</div>
			<div class="flex flex-wrap gap-2">
				<button class="btn" disabled={checking} onclick={check}><Icon name="refresh" class="size-4" /> {t('Kolla nu', 'Check now')}</button>
				<button class="btn btn-primary" disabled={st.running || job?.running || !!st.busy} onclick={run}><Icon name="download" class="size-4" /> {t('Uppdatera servern', 'Update server')}</button>
			</div>
		</div>
		{#if st.running}
			<p class="text-sm text-warn mt-4">{t('Stoppa servern först – SteamCMD kan inte skriva över filer som används.', 'Stop the server first – SteamCMD can’t overwrite files that are in use.')}</p>
		{/if}
		<label class="flex items-start gap-2 text-sm text-muted mt-4 cursor-pointer max-w-2xl">
			<input type="checkbox" bind:checked={validate} class="accent-amber-500 mt-1" />
			<span><span class="text-text">{t('Verifiera alla filer (validate).', 'Verify all files (validate).')}</span> {t('Använd bara om servern är trasig – det återställer Valves egna cfg-filer om du har ändrat i dem.', 'Only use this if the server is broken – it restores Valve’s own cfg files if you have edited them.')}</span>
		</label>
	</section>

	<section class="card p-5">
		<div class="flex items-center justify-between mb-3">
			<h2 class="font-display font-bold tracking-wide">SteamCMD</h2>
			{#if job?.running}
				<span class="text-sm text-amber flex items-center gap-2"><span class="size-2 rounded-full bg-amber animate-pulse"></span> {t('Pågår', 'In progress')}{progress !== null ? ` – ${progress.toFixed(0)}%` : ''}</span>
			{:else if job?.ok === true}
				<span class="text-sm text-ok">{t('Klar', 'Done')} {date(job.finishedAt)}</span>
			{:else if job?.ok === false}
				<span class="text-sm text-bad">{t('Misslyckades', 'Failed')}</span>
			{/if}
		</div>
		{#if job?.running && progress !== null}
			<div class="h-1.5 bg-line rounded-full overflow-hidden mb-3">
				<div class="h-full bg-amber transition-all" style="width:{progress}%"></div>
			</div>
		{/if}
		<div bind:this={box} class="mono text-[12px] leading-relaxed bg-[#0a0908] rounded-lg p-4 h-80 overflow-auto text-muted">
			{#each job?.lines ?? [] as l}
				<div class={/Success!/.test(l) ? 'text-ok' : /error|fail/i.test(l) ? 'text-bad' : ''}>{l}</div>
			{:else}
				<div class="text-dim">{t('Ingen uppdatering har körts sedan panelen startade.', 'No update has run since the panel started.')}</div>
			{/each}
		</div>
		<p class="text-xs text-dim mt-3">{t('Efter uppdateringen lägger panelen automatiskt tillbaka Metamod-raden i gameinfo.gi om den försvunnit.', 'After the update, the panel automatically restores the Metamod line in gameinfo.gi if it went missing.')}</p>
	</section>
</div>
