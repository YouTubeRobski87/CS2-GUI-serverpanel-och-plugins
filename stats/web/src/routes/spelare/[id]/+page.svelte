<script lang="ts">
  import { ago, kd, modeName, pct, steamUrl, tier, weaponName } from '$lib/format';
  let { data } = $props();
  const p = $derived(data.player);
  const maxWeapon = $derived(Math.max(1, ...data.weapons.map((w) => w[1])));
</script>

<svelte:head>
  <title>{p.name} – Gamla Skolan CS2</title>
  <meta name="description" content="{p.name}: {p.points} poäng, {p.kills} kills, K/D {kd(p.kills, p.deaths)} på Gamla Skolan." />
</svelte:head>

<a class="back" href="/">← Topplistan</a>

<section class="head">
  <div>
    <span class="pos">{data.position ? `#${data.position} av ${data.totalPlayers}` : 'Ej rankad än'}</span>
    <h1>{p.name || 'Okänd'}</h1>
    <span class="tier">{tier(p.points)}</span>
  </div>
  <div class="meta">
    <a href={steamUrl(p.steam_id)} target="_blank" rel="noopener">Steam-profil ↗</a>
    <small>Senast sedd {ago(p.last_seen)}</small>
  </div>
</section>

<section class="stats">
  <div class="card"><small>Poäng</small><span class="num gold">{p.points}</span></div>
  <div class="card"><small>Kills</small><span class="num">{p.kills}</span></div>
  <div class="card"><small>Deaths</small><span class="num">{p.deaths}</span></div>
  <div class="card"><small>K/D</small><span class="num">{kd(p.kills, p.deaths)}</span></div>
  <div class="card"><small>Headshots</small><span class="num">{pct(p.headshots, p.tracked_kills)}</span></div>
  <div class="card"><small>Mot spelare / bottar</small><span class="num">{data.humanKills} / {data.botKills}</span></div>
</section>

<div class="grid">
  <section class="card">
    <h2>Vapen</h2>
    {#if data.weapons.length === 0}
      <p class="empty">Inga loggade kills än.</p>
    {:else}
      <ul class="bars">
        {#each data.weapons as [w, n]}
          <li>
            <span>{weaponName(w)}</span>
            <span class="bar"><span style="width:{(n / maxWeapon) * 100}%"></span></span>
            <span class="num">{n}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card">
    <h2>Lägen och kartor</h2>
    {#if data.modes.length === 0}
      <p class="empty">Inga loggade kills än.</p>
    {:else}
      <ul class="list">
        {#each data.modes as [m, n]}<li><span>{modeName(m)}</span><span class="num">{n}</span></li>{/each}
      </ul>
      <ul class="list maps">
        {#each data.maps as [m, n]}<li><span>{m}</span><span class="num">{n}</span></li>{/each}
      </ul>
    {/if}
  </section>

  <section class="card rivals">
    <h2>Rivaler</h2>
    <div>
      <small>Favoritoffer</small>
      {#if data.favoriteVictim}
        <a href="/spelare/{data.favoriteVictim.id}">{data.favoriteVictim.name}</a>
        <span class="num">{data.favoriteVictim.count} kills</span>
      {:else}<span class="muted">–</span>{/if}
    </div>
    <div>
      <small>Nemesis</small>
      {#if data.nemesis}
        <a href="/spelare/{data.nemesis.id}">{data.nemesis.name}</a>
        <span class="num">{data.nemesis.count} deaths</span>
      {:else}<span class="muted">–</span>{/if}
    </div>
  </section>

  <section class="card wide">
    <h2>Senaste händelser</h2>
    {#if data.recent.length === 0}
      <p class="empty">Inget loggat än.</p>
    {:else}
      <ul class="feed">
        {#each data.recent as k}
          {@const won = k.attacker_id === p.steam_id}
          <li class:lost={!won}>
            <span class="tag">{won ? 'KILL' : 'DÖD'}</span>
            {#if won}
              {#if k.victim_bot}<span class="muted">{k.victim_name}</span>{:else}<a href="/spelare/{k.victim_id}">{k.victim_name}</a>{/if}
            {:else}
              {#if k.attacker_bot}<span class="muted">{k.attacker_name}</span>{:else}<a href="/spelare/{k.attacker_id}">{k.attacker_name}</a>{/if}
            {/if}
            <span class="weapon">{weaponName(k.weapon)}{#if k.headshot} <b>HS</b>{/if}</span>
            <small>{modeName(k.mode)} · {k.map} · {ago(k.at)}</small>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .back { color: var(--muted); text-decoration: none; font-size: 0.9rem; }
  .back:hover { color: var(--gold); }
  .head { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 16px; padding: 18px 0 24px; }
  .pos { color: var(--gold); font-weight: 700; letter-spacing: 0.06em; }
  h1 { font-size: clamp(1.8rem, 6vw, 3rem); margin: 2px 0; overflow-wrap: anywhere; }
  .tier { color: var(--muted); }
  .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .meta a { color: var(--gold); text-decoration: none; }
  .meta small { color: var(--muted); }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .stats .card { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; }
  .stats small { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; }
  .stats span { font-size: 1.6rem; }
  .gold { color: var(--gold); }
  .muted { color: var(--muted); }
  .empty { color: var(--muted); margin: 8px 0; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .wide { grid-column: 1 / -1; }
  ul { list-style: none; margin: 0; padding: 0; }
  .bars li { display: grid; grid-template-columns: 110px 1fr 40px; gap: 10px; align-items: center; padding: 5px 0; font-size: 0.9rem; }
  .bars .num { text-align: right; color: var(--muted); }
  .bar { height: 8px; background: var(--panel-2); border-radius: 4px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--gold); border-radius: 4px; }
  .list li { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 0.92rem; }
  .list li:last-child { border-bottom: 0; }
  .list .num { color: var(--muted); }
  .maps { margin-top: 14px; }
  .maps li span:first-child { color: var(--muted); }
  .rivals div { display: flex; flex-direction: column; padding: 8px 0; }
  .rivals small { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; }
  .rivals a { font-weight: 600; font-size: 1.1rem; text-decoration: none; }
  .rivals a:hover { color: var(--gold); }
  .rivals .num { color: var(--muted); font-size: 0.85rem; }
  .feed li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 0.92rem; }
  .feed li:last-child { border-bottom: 0; }
  .feed .tag { font-size: 0.7rem; font-weight: 700; color: var(--green); width: 34px; }
  .feed li.lost .tag { color: var(--red); }
  .feed a { text-decoration: none; font-weight: 600; }
  .feed a:hover { color: var(--gold); }
  .feed .weapon { color: var(--gold); font-size: 0.85rem; }
  .feed b { color: var(--red); font-size: 0.75rem; }
  .feed small { color: var(--muted); margin-left: auto; font-size: 0.8rem; }
</style>
