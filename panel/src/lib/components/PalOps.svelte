<script>
	import { api } from '$lib/api.js';
	import { t } from '$lib/i18n.svelte.js';
	import Icon from './Icon.svelte';

	let { ps, ctx, reload } = $props();

	// Kopia av inställningarna som går att redigera (läses en gång när fliken öppnas).
	const c = JSON.parse(JSON.stringify(ps.cfg));
	let f = $state({ ...c, schedule: { ...c.schedule, times: c.schedule.times.join(', ') } });
	let saving = $state(false);

	async function save(part) {
		saving = true;
		try {
			const body = part === 'schedule' ? { schedule: f.schedule } : part === 'launch' ? { root: f.root, launch: f.launch } : part === 'webhook' ? { webhook: f.webhook } : { autoStart: f.autoStart, autoRestart: f.autoRestart, stopCountdown: f.stopCountdown };
			await api('palworld/panel', body);
			ctx.toast(part === 'launch' && ps.running ? t('Sparat – gäller nästa gång servern startar', 'Saved – applies next time the server starts') : t('Sparat', 'Saved'));
			reload();
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = false;
		}
	}
	async function testHook() {
		try {
			await api('palworld/panel', { webhook: f.webhook });
			await api('palworld/webhook/test', {});
			ctx.toast(t('Testmeddelande skickat till Discord', 'Test message sent to Discord'));
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	const when = (ms) => new Date(ms).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
</script>

<div class="grid lg:grid-cols-2 gap-6">
	<section class="card p-5 space-y-4">
		<div class="label">{t('Server och startargument', 'Server and launch arguments')}</div>
		<label class="block">
			<span class="text-xs text-dim">{t('Mappen där PalServer.exe ligger', 'Folder with PalServer.exe')}</span>
			<input class="input mt-1 mono" bind:value={f.root} />
		</label>
		<div class="grid grid-cols-2 gap-4">
			<label class="block">
				<span class="text-xs text-dim">{t('Port (-port, tomt = från ini)', 'Port (-port, empty = from ini)')}</span>
				<input class="input mt-1" type="number" min="1" max="65535" placeholder="8211" bind:value={f.launch.port} />
			</label>
			<label class="block">
				<span class="text-xs text-dim">{t('Max spelare (-players, tomt = från ini)', 'Max players (-players, empty = from ini)')}</span>
				<input class="input mt-1" type="number" min="1" max="32" bind:value={f.launch.players} />
			</label>
		</div>
		<label class="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500 mt-1" bind:checked={f.launch.publicLobby} /> <span>{t('Synas i listan Community Servers (-publiclobby)', 'Listed under Community Servers (-publiclobby)')}</span></label>
		<label class="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500 mt-1" bind:checked={f.launch.perf} /> <span>{t('Använd fler CPU-kärnor (-useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS)', 'Use more CPU cores (-useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS)')}</span></label>
		<label class="block">
			<span class="text-xs text-dim">{t('Egna argument (t.ex. -logformat=text)', 'Extra arguments (e.g. -logformat=text)')}</span>
			<input class="input mt-1 mono" bind:value={f.launch.extra} />
		</label>
		<div class="flex justify-end"><button class="btn btn-primary" disabled={saving} onclick={() => save('launch')}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button></div>
	</section>

	<section class="card p-5 space-y-4">
		<div class="label">{t('Drift', 'Operation')}</div>
		<label class="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500 mt-1" bind:checked={f.autoRestart} /> <span>{t('Starta om servern automatiskt om den kraschar', 'Restart the server automatically if it crashes')}<span class="block text-xs text-dim">{t('Panelen kollar var 10:e sekund. Kraschar den mer än 5 gånger på en timme slutar den försöka.', 'The panel checks every 10 seconds. If it crashes more than 5 times in an hour it stops trying.')}</span></span></label>
		<label class="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500 mt-1" bind:checked={f.autoStart} /> <span>{t('Starta Palworld när panelen startar', 'Start Palworld when the panel starts')}</span></label>
		<label class="block">
			<span class="text-xs text-dim">{t('Sekunder från Stoppa/Starta om till att servern går ner (spelarna får en varning)', 'Seconds from Stop/Restart until the server goes down (players are warned)')}</span>
			<input class="input mt-1 !w-32" type="number" min="1" max="600" bind:value={f.stopCountdown} />
		</label>
		<div class="flex justify-end"><button class="btn btn-primary" disabled={saving} onclick={() => save('ops')}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button></div>
	</section>

	<section class="card p-5 space-y-4">
		<div class="label">{t('Schemalagda omstarter', 'Scheduled restarts')}</div>
		<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500" bind:checked={f.schedule.enabled} /> {t('Starta om servern på bestämda tider', 'Restart the server at set times')}</label>
		<label class="block">
			<span class="text-xs text-dim">{t('Tider (24 h), kommaseparerade', 'Times (24 h), comma separated')}</span>
			<input class="input mt-1 mono" placeholder="06:00, 18:00" bind:value={f.schedule.times} />
		</label>
		<label class="block">
			<span class="text-xs text-dim">{t('Varna spelarna så många minuter innan', 'Warn players this many minutes before')}</span>
			<input class="input mt-1 !w-32" type="number" min="0" max="60" bind:value={f.schedule.warnMinutes} />
		</label>
		<p class="text-xs text-dim">{t('Världen sparas och en backup görs före varje omstart. Är servern avstängd vid tiden händer ingenting.', 'The world is saved and backed up before each restart. If the server is off at that time, nothing happens.')}{#if ps.nextRestart} {t('Nästa:', 'Next:')} <span class="text-text">{when(ps.nextRestart)}</span>{/if}</p>
		<div class="flex justify-end"><button class="btn btn-primary" disabled={saving} onclick={() => save('schedule')}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button></div>
	</section>

	<section class="card p-5 space-y-4">
		<div class="label">{t('Discord-notiser', 'Discord notifications')}</div>
		<label class="block">
			<span class="text-xs text-dim">{t('Webhook-adress (Kanalinställningar → Integrationer → Webhooks)', 'Webhook URL (Channel settings → Integrations → Webhooks)')}</span>
			<input class="input mt-1 mono" type="url" placeholder="https://discord.com/api/webhooks/…" bind:value={f.webhook.url} />
		</label>
		<div class="grid grid-cols-2 gap-2">
			{#each [['start', t('Servern startar', 'Server starts')], ['stop', t('Servern stoppas', 'Server stops')], ['crash', t('Krasch', 'Crash')], ['restart', t('Omstart', 'Restart')], ['update', t('Uppdatering', 'Update')], ['backup', 'Backup']] as [k, label]}
				<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="accent-amber-500" bind:checked={f.webhook[k]} /> {label}</label>
			{/each}
		</div>
		<div class="flex justify-end gap-2">
			<button class="btn" disabled={!f.webhook.url} onclick={testHook}><Icon name="send" class="size-4" /> {t('Testa', 'Test')}</button>
			<button class="btn btn-primary" disabled={saving} onclick={() => save('webhook')}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button>
		</div>
	</section>
</div>
