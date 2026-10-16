<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { api } from '$lib/api.js';
	import { t } from '$lib/i18n.svelte.js';

	let { ctx } = $props();

	let sources = $state([]);
	let source = $state(null);
	let lines = $state([]);
	let offset = -1;
	let filter = $state('');
	let follow = $state(true);
	let box;
	let timer;

	async function load(reset = false) {
		try {
			if (reset) {
				offset = -1;
				lines = [];
			}
			const r = await api(`palworld/log?source=${encodeURIComponent(source || '')}&offset=${offset}`);
			sources = r.sources;
			if (r.source !== source) {
				source = r.source;
				lines = [];
			}
			lines = r.reset ? r.lines : [...lines, ...r.lines].slice(-3000);
			offset = r.offset;
			if (follow) {
				await tick();
				if (box) box.scrollTop = box.scrollHeight;
			}
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	onMount(() => {
		load(true);
		timer = setInterval(() => load(false), 3000);
	});
	onDestroy(() => clearInterval(timer));

	let shown = $derived(filter.trim() ? lines.filter((l) => l.toLowerCase().includes(filter.trim().toLowerCase())) : lines);
</script>

<section class="card p-5 space-y-4">
	<div class="flex items-center gap-3 flex-wrap">
		<div class="flex gap-1.5 flex-wrap">
			{#each sources as s}
				<button class="btn btn-sm {source === s.id ? '!border-amber/60 !text-amber-2' : ''}" onclick={() => { source = s.id; load(true); }}>{s.label}</button>
			{/each}
		</div>
		<input class="input !w-56 ml-auto" placeholder={t('Filtrera…', 'Filter…')} bind:value={filter} />
		<label class="flex items-center gap-2 text-xs text-muted cursor-pointer"><input type="checkbox" class="accent-amber-500" bind:checked={follow} /> {t('Följ', 'Follow')}</label>
	</div>
	{#if !sources.length}
		<p class="text-sm text-muted">{t('Hittade inga loggfiler. Palworld skriver sin logg i Pal/Saved/Logs när servern körs.', 'No log files found. Palworld writes its log to Pal/Saved/Logs while running.')}</p>
	{:else}
		<div bind:this={box} class="bg-ink border border-line rounded-lg p-3 h-[560px] overflow-auto mono text-xs leading-relaxed">
			{#each shown as l}<div class="whitespace-pre-wrap break-all {/error|fatal/i.test(l) ? 'text-bad' : /warn/i.test(l) ? 'text-warn' : 'text-muted'}">{l}</div>{/each}
		</div>
	{/if}
</section>
