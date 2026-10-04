<script>
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';

	let list = $state(null);
	let q = $state('');

	// Samma nivåer som rankpluginet använder.
	const tiers = [
		[3000, 'Global Elite', '#f5a524'],
		[2000, 'Supreme Master', '#e879f9'],
		[1400, 'Legendary Eagle', '#a78bfa'],
		[900, 'Distinguished Master', '#60a5fa'],
		[500, 'Master Guardian', '#34d399'],
		[250, 'Gold Nova', '#facc15'],
		[100, 'Silver Elite', '#cbd5e1'],
		[0, 'Silver I', '#94a3b8']
	];
	const tier = (p) => tiers.find(([min]) => p >= min);
	const next = (p) => [...tiers].reverse().find(([min]) => min > p);

	async function load() {
		try {
			list = await api('rankings');
		} catch {
			list = [];
		}
	}
	onMount(load);

	let shown = $derived((list ?? []).filter((p) => !q || p.Name.toLowerCase().includes(q.toLowerCase())));
	const ago = (d) => {
		const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
		return days <= 0 ? 'idag' : days === 1 ? 'igår' : `${days} dagar sedan`;
	};
</script>

<div class="space-y-4">
	<div class="flex items-center gap-4 flex-wrap">
		<h1 class="font-display font-extrabold text-2xl tracking-tight">Topplista</h1>
		<input class="input !w-60 ml-auto" placeholder="Sök spelare…" bind:value={q} />
		<button class="btn btn-sm" onclick={load}>Uppdatera</button>
	</div>

	{#if list === null}
		<div class="text-muted">Laddar…</div>
	{:else if !list.length}
		<div class="card p-8 text-center text-muted">Ingen har fått rankpoäng ännu.</div>
	{:else}
		{#if !q && list.length >= 1}
			<div class="grid sm:grid-cols-3 gap-4">
				{#each list.slice(0, 3) as p, i}
					{@const t = tier(p.Points)}
					<div class="card p-5 relative overflow-hidden {i === 0 ? '!border-amber/50' : ''}">
						<div class="absolute right-4 top-3 font-display font-extrabold text-5xl text-line-2">#{i + 1}</div>
						<div class="label !text-[10px]" style="color:{t[2]}">{t[1]}</div>
						<div class="font-display font-bold text-xl mt-1 truncate pr-12">{p.Name}</div>
						<div class="num text-3xl font-extrabold mt-3 text-amber">{p.Points}<span class="text-sm text-muted font-medium ml-1">p</span></div>
						<div class="text-sm text-muted mt-1">{p.Kills} kills · {p.Deaths} deaths</div>
					</div>
				{/each}
			</div>
		{/if}
		<div class="card overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left border-b border-line">
						<th class="label px-4 py-3 w-12">#</th>
						<th class="label px-4 py-3">Spelare</th>
						<th class="label px-4 py-3">Nivå</th>
						<th class="label px-3 py-3 text-right">Poäng</th>
						<th class="label px-3 py-3 text-right">Kills</th>
						<th class="label px-3 py-3 text-right">Deaths</th>
						<th class="label px-3 py-3 text-right">K/D</th>
						<th class="label px-4 py-3 text-right">Senast sedd</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-line">
					{#each shown as p}
						{@const t = tier(p.Points)}
						{@const n = next(p.Points)}
						<tr class="hover:bg-panel-2/50">
							<td class="num px-4 py-2.5 text-dim">{list.indexOf(p) + 1}</td>
							<td class="px-4 font-medium">{p.Name}</td>
							<td class="px-4">
								<span class="text-xs font-display font-bold" style="color:{t[2]}">{t[1]}</span>
								{#if n}
									<div class="h-1 w-28 bg-line rounded mt-1.5 overflow-hidden" title="{n[0] - p.Points} p kvar till {n[1]}">
										<div class="h-full rounded" style="width:{((p.Points - t[0]) / (n[0] - t[0])) * 100}%;background:{t[2]}"></div>
									</div>
								{/if}
							</td>
							<td class="num px-3 text-right text-amber font-bold">{p.Points}</td>
							<td class="num px-3 text-right">{p.Kills}</td>
							<td class="num px-3 text-right text-muted">{p.Deaths}</td>
							<td class="num px-3 text-right">{p.Deaths ? (p.Kills / p.Deaths).toFixed(2) : p.Kills}</td>
							<td class="px-4 text-right text-muted">{ago(p.LastSeenUtc)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
