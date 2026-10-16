<script>
	import { onMount } from 'svelte';
	import { api, fmtBytes } from '$lib/api.js';
	import { t } from '$lib/i18n.svelte.js';
	import Icon from './Icon.svelte';

	let { ps, ctx } = $props();

	let data = $state(null);
	let busy = $state(false);
	let label = $state('');
	const c = ps.cfg.backup;
	let f = $state({ ...c });

	async function load() {
		try {
			data = await api('palworld/backups');
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	onMount(load);

	async function run(path, body, okText, ask) {
		if (ask && !confirm(ask)) return;
		busy = true;
		try {
			await api(path, body);
			ctx.toast(okText);
			await load();
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			busy = false;
		}
	}
	async function saveCfg() {
		try {
			await api('palworld/panel', { backup: f });
			ctx.toast(t('Sparat', 'Saved'));
			await load();
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	const when = (iso) => new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'medium' });
	const labelText = (l) => ({ auto: t('automatisk', 'automatic'), stopp: t('vid stopp', 'on stop'), 'fore-aterstallning': t('före återställning', 'before restore') })[l] ?? l;
</script>

<div class="grid lg:grid-cols-3 gap-6">
	<section class="card p-5 space-y-4 lg:col-span-2">
		<div class="flex items-center justify-between gap-3 flex-wrap">
			<div class="label">{t('Backuper', 'Backups')} {#if data}({data.list.length}){/if}</div>
			<div class="flex gap-2">
				<input class="input !w-48" maxlength="30" placeholder={t('Namn (valfritt)', 'Name (optional)')} bind:value={label} />
				<button class="btn btn-primary" disabled={busy} onclick={async () => { await run('palworld/backup', { label }, t('Backup klar', 'Backup done')); label = ''; }}><Icon name="database" class="size-4" /> {t('Gör backup nu', 'Back up now')}</button>
			</div>
		</div>
		{#if !data}
			<div class="text-muted text-sm">{t('Laddar…', 'Loading…')}</div>
		{:else if !data.list.length}
			<p class="text-sm text-muted">{t('Inga backuper än.', 'No backups yet.')}</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="text-xs text-dim text-left"><tr><th class="py-2 pr-3">{t('Tid', 'Time')}</th><th class="pr-3">{t('Typ', 'Type')}</th><th class="pr-3">{t('Storlek', 'Size')}</th><th></th></tr></thead>
					<tbody>
						{#each data.list as b (b.name)}
							<tr class="border-t border-line">
								<td class="py-2 pr-3">{when(b.at)}</td>
								<td class="pr-3 text-muted">{b.label ? labelText(b.label) : t('manuell', 'manual')}</td>
								<td class="pr-3 num">{fmtBytes(b.bytes)}</td>
								<td class="text-right whitespace-nowrap">
									<button class="btn btn-sm" disabled={busy || ps.running} title={ps.running ? t('Stoppa servern först', 'Stop the server first') : ''} onclick={() => run('palworld/backup/restore', { name: b.name }, t('Världen återställd', 'World restored'), t(`Återställa världen till ${when(b.at)}? Den nuvarande världen sparas först som en egen backup.`, `Restore the world to ${when(b.at)}? The current world is backed up first.`))}><Icon name="restart" class="size-3.5" /> {t('Återställ', 'Restore')}</button>
									<button class="btn btn-sm btn-danger" disabled={busy} onclick={() => run('palworld/backup/delete', { name: b.name }, t('Borttagen', 'Deleted'), t('Ta bort backupen för gott?', 'Delete this backup for good?'))}><Icon name="trash" class="size-3.5" /></button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		{#if ps.running}<p class="text-xs text-dim">{t('Återställning kräver att servern är stoppad.', 'Restoring requires the server to be stopped.')}</p>{/if}
	</section>

	<section class="card p-5 space-y-4">
		<div class="label">{t('Inställningar för backup', 'Backup settings')}</div>
		<label class="block">
			<span class="text-xs text-dim">{t('Mapp för backuper', 'Backup folder')}</span>
			<input class="input mt-1 mono" bind:value={f.dir} />
		</label>
		<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500" bind:checked={f.auto} /> {t('Automatisk backup medan servern är igång', 'Automatic backup while the server runs')}</label>
		<div class="grid grid-cols-2 gap-4">
			<label class="block">
				<span class="text-xs text-dim">{t('Var … timme', 'Every … hours')}</span>
				<input class="input mt-1" type="number" min="0.25" max="168" step="0.25" bind:value={f.everyHours} />
			</label>
			<label class="block">
				<span class="text-xs text-dim">{t('Spara de senaste', 'Keep the latest')}</span>
				<input class="input mt-1" type="number" min="1" max="500" bind:value={f.keep} />
			</label>
		</div>
		<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500" bind:checked={f.onStop} /> {t('Backup när servern stoppas eller startas om', 'Back up when the server stops or restarts')}</label>
		<p class="text-xs text-dim">{t('Bara automatiska backuper rensas bort. De du gör själv sparas tills du tar bort dem.', 'Only automatic backups are pruned. The ones you make yourself stay until you delete them.')}</p>
		<div class="flex justify-end"><button class="btn btn-primary" onclick={saveCfg}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button></div>
	</section>
</div>
