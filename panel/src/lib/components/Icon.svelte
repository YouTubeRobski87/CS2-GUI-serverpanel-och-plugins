<script>
	let { name, class: cls = 'size-5' } = $props();
	const P = {
		grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
		terminal: 'M4 17l6-6-6-6M12 19h8',
		users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
		trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
		puzzle: 'M19.4 13a1.9 1.9 0 1 0 0-3.8H18V6a2 2 0 0 0-2-2h-3.2v1.4a1.9 1.9 0 1 1-3.8 0V4H6a2 2 0 0 0-2 2v3.2h1.4a1.9 1.9 0 1 1 0 3.8H4V18a2 2 0 0 0 2 2h3.2v-1.4a1.9 1.9 0 1 1 3.8 0V20H16a2 2 0 0 0 2-2v-5z',
		sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
		download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
		play: 'M6 4l14 8-14 8z',
		stop: 'M6 6h12v12H6z',
		restart: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
		send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
		map: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4zM8 2v16M16 6v16',
		cpu: 'M9 9h6v6H9zM4 4h16v16H4zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3',
		memory: 'M3 7h18v10H3zM7 7v10M11 7v10M15 7v10M3 17l-1 3M21 17l1 3',
		x: 'M18 6 6 18M6 6l12 12',
		skull: 'M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6v3h10v-3c1.5-1 3-3 3-6a8 8 0 0 0-8-8zM9 12h.01M15 12h.01M10 19v2M14 19v2',
		swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
		ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2',
		refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
		check: 'M20 6 9 17l-5-5',
		alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
		plus: 'M12 5v14M5 12h14',
		trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
		database: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
		clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
		message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
		crosshair: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM22 12h-4M6 12H2M12 6V2M12 22v-4'
	};
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={cls} aria-hidden="true">
	<path d={P[name] || ''} />
</svg>
