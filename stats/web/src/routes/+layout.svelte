<script lang="ts">
  let { children } = $props();
</script>

<header>
  <a class="brand" href="/">
    <img src="/favicon.svg" alt="" width="34" height="34" />
    <span>
      <strong>GAMLA SKOLAN</strong>
      <small>CS2-statistik</small>
    </span>
  </a>
  <a class="connect" href="steam://connect/92.33.158.134:27016">Anslut till servern</a>
</header>

<main>
  {@render children()}
</main>

<footer>
  <span>Retakes · Deathmatch · 1v1 Arenas · Zombie</span>
  <code>connect 92.33.158.134:27016</code>
</footer>

<style>
  :global(:root) {
    --bg: #110f0c;
    --panel: #1a1712;
    --panel-2: #221e17;
    --line: #2f291f;
    --text: #ece4d4;
    --muted: #9a8e78;
    --gold: #d9a441;
    --gold-soft: #d9a44122;
    --red: #d9614b;
    --green: #7fb069;
    color-scheme: dark;
  }
  :global(*) { box-sizing: border-box; }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    line-height: 1.45;
  }
  :global(a) { color: inherit; }
  :global(.num) { font-variant-numeric: tabular-nums; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }
  :global(h1, h2) { letter-spacing: 0.02em; }
  :global(h2) { font-size: 0.8rem; text-transform: uppercase; color: var(--muted); font-weight: 600; letter-spacing: 0.12em; margin: 0 0 12px; }
  :global(.card) { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }

  header {
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
    max-width: 1100px; margin: 0 auto; padding: 20px 16px;
  }
  .brand { display: flex; gap: 12px; align-items: center; text-decoration: none; }
  .brand span { display: flex; flex-direction: column; line-height: 1.1; }
  .brand strong { letter-spacing: 0.14em; font-size: 1rem; }
  .brand small { color: var(--gold); font-size: 0.75rem; letter-spacing: 0.08em; }
  .connect {
    text-decoration: none; font-weight: 600; font-size: 0.9rem;
    border: 1px solid var(--gold); color: var(--gold); padding: 8px 14px; border-radius: 8px;
    white-space: nowrap;
  }
  .connect:hover { background: var(--gold-soft); }
  main { max-width: 1100px; margin: 0 auto; padding: 0 16px 40px; }
  footer {
    max-width: 1100px; margin: 0 auto; padding: 24px 16px 40px; border-top: 1px solid var(--line);
    display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 0.85rem;
  }
  footer code { color: var(--gold); }
</style>
