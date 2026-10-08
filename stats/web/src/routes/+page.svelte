<script lang="ts">
  import { ago, kd, modeName, pct, tier, weaponName } from '$lib/format';
  let { data } = $props();

  let sort = $state<'points' | 'kills' | 'kd' | 'hs'>('points');
  const sorted = $derived(
    [...data.players].sort((a, b) => {
      if (sort === 'kills') return b.kills - a.kills;
      if (sort === 'kd') return b.kills / Math.max(1, b.deaths) - a.kills / Math.max(1, a.deaths);
      if (sort === 'hs') return b.headshots / Math.max(1, b.tracked_kills) - a.headshots / Math.max(1, a.tracked_kills);
      return b.points - a.points || b.kills - a.kills;
    })
  );
  const maxWeapon = $derived(Math.max(1, ...data.weapons.map((w) => w.kills)));
  const podium = $derived(data.players.slice(0, 3));
</script>

<svelte:head>
  <title>Gamla Skolan – CS2-statistik</title>
  <meta name="description" content="Topplista och spelarstatistik för Gamla Skolan, svensk CS2-communityserver med Retakes, Deathmatch, 1v1 Arenas och Zombie." />
</svelte:head>

<section class="hero">
  <h1>Topplistan</h1>
  <p>Poäng för varje kill, minus för varje död. Bottar ger halva poängen. Rankning räknas när minst två riktiga spelare är inne.</p>
  <div class="totals">
    <div><span class="num">{data.players.length}</span><small>spelare</small></div>
    <div><span class="num">{data.totalKills.toLocaleString('sv-SE')}</span><small>loggade kills</small></div>
    <div><span class="num">{data.modes.length}</span><small>spellägen</small></div>
  </div>
</section>

