<script>
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import { t } from '$lib/i18n.svelte.js';
	import Icon from './Icon.svelte';

	let { ps, ctx } = $props();

	let data = $state(null); // { groups, fields }
	let form = $state({});
	let orig = {};
	let q = $state('');
	let saving = $state(false);
	let raw = $state(null); // text när hela filen redigeras
	let rawPath = $state('');

	async function load() {
		try {
			data = await api('palworld/settings');
			const f = {};
			for (const x of data.fields) f[x.key] = Array.isArray(x.value) ? [...x.value] : x.value;
			form = f;
			orig = JSON.parse(JSON.stringify(f));
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	onMount(load);

	const same = (a, b) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : String(a ?? '') === String(b ?? ''));
	let changed = $derived(data ? data.fields.filter((f) => !same(form[f.key], orig[f.key])).map((f) => f.key) : []);

	let shown = $derived.by(() => {
		if (!data) return [];
		const s = q.trim().toLowerCase();
		return data.groups
			.map((g) => ({ ...g, fields: data.fields.filter((f) => f.group === g.id && (!s || f.label.toLowerCase().includes(s) || f.key.toLowerCase().includes(s))) }))
			.filter((g) => g.fields.length);
	});

	async function save() {
		saving = true;
		try {
			const values = {};
			for (const k of changed) values[k] = form[k];
			const r = await api('palworld/settings', { values });
			ctx.toast(r.running ? t(`Sparat (${r.changed}) – starta om servern så gäller det.`, `Saved (${r.changed}) – restart the server to apply.`) : t(`Sparat (${r.changed})`, `Saved (${r.changed})`));
			await load();
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = false;
		}
	}

	async function reset(key) {
		try {
			await api('palworld/settings/reset', { key });
			ctx.toast(t('Återställd till standard', 'Reset to default'));
			await load();
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}

	function toggleList(key, v) {
		const cur = form[key] || [];
		form[key] = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
	}

	async function openRaw() {
		try {
			const r = await api('palworld/ini');
			raw = r.text;
			rawPath = r.path;
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	async function saveRaw() {
		saving = true;
		try {
			await api('palworld/ini', { text: raw });
			ctx.toast(t('Filen sparad (en kopia av den gamla ligger som .bak)', 'File saved (the old one is kept as .bak)'));
			raw = null;
			await load();
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = false;
		}
	}
</script>

{#if raw !== null}
	<section class="card p-5 space-y-4">
		<div class="flex items-center justify-between gap-3 flex-wrap">
			<div>
				<div class="label">PalWorldSettings.ini</div>
				<div class="mono text-xs text-dim break-all mt-1">{rawPath}</div>
			</div>
			<div class="flex gap-2">
				<button class="btn" onclick={() => (raw = null)}>{t('Avbryt', 'Cancel')}</button>
				<button class="btn btn-primary" disabled={saving} onclick={saveRaw}><Icon name="check" class="size-4" /> {t('Spara filen', 'Save file')}</button>
			</div>
		</div>
		<p class="text-xs text-dim">{t('Allt står på en rad efter OptionSettings=( … ). Panelen kollar att parenteserna stämmer innan den sparar.', 'Everything is on one line after OptionSettings=( … ). The panel checks the parentheses before saving.')}</p>
		<textarea class="input mono !text-xs min-h-[420px] whitespace-pre-wrap break-all" spellcheck="false" bind:value={raw}></textarea>
	</section>
{:else if !data}
	<div class="text-muted">{t('Laddar…', 'Loading…')}</div>
{:else}
	<div class="space-y-5">
		<div class="card p-4 flex items-center gap-3 flex-wrap sticky top-[64px] z-10">
			<input class="input !w-72" placeholder={t('Sök inställning…', 'Search settings…')} bind:value={q} />
			<span class="text-sm text-muted">{data.fields.length} {t('inställningar', 'settings')}{#if changed.length} · <span class="text-amber-2">{changed.length} {t('ändrade', 'changed')}</span>{/if}</span>
			<div class="ml-auto flex gap-2">
				<button class="btn" onclick={openRaw}><Icon name="terminal" class="size-4" /> {t('Redigera hela filen', 'Edit whole file')}</button>
				{#if changed.length}<button class="btn" onclick={load}>{t('Ångra', 'Undo')}</button>{/if}
				<button class="btn btn-primary" disabled={saving || !changed.length} onclick={save}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button>
			</div>
		</div>
		{#if ps?.running}<p class="text-xs text-dim">{t('Servern läser filen när den startar – ändringar gäller efter omstart.', 'The server reads the file on start – changes apply after a restart.')}</p>{/if}

		{#each shown as g (g.id)}
			<section class="card p-5 space-y-4">
				<div class="label">{g.label}</div>
				<div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-4">
					{#each g.fields as f (f.key)}
						<div class="min-w-0 {changed.includes(f.key) ? 'border-l-2 border-amber pl-3 -ml-3' : ''}">
							<div class="flex items-center justify-between gap-2">
								{#if f.type === 'bool'}
									<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500" checked={form[f.key] === 'True'} onchange={(e) => (form[f.key] = e.currentTarget.checked ? 'True' : 'False')} /> {f.label}</label>
								{:else}
									<span class="text-xs text-dim">{f.label}</span>
								{/if}
								{#if f.group !== 'other' && !f.secret}
									<button class="text-[11px] text-dim hover:text-amber-2 shrink-0" title={t('Återställ till spelets standard', 'Reset to game default')} onclick={() => reset(f.key)}>{t('standard', 'default')}</button>
								{/if}
							</div>
							{#if f.type === 'select'}
								<select class="input mt-1" bind:value={form[f.key]}>
									{#each f.options || [] as o}<option value={o.value}>{o.label}</option>{/each}
									{#if !(f.options || []).some((o) => o.value === form[f.key])}<option value={form[f.key]}>{form[f.key]}</option>{/if}
								</select>
							{:else if f.type === 'float' || f.type === 'int'}
								<div class="flex items-center gap-3 mt-1">
									{#if f.min !== undefined && f.max !== undefined && f.max - f.min <= 50}
										<input type="range" class="flex-1 accent-amber-500" min={f.min} max={f.max} step={f.step ?? (f.type === 'int' ? 1 : 0.1)} bind:value={form[f.key]} />
									{/if}
									<input class="input !w-28 num" type="number" min={f.min} max={f.max} step={f.step ?? (f.type === 'int' ? 1 : 0.1)} bind:value={form[f.key]} />
								</div>
							{:else if f.type === 'list' && f.options}
								<div class="flex flex-wrap gap-3 mt-2">
									{#each f.options as o}
										<label class="flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500" checked={(form[f.key] || []).includes(o.value)} onchange={() => toggleList(f.key, o.value)} /> {o.label}</label>
									{/each}
								</div>
							{:else if f.type === 'list'}
								<input class="input mt-1 mono" value={(form[f.key] || []).join(',')} onchange={(e) => (form[f.key] = e.currentTarget.value.split(',').map((x) => x.trim()).filter(Boolean))} />
							{:else if f.secret}
								<input class="input mt-1" type="password" autocomplete="off" placeholder={f.isSet ? t('Satt – fyll i för att byta', 'Set – fill in to change') : t('Inte satt', 'Not set')} bind:value={form[f.key]} />
							{:else if f.type === 'bool'}
								<!-- kryssrutan sitter i rubriken -->
							{:else}
								<input class="input mt-1 {f.type === 'raw' ? 'mono' : ''}" type="text" bind:value={form[f.key]} />
							{/if}
							{#if f.hint}<div class="text-[11px] text-dim mt-1">{f.hint}</div>{/if}
							<div class="text-[10px] text-dim/70 mono mt-0.5 truncate">{f.key}</div>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
{/if}
