<script>
	import { onMount } from 'svelte';
	import { api, chatPreview, CHAT_COLORS } from '$lib/api.js';
	import { t, i18n } from '$lib/i18n.svelte.js';
	import Icon from './Icon.svelte';

	let { st, ctx } = $props();
	let cfg = $state(null);
	let panel = $state(null);
	let modes = $state(null);
	let builtin = $state([]);
	let saving = $state('');
	let focusIdx = $state(0);
	let gsltInput = $state('');
	let prefix = $state('');
	let editing = $state(null); // { id, isNew, name, description, args, enable, disable, maps, mariadb }
	let zombie = $state(null);

	async function load() {
		try {
			[cfg, panel] = await Promise.all([api('config'), api('settings')]);
			prefix = cfg.GamlaSkolanLage?.values?.Prefix ?? '';
			await loadModes();
			if (modes?.zombie) zombie = await api('zombie');
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	async function loadModes() {
		const r = await api('modes');
		modes = r.modes;
		builtin = r.builtin;
	}
	onMount(load);

	async function save(name) {
		saving = name;
		try {
			const r = await api('config', { name, values: cfg[name].values });
			cfg[name].values = r.saved;
			ctx.toast(r.reloaded ? t(`${cfg[name].title}: sparat och omladdat`, `${cfg[name].title}: saved and reloaded`) : t(`${cfg[name].title}: sparat – gäller vid nästa start`, `${cfg[name].title}: saved – applies on next start`));
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = '';
		}
	}

	async function savePrefix() {
		saving = 'prefix';
		try {
			await api('prefix', { prefix });
			ctx.toast(t('Chatt-taggen är sparad i alla plugins', 'Chat tag saved in all plugins'));
			await load();
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = '';
		}
	}

	async function saveGslt(clear = false) {
		saving = 'gslt';
		try {
			const r = await api('gslt', { token: clear ? '' : gsltInput });
			panel.gslt = r.gslt;
			panel.checks.gslt = !!r.gslt;
			gsltInput = '';
			ctx.toast(clear ? t('GSLT-token borttagen', 'GSLT token removed') : t('GSLT-token sparad', 'GSLT token saved'));
			ctx.refreshState();
			panel = { ...panel, ...(await api('settings')) };
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = '';
		}
	}

	async function savePanel() {
		saving = 'panel';
		try {
			await api('settings', panel);
			ctx.toast(t('Panelinställningar sparade', 'Panel settings saved'));
			await load();
			ctx.refreshState();
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = '';
		}
	}

	// ---- lägen ----
	function editMode(id) {
		const m = modes[id];
		editing = {
			id,
			isNew: false,
			name: m.name,
			description: m.description ?? '',
			args: m.args,
			enable: (m.enable ?? []).join('\n'),
			disable: (m.disable ?? []).join('\n'),
			maps: (m.maps ?? []).join('\n'),
			mariadb: !!m.mariadb
		};
	}
	function newMode() {
		editing = {
			id: '',
			isNew: true,
			name: '',
			description: '',
			args: '-dedicated -console -usercon -port {port} +game_type 0 +game_mode 1 +mapgroup mg_active +map de_dust2 +sv_setsteamaccount {gslt} +exec server.cfg',
			enable: '',
			disable: '',
			maps: '',
			mariadb: false
		};
	}
	async function saveEditing() {
		saving = 'mode';
		try {
			await api('modes/save', { id: editing.id, mode: editing });
			ctx.toast(t(`Läget ${editing.name || editing.id} är sparat`, `Mode ${editing.name || editing.id} saved`));
			editing = null;
			await loadModes();
			ctx.refreshState();
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = '';
		}
	}
	async function removeMode(id) {
		if (!confirm(t(`Ta bort läget "${modes[id].name}"? Plugin-mapparna rörs inte.`, `Remove the mode "${modes[id].name}"? Plugin folders are not touched.`))) return;
		try {
			await api('modes/delete', { id });
			editing = null;
			await loadModes();
			ctx.refreshState();
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}
	async function resetMode(id) {
		try {
			await api('modes/reset', { id });
			editing = null;
			await loadModes();
			ctx.refreshState();
			ctx.toast(t('Läget är återställt', 'Mode reset'));
		} catch (e) {
			ctx.toast(e.message, 'error');
		}
	}

	async function saveZombie(restart = false) {
		saving = 'zombie';
		try {
			const values = Object.fromEntries(zombie.fields.map((f) => [f.path, f.value]));
			zombie = await api('zombie', { values });
			if (restart) {
				await api('restart', { mode: 'zombie' });
				ctx.toast(t('Zombie-inställningar sparade – servern startar om i Zombie-läget', 'Zombie settings saved – restarting the server in Zombie mode'));
			} else {
				ctx.toast(t('Zombie-inställningar sparade – gäller nästa gång Zombie startas', 'Zombie settings saved – applies next time Zombie starts'));
			}
		} catch (e) {
			ctx.toast(e.message, 'error');
		} finally {
			saving = '';
		}
	}

	function insertColor(c) {
		const msgs = cfg.GamlaSkolanAds.values.Messages;
		msgs[focusIdx] = (msgs[focusIdx] ?? '') + `{${c}}`;
	}
	const colorKeys = ['default', 'green', 'lightgreen', 'red', 'gold', 'yellow', 'blue', 'lightblue', 'purple', 'grey'];
	let setup = $derived(panel?.setup ?? st?.setup);
</script>

<div class="space-y-6">
	<h1 class="font-display font-extrabold text-2xl tracking-tight">{t('Inställningar', 'Settings')}</h1>

	{#if !cfg || !panel}
		<div class="text-muted">{t('Laddar…', 'Loading…')}</div>
	{:else}
		<!-- Kom igång -->
		<section class="card p-6 space-y-4 {setup && !setup.ok ? '!border-warn/50' : ''}">
			<div class="flex items-center gap-3 flex-wrap">
				<Icon name={setup?.ok ? 'check' : 'alert'} class="size-5 {setup?.ok ? 'text-ok' : 'text-warn'}" />
				<h2 class="font-display font-bold text-lg">{t('Kom igång', 'Getting started')}</h2>
				<span class="text-sm text-muted">{setup?.ok ? t('Allt som behövs finns på plats', 'Everything needed is in place') : t('Fixa de röda punkterna, sedan kan du starta servern', 'Fix the red items, then you can start the server')}</span>
			</div>
			{#if setup}
				<ul class="grid md:grid-cols-2 gap-2">
					{#each setup.items as it}
						<li class="rounded-lg border px-3 py-2.5 text-sm {it.ok ? 'border-line' : it.optional ? 'border-line' : 'border-bad/40 bg-bad/5'}">
							<div class="flex items-center gap-2 font-medium {it.ok ? 'text-ok' : it.optional ? 'text-muted' : 'text-bad'}">
								<Icon name={it.ok ? 'check' : 'alert'} class="size-4" />
								{it.label}
								{#if it.optional}<span class="text-xs text-dim font-normal">({t('valfritt', 'optional')})</span>{/if}
							</div>
							{#if !it.ok}<div class="text-xs text-muted mt-1 pl-6">{it.hint}</div>{/if}
						</li>
					{/each}
				</ul>
			{/if}

			<div class="pt-2 border-t border-line space-y-2">
				<div class="label">{t('GSLT-token (Game Server Login Token)', 'GSLT token (Game Server Login Token)')}</div>
				{#if panel.gslt}
					<div class="text-sm flex items-center gap-2 flex-wrap">
						<span class="mono text-ok">{panel.gslt}</span>
						<button class="btn btn-sm" disabled={saving === 'gslt'} onclick={() => saveGslt(true)}><Icon name="trash" class="size-3.5" /> {t('Ta bort', 'Remove')}</button>
					</div>
				{/if}
				<div class="flex flex-col sm:flex-row gap-3">
					<input class="input mono flex-1" type="password" autocomplete="off" spellcheck="false" bind:value={gsltInput} placeholder={panel.gslt ? t('Klistra in en ny token för att byta', 'Paste a new token to replace it') : t('Klistra in din token här', 'Paste your token here')} />
					<button class="btn btn-primary" disabled={saving === 'gslt' || !gsltInput.trim()} onclick={() => saveGslt(false)}><Icon name="check" class="size-4" /> {t('Spara token', 'Save token')}</button>
				</div>
				<p class="text-xs text-dim">
					{t('Skapa en gratis på', 'Create one for free at')}
					<a class="underline hover:text-amber" href="https://steamcommunity.com/dev/managegameservers" target="_blank" rel="noreferrer">steamcommunity.com/dev/managegameservers</a>
					{t('(app-id 730). Den sparas bara på den här datorn i panel-data/gslt.txt och visas aldrig i klartext.', '(app id 730). It is stored only on this computer in panel-data/gslt.txt and never shown in full.')}
				</p>
			</div>
		</section>

		<!-- Servernamn & chatt-tagg -->
		<section class="card p-6 space-y-4">
			<div class="flex items-center gap-3 flex-wrap">
				<Icon name="crosshair" class="size-5 text-amber" />
				<h2 class="font-display font-bold text-lg">{t('Servernamn & chatt-tagg', 'Server name & chat tag')}</h2>
			</div>
			{#if cfg.GamlaSkolanLage}
				{@const v = cfg.GamlaSkolanLage.values}
				<div>
					<div class="label mb-1.5">{t('Servernamn – syns i serverlistan', 'Server name – shown in the server browser')}</div>
					<div class="flex flex-col sm:flex-row gap-3">
						<input class="input flex-1" bind:value={v.Hostname} maxlength="63" placeholder="My CS2 Server – Retakes • DM • 1v1" />
						<button class="btn btn-primary" disabled={saving === 'GamlaSkolanLage' || !v.Hostname?.trim()} onclick={() => save('GamlaSkolanLage')}><Icon name="check" class="size-4" /> {t('Spara namn', 'Save name')}</button>
					</div>
					<p class="text-xs text-dim mt-1.5">{t('Gäller i alla lägen och används direkt när du sparar. Max 63 tecken.', 'Applies in every mode and takes effect as soon as you save. Max 63 characters.')}</p>
				</div>
				<div>
					<div class="label mb-1.5">{t('Chatt-tagg – står först i alla meddelanden från servern', 'Chat tag – shown first in every message from the server')}</div>
					<div class="flex flex-col sm:flex-row gap-3">
						<input class="input mono flex-1" bind:value={prefix} maxlength="64" placeholder={'{gold}[My Server]{default}'} />
						<button class="btn btn-primary" disabled={saving === 'prefix' || !prefix.trim()} onclick={savePrefix}><Icon name="check" class="size-4" /> {t('Spara tagg', 'Save tag')}</button>
					</div>
					<div class="mt-2 px-3 py-2 rounded-lg bg-black/50 text-[13px] font-medium" style="font-family:Verdana,Arial,sans-serif">
						{@html chatPreview(`${prefix} ${t('Pistolrunda (1/3) – skriv !vapen för att välja vapen.', 'Pistol round (1/3) – type !guns to pick your weapons.')}`)}
					</div>
					<p class="text-xs text-dim mt-1.5">{t('Färger: {gold}, {green}, {red}, {lightred}, {blue}, {default}. Sparas i lägesomröstningen, vapenvalet, MVP och tipsen.', 'Colours: {gold}, {green}, {red}, {lightred}, {blue}, {default}. Saved in the mode vote, weapon menu, MVP and tips.')}</p>
				</div>
				<div class="text-sm text-muted">
					{t('Språk i spelet följer panelens språk (nere till vänster):', 'In-game language follows the panel language (bottom left):')}
					<span class="text-text font-medium">{i18n.lang === 'sv' ? 'Svenska' : 'English'}</span>
				</div>
			{/if}
		</section>

		<!-- Lägen -->
		{#if modes}
			<section class="card p-6 space-y-4">
				<div class="flex items-center gap-3 flex-wrap">
					<Icon name="grid" class="size-5 text-amber" />
					<h2 class="font-display font-bold text-lg">{t('Spellägen', 'Game modes')}</h2>
					<span class="text-sm text-muted">{t('Vilka plugins som slås på/av och hur servern startas', 'Which plugins are turned on/off and how the server starts')}</span>
					<button class="btn btn-sm ml-auto" onclick={newMode}><Icon name="plus" class="size-3.5" /> {t('Nytt läge', 'New mode')}</button>
				</div>
				<div class="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
					{#each Object.entries(modes) as [id, m]}
						<button class="text-left rounded-xl border p-4 transition-colors {editing?.id === id ? 'border-amber/60 bg-amber/5' : 'border-line hover:border-amber/40'}" onclick={() => editMode(id)}>
							<div class="flex items-center gap-2">
								<span class="font-display font-bold">{m.name}</span>
								<span class="mono text-xs text-dim">{id}</span>
								{#if st.mode === id}<span class="ml-auto text-xs text-ok">{t('aktivt', 'active')}</span>{/if}
							</div>
							<div class="text-xs text-muted mt-1 line-clamp-2">{m.description}</div>
							<div class="text-xs text-dim mt-2">{t('Slår på', 'Enables')}: {(m.enable ?? []).map((r) => r.split('/').pop()).join(', ') || '–'}</div>
						</button>
					{/each}
				</div>

				{#if editing}
					<div class="rounded-xl border border-amber/40 p-4 space-y-4">
						<div class="grid md:grid-cols-[180px_1fr] gap-4">
							<div>
								<div class="label mb-1.5">{t('Id (kort, a–z)', 'Id (short, a–z)')}</div>
								<input class="input mono" bind:value={editing.id} disabled={!editing.isNew} maxlength="24" placeholder="aim" />
							</div>
							<div>
								<div class="label mb-1.5">{t('Namn', 'Name')}</div>
								<input class="input" bind:value={editing.name} maxlength="40" />
							</div>
						</div>
						<div>
							<div class="label mb-1.5">{t('Beskrivning', 'Description')}</div>
							<input class="input" bind:value={editing.description} maxlength="200" />
						</div>
						<div>
							<div class="label mb-1.5">{t('Startargument', 'Launch arguments')}</div>
							<textarea class="input mono text-[12px] min-h-20" bind:value={editing.args}></textarea>
							<p class="text-xs text-dim mt-1">{t('{port} och {gslt} fylls i automatiskt. Lägg till +exec dinfil.cfg för egna inställningar.', '{port} and {gslt} are filled in automatically. Add +exec yourfile.cfg for your own settings.')}</p>
						</div>
						<div class="grid md:grid-cols-3 gap-4">
							<div>
								<div class="label mb-1.5">{t('Slå på (en per rad)', 'Turn on (one per line)')}</div>
								<textarea class="input mono text-[12px] min-h-28" bind:value={editing.enable} placeholder="plugins/RetakesPlugin"></textarea>
							</div>
							<div>
								<div class="label mb-1.5">{t('Stäng av (en per rad)', 'Turn off (one per line)')}</div>
								<textarea class="input mono text-[12px] min-h-28" bind:value={editing.disable} placeholder="plugins/Deathmatch"></textarea>
							</div>
							<div>
								<div class="label mb-1.5">{t('Kartor i panelen (en per rad)', 'Maps in the panel (one per line)')}</div>
								<textarea class="input mono text-[12px] min-h-28" bind:value={editing.maps} placeholder="de_mirage"></textarea>
							</div>
						</div>
						<p class="text-xs text-dim">{t('Sökvägar räknas från addons/counterstrikesharp, t.ex. plugins/K4-Arenas eller shared/DeathmatchAPI. Avstängda plugins flyttas till _panel_disabled i servermappen.', 'Paths are relative to addons/counterstrikesharp, e.g. plugins/K4-Arenas or shared/DeathmatchAPI. Disabled plugins are moved to _panel_disabled in the server folder.')}</p>
						<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" bind:checked={editing.mariadb} class="accent-amber-500" /> {t('Starta MariaDB/MySQL först (startfilen anges under Panelen)', 'Start MariaDB/MySQL first (start file set under Panel)')}</label>
						<div class="flex flex-wrap gap-2 justify-end">
							{#if !editing.isNew}
								{#if builtin.includes(editing.id)}
									<button class="btn btn-sm" onclick={() => resetMode(editing.id)}>{t('Återställ standard', 'Reset to default')}</button>
								{/if}
								<button class="btn btn-sm btn-danger" onclick={() => removeMode(editing.id)}><Icon name="trash" class="size-3.5" /> {t('Ta bort', 'Remove')}</button>
							{/if}
							<button class="btn btn-sm" onclick={() => (editing = null)}>{t('Avbryt', 'Cancel')}</button>
							<button class="btn btn-primary" disabled={saving === 'mode' || !editing.id.trim()} onclick={saveEditing}><Icon name="check" class="size-4" /> {t('Spara läge', 'Save mode')}</button>
						</div>
						<p class="text-xs text-dim">{t('Omröstningen i spelet (!lage) känner till Retakes, Deathmatch och 1v1 Arenas. Egna lägen startar du från panelen.', 'The in-game vote (!mode) knows Retakes, Deathmatch and 1v1 Arenas. Custom modes are started from the panel.')}</p>
					</div>
				{/if}
			</section>
		{/if}

		<!-- Zombie -->
		{#if zombie}
			<section class="card p-6 space-y-4">
				<div class="flex items-center gap-3 flex-wrap">
					<Icon name="users" class="size-5 text-amber" />
					<h2 class="font-display font-bold text-lg">Zombie</h2>
					<span class="text-sm text-muted">{t('Gäller när Zombie-läget startas (om)', 'Applies when Zombie mode (re)starts')}</span>
				</div>
				{#if !zombie.exists}
					<p class="text-sm text-muted">{t('Starta Zombie-läget en gång så skapas inställningsfilen.', 'Start Zombie mode once to create the settings file.')}</p>
				{:else}
					<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
						{#each zombie.fields as f}
							<div>
								<div class="label mb-1.5">{f.label}</div>
								<input class="input num" type="number" min={f.min} max={f.max} step={f.step} bind:value={f.value} />
							</div>
						{/each}
					</div>
					<p class="text-xs text-dim">{t('Samma inställningar finns i spelet med !zm (för admins).', 'The same settings are available in game with !zm (admins).')}</p>
					<div class="flex flex-wrap gap-2 justify-end">
						<button class="btn" disabled={saving === 'zombie'} onclick={() => saveZombie(false)}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button>
						{#if st.running && st.mode === 'zombie'}
							<button class="btn btn-primary" disabled={saving === 'zombie'} onclick={() => saveZombie(true)}><Icon name="check" class="size-4" /> {t('Spara och starta om', 'Save and restart')}</button>
						{/if}
					</div>
				{/if}
			</section>
		{/if}

		<!-- Tips i chatten -->
		<section class="card p-6 space-y-4">
			<div class="flex items-center gap-3">
				<Icon name="message" class="size-5 text-amber" />
				<h2 class="font-display font-bold text-lg">{t('Tips i chatten', 'Chat tips')}</h2>
				<span class="text-sm text-muted">GamlaSkolanAds</span>
			</div>
			{#if cfg.GamlaSkolanAds}
				{@const v = cfg.GamlaSkolanAds.values}
				<div class="max-w-[220px]">
					<div class="label mb-1.5">{t('Var … sekund', 'Every … seconds')}</div>
					<input class="input num" type="number" min="15" max="3600" bind:value={v.IntervalSeconds} />
				</div>
				<div>
					<div class="flex items-center gap-2 mb-2 flex-wrap">
						<span class="label mr-2">{t('Meddelanden', 'Messages')}</span>
						{#each colorKeys as c}
							<button class="px-2 py-0.5 rounded text-xs mono border border-line hover:border-amber" style="color:{CHAT_COLORS[c]}" onclick={() => insertColor(c)} title={t('Lägg till färg i markerat meddelande', 'Add colour to the selected message')}>{c}</button>
						{/each}
					</div>
					<div class="space-y-3">
						{#each v.Messages as _, i}
							<div class="rounded-xl border p-3 {focusIdx === i ? 'border-amber/50' : 'border-line'}">
								<div class="flex gap-2">
									<input class="input mono text-[13px]" bind:value={v.Messages[i]} onfocus={() => (focusIdx = i)} maxlength="250" />
									<button class="btn btn-sm btn-danger" onclick={() => v.Messages.splice(i, 1)} title={t('Ta bort', 'Remove')}><Icon name="trash" class="size-3.5" /></button>
								</div>
								<div class="mt-2 px-3 py-2 rounded-lg bg-black/50 text-[13px] font-medium" style="font-family:Verdana,Arial,sans-serif">
									{@html chatPreview(`${v.Prefix} ${v.Messages[i]}`)}
								</div>
							</div>
						{/each}
					</div>
					<button class="btn btn-sm mt-3" onclick={() => { v.Messages.push(''); focusIdx = v.Messages.length - 1; }}><Icon name="plus" class="size-3.5" /> {t('Nytt meddelande', 'New message')}</button>
				</div>
				<div class="flex justify-end">
					<button class="btn btn-primary" disabled={saving === 'GamlaSkolanAds'} onclick={() => save('GamlaSkolanAds')}><Icon name="check" class="size-4" /> {t('Spara tips', 'Save tips')}</button>
				</div>
			{/if}
		</section>

		<div class="grid lg:grid-cols-3 gap-6">
			<!-- Vapenval -->
			<section class="card p-6 space-y-4">
				<div class="flex items-center gap-3">
					<Icon name="crosshair" class="size-5 text-amber" />
					<h2 class="font-display font-bold text-lg">{t('Vapenval (Retakes)', 'Weapon menu (Retakes)')}</h2>
				</div>
				{#if cfg.GamlaSkolanVapen}
					{@const v = cfg.GamlaSkolanVapen.values}
					<div class="grid grid-cols-2 gap-4">
						<div>
							<div class="label mb-1.5">{t('Pistolrundor', 'Pistol rounds')}</div>
							<input class="input num" type="number" min="0" max="10" bind:value={v.PistolRounds} />
						</div>
						<div>
							<div class="label mb-1.5">{t('AWP per lag', 'AWPs per team')}</div>
							<input class="input num" type="number" min="0" max="5" bind:value={v.AwpPerTeam} />
						</div>
					</div>
					<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" bind:checked={v.BotsCanGetAwp} class="accent-amber-500" /> {t('Bottar kan få AWP', 'Bots can get the AWP')}</label>
					<p class="text-sm text-muted">{t('Spelarna väljer vapen med !vapen / !guns.', 'Players pick weapons with !guns / !vapen.')}</p>
					<div class="flex justify-end">
						<button class="btn btn-primary" disabled={saving === 'GamlaSkolanVapen'} onclick={() => save('GamlaSkolanVapen')}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button>
					</div>
				{/if}
			</section>

			<!-- MVP -->
			<section class="card p-6 space-y-4">
				<div class="flex items-center gap-3">
					<Icon name="trophy" class="size-5 text-amber" />
					<h2 class="font-display font-bold text-lg">{t('MVP & killgräns', 'MVP & kill limit')}</h2>
				</div>
				{#if cfg.GamlaSkolanMvp}
					{@const v = cfg.GamlaSkolanMvp.values}
					<div class="grid grid-cols-2 gap-4">
						<div>
							<div class="label mb-1.5">{t('Kills för vinst', 'Kills to win')}</div>
							<input class="input num" type="number" min="5" max="1000" bind:value={v.KillLimit} />
						</div>
						<div>
							<div class="label mb-1.5">{t('Firande (sek)', 'Celebration (s)')}</div>
							<input class="input num" type="number" min="3" max="30" bind:value={v.CelebrationSeconds} />
						</div>
					</div>
					<p class="text-sm text-muted">{t('Gäller bara i deathmatch. Byter du siffra, ändra även tips i chatten som nämner den.', 'Deathmatch only. If you change the number, also update any chat tips that mention it.')}</p>
					<div class="flex justify-end">
						<button class="btn btn-primary" disabled={saving === 'GamlaSkolanMvp'} onclick={() => save('GamlaSkolanMvp')}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button>
					</div>
				{/if}
			</section>

			<!-- Rank -->
			<section class="card p-6 space-y-4">
				<div class="flex items-center gap-3">
					<Icon name="crosshair" class="size-5 text-amber" />
					<h2 class="font-display font-bold text-lg">Rank</h2>
				</div>
				{#if cfg.GamlaSkolanRank}
					{@const v = cfg.GamlaSkolanRank.values}
					<div class="grid grid-cols-2 gap-4">
						<div>
							<div class="label mb-1.5">{t('Poäng per kill', 'Points per kill')}</div>
							<input class="input num" type="number" min="0" max="1000" bind:value={v.PointsPerKill} />
						</div>
						<div>
							<div class="label mb-1.5">{t('Poäng bort per död', 'Points lost per death')}</div>
							<input class="input num" type="number" min="0" max="1000" bind:value={v.PointsLostPerDeath} />
						</div>
						<div>
							<div class="label mb-1.5">{t('Minst antal människor', 'Minimum human players')}</div>
							<input class="input num" type="number" min="1" max="64" bind:value={v.MinimumHumanPlayers} />
						</div>
						<div>
							<div class="label mb-1.5">{t('Antal i !top', 'Entries in !top')}</div>
							<input class="input num" type="number" min="3" max="15" bind:value={v.TopCount} />
						</div>
					</div>
					<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" bind:checked={v.ShowPointMessages} class="accent-amber-500" /> {t('Visa poäng i chatten vid varje kill', 'Show points in chat on every kill')}</label>
					<p class="text-sm text-muted">{t('Bottar ger halva poängen.', 'Bots give half points.')}</p>
					<div class="flex justify-end">
						<button class="btn btn-primary" disabled={saving === 'GamlaSkolanRank'} onclick={() => save('GamlaSkolanRank')}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button>
					</div>
				{/if}
			</section>
		</div>

		<!-- Panel -->
		<section class="card p-6 space-y-4">
			<div class="flex items-center gap-3">
				<Icon name="sliders" class="size-5 text-amber" />
				<h2 class="font-display font-bold text-lg">{t('Panelen', 'Panel')}</h2>
			</div>
			<div class="grid md:grid-cols-2 gap-4">
				<div>
					<div class="label mb-1.5">{t('Servermapp (där game\\bin\\win64\\cs2.exe finns)', 'Server folder (contains game\\bin\\win64\\cs2.exe)')}</div>
					<input class="input mono text-[13px]" bind:value={panel.serverRoot} />
				</div>
				<div>
					<div class="label mb-1.5">SteamCMD</div>
					<input class="input mono text-[13px]" bind:value={panel.steamcmd} />
				</div>
				<div>
					<div class="label mb-1.5">{t('MariaDB/MySQL-startfil (valfri, för 1v1 Arenas)', 'MariaDB/MySQL start file (optional, for 1v1 Arenas)')}</div>
					<input class="input mono text-[13px]" bind:value={panel.mariadbBat} placeholder="C:\GameServers\MariaDB\start.bat" />
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<div class="label mb-1.5">Port</div>
						<input class="input num" type="number" bind:value={panel.port} />
					</div>
					<div>
						<div class="label mb-1.5">{t('Standardläge', 'Default mode')}</div>
						<select class="input" bind:value={panel.defaultMode}>
							{#each st.modes as m}<option value={m.id}>{m.name}</option>{/each}
						</select>
					</div>
				</div>
			</div>
			<div class="flex flex-wrap gap-4 text-sm">
				<span class="flex items-center gap-2 {panel.checks.gslt ? 'text-ok' : 'text-bad'}"><Icon name={panel.checks.gslt ? 'check' : 'alert'} class="size-4" /> {t('GSLT-token', 'GSLT token')} {panel.checks.gslt ? t('finns', 'set') : t('saknas', 'missing')}</span>
				<span class="flex items-center gap-2 {panel.checks.rcon ? 'text-ok' : 'text-muted'}"><Icon name={panel.checks.rcon ? 'check' : 'alert'} class="size-4" /> {t('RCON-lösenord', 'RCON password')} {panel.checks.rcon ? t('hittat', 'found') : t('saknas (valfritt – konsolen går via bryggpluginet)', 'missing (optional – the console uses the bridge plugin)')}</span>
			</div>
			<p class="text-xs text-dim">{t('RCON-lösenordet läses från server.cfg och sparas aldrig av panelen.', 'The RCON password is read from server.cfg and is never stored by the panel.')}</p>
			<div class="flex justify-end">
				<button class="btn btn-primary" disabled={saving === 'panel'} onclick={savePanel}><Icon name="check" class="size-4" /> {t('Spara', 'Save')}</button>
			</div>
		</section>
	{/if}
</div>
