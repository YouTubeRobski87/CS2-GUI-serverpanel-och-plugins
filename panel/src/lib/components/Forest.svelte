<script>
	import { onMount, onDestroy } from 'svelte';
	import { api, fmtBytes, fmtDuration } from '$lib/api.js';
	import { t } from '$lib/i18n.svelte.js';
	import Icon from './Icon.svelte';

	let { ctx } = $props();

	let fs = $state(null); // status från /api/forest
	let form = $state(null); // redigerbara värden
	let busy = $state(false);
	let saving = $state(false);
	let timer;

	async function load(initial = false) {
		try {
			fs = await api('forest');
			if (initial || !form) {
				const f = {};
				for (const field of fs.fields) {
					const v = fs.config[field.key];
					f[field.key] = field.type === 'bool' ? v === 'on' : field.type === 'secret' ? '' : v;
				}
				form = f;
			}
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	onMount(() => {
		load(true);
		timer = setInterval(() => load(false), 4000);
	});
	onDestroy(() => clearInterval(timer));

	async function act(path, okText) {
		busy = true;
		try {
			await api(path, {});
			if (okText) ctx.toast(okText);
			setTimeout(() => load(false), 2500);
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			busy = false;
		}
	}

	async function save() {
		saving = true;
		try {
			await api('forest/config', { values: form });
			ctx.toast(fs.running ? t('Sparat – starta om servern så gäller det.', 'Saved – restart the server to apply.') : t('Sparat', 'Saved'));
			form.serverSteamAccount = '';
			await load(false);
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = false;
		}
	}

	const when = (iso) => new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
</script>

<div class="space-y-6">
	<section class="card p-6 md:p-7 relative overflow-hidden">
		<div class="absolute -right-10 -top-16 size-64 rounded-full bg-ok/5 blur-3xl pointer-events-none"></div>
		<div class="flex flex-col lg:flex-row lg:items-end gap-6 justify-between relative">
			<div>
				<div class="label mb-2">{t('Annat spel', 'Other game')}</div>
				<h1 class="font-display font-extrabold text-3xl md:text-4xl tracking-tight">The Forest</h1>
				<div class="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
					{#if !fs}
						<span>{t('Laddar…', 'Loading…')}</span>
					{:else if !fs.installed}
						<span class="text-warn flex items-center gap-2"><Icon name="alert" class="size-4" /> {t(`Servern är inte installerad i ${fs.root}`, `The server is not installed in ${fs.root}`)}</span>
					{:else if fs.running}
						<span class="flex items-center gap-2"><span class="size-2.5 rounded-full bg-ok dot-live"></span> <span class="text-text">Online</span></span>
						<span class="flex items-center gap-2"><Icon name="clock" class="size-4" /> {t('upp', 'up')} {fmtDuration(Date.now() - new Date(fs.startedAt).getTime())}</span>
						<span class="flex items-center gap-2"><Icon name="memory" class="size-4" /> {fmtBytes(fs.memBytes)}</span>
						<span class="mono text-dim">PID {fs.pid}</span>
					{:else}
						<span class="flex items-center gap-2"><span class="size-2.5 rounded-full bg-bad"></span> {t('Servern är avstängd', 'Server is offline')}</span>
					{/if}
				</div>
			</div>
			{#if fs?.installed}
				<div class="flex flex-wrap gap-2.5">
					{#if !fs.running}
						<button class="btn btn-primary !px-6 !py-3 !text-[15px]" disabled={busy} onclick={() => act('forest/start', t('Startar The Forest…', 'Starting The Forest…'))}>
							<Icon name="play" class="size-4" /> {t('Starta', 'Start')}
						</button>
					{:else}
						<button class="btn !px-5 !py-3" disabled={busy} onclick={() => act('forest/restart', t('Startar om The Forest…', 'Restarting The Forest…'))}>
							<Icon name="restart" class="size-4" /> {t('Starta om', 'Restart')}
						</button>
						<button class="btn btn-danger !px-5 !py-3" disabled={busy} onclick={() => act('forest/stop', t('The Forest är stoppad', 'The Forest stopped'))}>
							<Icon name="stop" class="size-4" /> {t('Stoppa', 'Stop')}
						</button>
					{/if}
				</div>
			{/if}
		</div>
		{#if fs?.running}
			<p class="mt-5 text-xs text-dim relative">
				{t(
					`Servern sparar automatiskt var ${fs.config.serverAutoSaveInterval || 15}:e minut. Stoppa helst direkt efter en autosparning, annars försvinner det som hänt sedan dess.`,
					`The server autosaves every ${fs.config.serverAutoSaveInterval || 15} minutes. Stop it right after an autosave, or progress since then is lost.`
				)}
			</p>
		{/if}
	</section>

	{#if fs?.installed}
		<div class="grid lg:grid-cols-3 gap-6">
			<section class="card p-5 space-y-4">
				<div class="label">{t('Anslut', 'Connect')}</div>
				<div>
					<div class="text-xs text-dim mb-1">{t('Hemma (samma nätverk)', 'At home (same network)')}</div>
					<div class="mono text-text">{fs.address}</div>
				</div>
				<div class="text-sm text-muted space-y-1">
					<div>{t('Portar att öppna i routern (UDP+TCP):', 'Ports to open in the router (UDP+TCP):')}</div>
					<div class="mono text-text">{fs.ports.steam}, {fs.ports.game}, {fs.ports.query}</div>
				</div>
				<p class="text-xs text-dim">{t('I spelet: Multiplayer → Join → Dedicated, eller lägg till adressen som favorit i Steams serverlista.', 'In game: Multiplayer → Join → Dedicated, or add the address as a favorite in the Steam server browser.')}</p>
				<div class="border-t border-line pt-4">
					<div class="text-xs text-dim mb-1">{t('Senast sparad värld', 'Last saved world')}</div>
					{#if fs.lastSave}
						<div class="text-sm"><span class="text-text">{when(fs.lastSave.at)}</span> <span class="mono text-dim">({fs.lastSave.slot})</span></div>
					{:else}
						<div class="text-sm text-muted">{t('Ingen sparad värld hittades', 'No saved world found')}</div>
					{/if}
				</div>
			</section>

			<section class="card p-5 space-y-4 lg:col-span-2">
				<div class="label">{t('Inställningar', 'Settings')}</div>
				{#if form}
					<div class="grid sm:grid-cols-2 gap-4">
						{#each fs.fields.filter((f) => f.type !== 'bool') as f}
							<label class="block">
								<span class="text-xs text-dim">{f.label}</span>
								{#if f.type === 'select'}
									<select class="input mt-1" bind:value={form[f.key]}>
										{#each f.options as o}<option value={o}>{o}</option>{/each}
									</select>
								{:else if f.type === 'number'}
									<input class="input mt-1" type="number" min={f.min} max={f.max} bind:value={form[f.key]} />
								{:else if f.type === 'secret'}
									<input class="input mt-1" type="password" autocomplete="off" placeholder={fs.config[f.key] ? t('Token finns – fyll i för att byta', 'Token set – fill in to replace') : t('Ingen token – klistra in här', 'No token – paste here')} bind:value={form[f.key]} />
								{:else}
									<input class="input mt-1" type="text" maxlength="64" bind:value={form[f.key]} />
								{/if}
							</label>
						{/each}
					</div>
					<div class="grid sm:grid-cols-2 gap-2">
						{#each fs.fields.filter((f) => f.type === 'bool') as f}
							<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" bind:checked={form[f.key]} class="accent-amber-500" /> {f.label}</label>
						{/each}
					</div>
					<div class="flex items-center justify-between gap-3 flex-wrap">
						<p class="text-xs text-dim">{t('Ändringar gäller när servern startas om.', 'Changes apply when the server restarts.')}</p>
						<button class="btn btn-primary" disabled={saving} onclick={save}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button>
					</div>
				{/if}
			</section>
		</div>
	{/if}
</div>
