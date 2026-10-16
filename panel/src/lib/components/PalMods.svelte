<script>
	import { onMount } from 'svelte';
	import { api, fmtBytes } from '$lib/api.js';
	import { t } from '$lib/i18n.svelte.js';

	let { ps, ctx } = $props();

	let m = $state(null);
	let busy = $state(false);

	async function load() {
		try {
			m = await api('palworld/mods');
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	onMount(load);

	async function toggle(body) {
		busy = true;
		try {
			await api('palworld/mods', body);
			ctx.toast(ps.running ? t('Ändrat – gäller efter omstart', 'Changed – applies after restart') : t('Ändrat', 'Changed'));
			await load();
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			busy = false;
		}
	}
</script>

{#if !m}
	<div class="text-muted">{t('Laddar…', 'Loading…')}</div>
{:else}
	<div class="grid lg:grid-cols-2 gap-6">
		<section class="card p-5 space-y-4">
			<div class="flex items-center justify-between gap-3">
				<div class="label">{t('UE4SS-mods (Lua)', 'UE4SS mods (Lua)')}</div>
				<span class="text-xs {m.ue4ssInstalled ? 'text-ok' : 'text-dim'}">UE4SS {m.ue4ssInstalled ? t('installerat', 'installed') : t('saknas', 'missing')}</span>
			</div>
			{#if m.lua.length}
				<ul class="divide-y divide-line">
					{#each m.lua as mod (mod.name)}
						<li class="flex items-center justify-between gap-3 py-2">
							<span class="text-sm {mod.enabled ? 'text-text' : 'text-muted'}">{mod.name}</span>
							<label class="flex items-center gap-2 text-xs cursor-pointer text-muted">
								<input type="checkbox" class="accent-amber-500" checked={mod.enabled} disabled={busy} onchange={(e) => toggle({ kind: 'lua', name: mod.name, enabled: e.currentTarget.checked })} />
								{mod.enabled ? t('På', 'On') : t('Av', 'Off')}
							</label>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-muted">{t('Inga Lua-mods hittades.', 'No Lua mods found.')}</p>
			{/if}
			<p class="text-xs text-dim">{t('Lägg nya mods som egna mappar i', 'Put new mods as folders in')} <span class="mono break-all">{m.dirs.lua}</span></p>
		</section>

		<div class="space-y-6">
			<section class="card p-5 space-y-4">
				<div class="label">{t('PAK-mods', 'PAK mods')}</div>
				{#if m.paks.length}
					<ul class="divide-y divide-line">
						{#each m.paks as p (p.where + p.name)}
							<li class="flex items-center justify-between gap-3 py-2">
								<span class="text-sm min-w-0"><span class="{p.enabled ? 'text-text' : 'text-muted'} break-all">{p.name}</span> <span class="text-xs text-dim">{p.where} · {fmtBytes(p.bytes)}</span></span>
								<label class="flex items-center gap-2 text-xs cursor-pointer text-muted shrink-0">
									<input type="checkbox" class="accent-amber-500" checked={p.enabled} disabled={busy} onchange={(e) => toggle({ kind: 'pak', where: p.where, name: p.name, enabled: e.currentTarget.checked })} />
									{p.enabled ? t('På', 'On') : t('Av', 'Off')}
								</label>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-muted">{t('Inga .pak-mods hittades.', 'No .pak mods found.')}</p>
				{/if}
				<p class="text-xs text-dim">{t('.pak-filer läggs i', '.pak files go in')} <span class="mono break-all">{m.dirs.paks}</span> {t('(LogicMods för blueprint-mods). Avstängda får ändelsen .disabled.', '(LogicMods for blueprint mods). Disabled ones get a .disabled extension.')}</p>
			</section>

			{#if m.globalMods !== null}
				<section class="card p-5 space-y-3">
					<div class="label">{t('Palworlds egna modstöd', 'Palworld’s own mod support')}</div>
					<label class="flex items-start gap-2 text-sm cursor-pointer">
						<input type="checkbox" class="accent-amber-500 mt-1" checked={m.globalMods} disabled={busy} onchange={(e) => toggle({ kind: 'global', enabled: e.currentTarget.checked })} />
						<span>{t('Ladda mods via Mods/PalModSettings.ini (bGlobalEnableMod)', 'Load mods via Mods/PalModSettings.ini (bGlobalEnableMod)')}</span>
					</label>
				</section>
			{/if}
		</div>
	</div>
{/if}
