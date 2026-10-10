<script>
	// Liten linjegraf för CPU/RAM-historik.
	let { values = [], max = 100, color = '#f5a524' } = $props();
	const W = 240,
		H = 48;
	let pts = $derived.by(() => {
		if (values.length < 2) return '';
		const m = Math.max(max, ...values, 1);
		return values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - (v / m) * (H - 4)).toFixed(1)}`).join(' ');
	});
	const gid = 'g' + Math.random().toString(36).slice(2);
</script>

<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="w-full h-12">
	<defs>
		<linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
			<stop offset="0%" stop-color={color} stop-opacity="0.28" />
			<stop offset="100%" stop-color={color} stop-opacity="0" />
		</linearGradient>
	</defs>
	{#if pts}
		<polygon points="0,{H} {pts} {W},{H}" fill="url(#{gid})" />
		<polyline points={pts} fill="none" stroke={color} stroke-width="1.8" vector-effect="non-scaling-stroke" />
	{/if}
</svg>