{#if podium.length}
  <section class="podium">
    {#each podium as p, i}
      <a class="card place p{i + 1}" href="/spelare/{p.steam_id}">
        <span class="rank">#{i + 1}</span>
        <strong>{p.name}</strong>
        <span class="tier">{tier(p.points)}</span>
        <span class="num pts">{p.points}p</span>
        <small class="num">K/D {kd(p.kills, p.deaths)}</small>
      </a>
    {/each}
  </section>
{/if}

<section class="card table-card">
  <div class="table-head">
    <h2>Alla spelare</h2>
    <div class="sort" role="group" aria-label="Sortera">
      {#each [['points', 'Poäng'], ['kills', 'Kills'], ['kd', 'K/D'], ['hs', 'HS %']] as [key, label]}
        <button class:active={sort === key} onclick={() => (sort = key as typeof sort)}>{label}</button>
      {/each}
    </div>
  </div>

  {#if sorted.length === 0}
    <p class="empty">Ingen statistik än. Hoppa in på servern och bli först på listan!</p>
  {:else}
    <div class="scroll">
      <table>
        <thead>
          <tr><th>#</th><th>Spelare</th><th>Rank</th><th class="r">Poäng</th><th class="r">K</th><th class="r">D</th><th class="r">K/D</th><th class="r">HS</th><th>Senast</th></tr>
        </thead>
        <tbody>
          {#each sorted as p, i}
            <tr>
              <td class="num muted">{i + 1}</td>
              <td><a href="/spelare/{p.steam_id}">{p.name || 'Okänd'}</a></td>
              <td class="muted">{tier(p.points)}</td>
              <td class="r num gold">{p.points}</td>
              <td class="r num">{p.kills}</td>
              <td class="r num">{p.deaths}</td>
              <td class="r num">{kd(p.kills, p.deaths)}</td>
              <td class="r num">{pct(p.headshots, p.tracked_kills)}</td>
              <td class="muted">{ago(p.last_seen)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<div class="grid">
  <section class="card">
    <h2>Populäraste vapnen</h2>
    {#if data.weapons.length === 0}
      <p class="empty">Inga kills loggade än.</p>
    {:else}
      <ul class="bars">
        {#each data.weapons as w}
          <li>
            <span>{weaponName(w.weapon)}</span>
            <span class="bar"><span style="width:{(w.kills / maxWeapon) * 100}%"></span></span>
            <span class="num">{w.kills}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card">
    <h2>Spellägen</h2>
    {#if data.modes.length === 0}
      <p class="empty">Inga kills loggade än.</p>
    {:else}
      <ul class="modes">
        {#each data.modes as m}
          <li><strong>{modeName(m.mode)}</strong><span class="num">{m.kills} kills</span><small>{m.players} spelare</small></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card wide">
    <h2>Senaste kills</h2>
    {#if data.recent.length === 0}
      <p class="empty">Inga kills loggade än.</p>
    {:else}
      <ul class="feed">
        {#each data.recent as k}
          <li>
            {#if k.attacker_bot}<span class="bot">{k.attacker_name}</span>{:else}<a href="/spelare/{k.attacker_id}">{k.attacker_name}</a>{/if}
            <span class="weapon">{weaponName(k.weapon)}{#if k.headshot} <b title="Headshot">HS</b>{/if}</span>
            {#if k.victim_bot}<span class="bot">{k.victim_name}</span>{:else}<a href="/spelare/{k.victim_id}">{k.victim_name}</a>{/if}
            <small>{modeName(k.mode)} · {k.map} · {ago(k.at)}</small>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .hero { padding: 24px 0 28px; }
  .hero h1 { font-size: clamp(2rem, 6vw, 3.2rem); margin: 0 0 8px; }
  .hero p { color: var(--muted); max-width: 60ch; margin: 0 0 20px; }
  .totals { display: flex; flex-wrap: wrap; gap: 28px; }
  .totals div { display: flex; flex-direction: column; }
  .totals span { font-size: 1.7rem; color: var(--gold); }
  .totals small { color: var(--muted); font-size: 0.8rem; }

  .podium { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .place { text-decoration: none; display: flex; flex-direction: column; gap: 2px; position: relative; }
  .place.p1 { border-color: var(--gold); background: linear-gradient(160deg, var(--gold-soft), var(--panel) 60%); }
  .place .rank { color: var(--gold); font-weight: 700; }
  .place strong { font-size: 1.15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .place .tier { color: var(--muted); font-size: 0.85rem; }
  .place .pts { font-size: 1.4rem; margin-top: 6px; }
  .place small { color: var(--muted); }

  .table-card { margin-bottom: 16px; }
  .table-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
  .table-head h2 { margin: 0; }
  .sort { display: flex; gap: 4px; }
  .sort button {
    background: transparent; border: 1px solid var(--line); color: var(--muted); padding: 5px 10px;
    border-radius: 6px; cursor: pointer; font: inherit; font-size: 0.8rem;
  }
  .sort button.active { border-color: var(--gold); color: var(--gold); }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.92rem; min-width: 640px; }
  th { text-align: left; color: var(--muted); font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 8px; border-bottom: 1px solid var(--line); }
  td { padding: 9px 8px; border-bottom: 1px solid var(--line); }
  tr:last-child td { border-bottom: 0; }
  td a { text-decoration: none; font-weight: 600; }
  td a:hover { color: var(--gold); }
  .r { text-align: right; }
  .muted { color: var(--muted); }
  .gold { color: var(--gold); }
  .empty { color: var(--muted); margin: 8px 0; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
  .wide { grid-column: 1 / -1; }
  ul { list-style: none; margin: 0; padding: 0; }
  .bars li { display: grid; grid-template-columns: 110px 1fr 48px; gap: 10px; align-items: center; padding: 5px 0; font-size: 0.9rem; }
  .bars .num { text-align: right; color: var(--muted); }
  .bar { height: 8px; background: var(--panel-2); border-radius: 4px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--gold); border-radius: 4px; }
  .modes li { display: flex; align-items: baseline; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .modes li:last-child { border-bottom: 0; }
  .modes strong { flex: 1; }
  .modes small { color: var(--muted); }
  .feed li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 0.92rem; }
  .feed li:last-child { border-bottom: 0; }
  .feed a { text-decoration: none; font-weight: 600; }
  .feed a:hover { color: var(--gold); }
  .feed .bot { color: var(--muted); }
  .feed .weapon { color: var(--gold); font-size: 0.85rem; }
  .feed b { color: var(--red); font-size: 0.75rem; }
  .feed small { color: var(--muted); margin-left: auto; font-size: 0.8rem; }
</style>
