<script>
	import { api } from '$lib/api.js';
	import Icon from './Icon.svelte';

	let { st, live, ctx } = $props();
	let showBots = $state(true);
	let banFor = $state(null);
	let banMinutes = $state(60);
	let banReason = $state('');
	let busy = $state(false);

	let players = $derived((live?.players ?? []).filter((p) => showBots || !p.bot));

	async function act(action, p, extra = {}) {
		busy = true;
		try {
			await api('player', { action, slot: p.slot, userid: p.userid, ...extra });
			ctx.toast(
				{ kick: `${p.name} kickades`, slay: `${p.name} slayades`, team: `${p.name} flyttades`, ban: `${p.name} bannades` }[action]
			);
			setTimeout(ctx.refreshLive, 600);
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			busy = false;
		}
	}

	async function doBan() {
		await act('ban', banFor, { minutes: banMinutes, reason: banReason || 'Bannad av admin' });
		banFor = null;
		banReason = '';
	}
	const kd = (p) => (p.deaths ? (p.kills / p.deaths).toFixed(2) : p.kills ?? '–');
</script>

<div class="space-y-4">
	<div class="flex items-center gap-4 flex-wrap">
		<h1 class="font-display font-extrabold text-2xl tracking-tight">Spelare</h1>
		<label class="flex items-center gap-2 text-sm text-muted ml-auto cursor-pointer">
			<input type="checkbox" bind:checked={showBots} class="accent-amber-500" /> Visa bottar
		</label>
		<button class="btn btn-sm" onclick={ctx.refreshLive}><Icon name="refresh" class="size-4" /> Uppdatera</button>
	</div>

	{#if !st.running}
		<div class="card p-8 text-center text-muted">Servern är avstängd.</div>
	{:else if !live}
		<div class="card p-8 text-center text-muted">Hämtar spelare…</div>
	{:else if live.ok === false && live.reason === 'bridge'}
		<div class="card p-6 text-warn text-sm">Bryggpluginet är inte igång än. Starta om servern från Översikt så laddas det.</div>
	{:else if live.ok === false}
		<div class="card p-6 text-bad text-sm">Kunde inte hämta spelare: {live.reason}</div>
	{:else}
		<div class="card overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left border-b border-line">
						<th class="label px-4 py-3">Lag</th>
						<th class="label px-4 py-3">Namn</th>
						<th class="label px-3 py-3 text-right">K</th>
						<th class="label px-3 py-3 text-right">D</th>
						<th class="label px-3 py-3 text-right">A</th>
						<th class="label px-3 py-3 text-right">K/D</th>
						<th class="label px-3 py-3 text-right">MVP</th>
						<th class="label px-3 py-3 text-right">Ping</th>
						<th class="label px-4 py-3 text-right">Åtgärder</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-line">
					{#each players as p (p.slot)}
						<tr class="hover:bg-panel-2/50">
							<td class="px-4 py-2.5">
								<span class="font-display font-bold text-xs px-2 py-1 rounded {p.team === 'CT' ? 'bg-ct/15 text-ct' : p.team === 'T' ? 'bg-t/15 text-t' : 'bg-panel-2 text-dim'}">{p.team}</span>
							</td>
							<td class="px-4 py-2.5">
								<div class="flex items-center gap-2">
									<span class="size-1.5 rounded-full {p.alive ? 'bg-ok' : 'bg-dim'}"></span>
									<span class={p.bot ? 'text-muted' : 'font-medium'}>{p.name}</span>
									{#if p.bot}<span class="label !text-[9px] px-1.5 py-0.5 rounded bg-panel-2">BOT</span>{/if}
								</div>
								{#if p.steamid}<div class="mono text-[11px] text-dim mt-0.5">{p.steamid}</div>{/if}
							</td>
							<td class="num px-3 text-right">{p.kills ?? '–'}</td>
							<td class="num px-3 text-right text-muted">{p.deaths ?? '–'}</td>
							<td class="num px-3 text-right text-muted">{p.assists ?? '–'}</td>
							<td class="num px-3 text-right">{kd(p)}</td>
							<td class="num px-3 text-right text-amber">{p.mvps ? '★'.repeat(Math.min(p.mvps, 3)) + (p.mvps > 3 ? p.mvps : '') : ''}</td>
							<td class="num px-3 text-right text-muted">{p.bot ? '' : p.ping}</td>
							<td class="px-4 py-2">
								<div class="flex justify-end gap-1.5">
									<button class="btn btn-sm" title="Till T" disabled={busy || !live.bridge} onclick={() => act('team', p, { team: 't' })}>T</button>
									<button class="btn btn-sm" title="Till CT" disabled={busy || !live.bridge} onclick={() => act('team', p, { team: 'ct' })}>CT</button>
									<button class="btn btn-sm" title="Till åskådare" disabled={busy || !live.bridge} onclick={() => act('team', p, { team: 'spec' })}>Spec</button>
									<button class="btn btn-sm btn-danger" title="Slay" disabled={busy || !live.bridge} onclick={() => act('slay', p)}><Icon name="skull" class="size-3.5" /></button>
									<button class="btn btn-sm btn-danger" title="Kicka" disabled={busy} onclick={() => act('kick', p)}>Kick</button>
									{#if !p.bot}
										<button class="btn btn-sm btn-danger" title="Banna" disabled={busy} onclick={() => (banFor = p)}><Icon name="ban" class="size-3.5" /></button>
									{/if}
								</div>
							</td>
						</tr>
					{:else}
						<tr><td colspan="9" class="px-4 py-8 text-center text-muted">Ingen inne just nu.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

	{/if}
</div>

{#if banFor}
	<div class="fixed inset-0 z-40 bg-black/60 grid place-items-center p-4" role="presentation" onclick={(e) => e.target === e.currentTarget && (banFor = null)}>
		<div class="card p-6 w-full max-w-md space-y-4">
			<h3 class="font-display font-bold text-lg">Banna {banFor.name}</h3>
			<div>
				<div class="label mb-1.5">Hur länge</div>
				<select class="input" bind:value={banMinutes}>
					<option value={30}>30 minuter</option>
					<option value={60}>1 timme</option>
					<option value={1440}>1 dag</option>
					<option value={10080}>1 vecka</option>
					<option value={0}>Permanent</option>
				</select>
			</div>
			<div>
				<div class="label mb-1.5">Anledning</div>
				<input class="input" bind:value={banReason} placeholder="Valfritt" maxlength="100" />
			</div>
			<p class="text-xs text-dim">Bannet sköts av AdminPlus och kan hävas med <span class="mono">!unban</span>.</p>
			<div class="flex justify-end gap-2">
				<button class="btn" onclick={() => (banFor = null)}>Avbryt</button>
				<button class="btn btn-primary !bg-bad !border-bad" disabled={busy} onclick={doBan}>Banna</button>
			</div>
		</div>
	</div>
{/if}
