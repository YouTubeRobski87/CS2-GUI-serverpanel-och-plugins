<script lang="ts">
  import { page } from '$app/state';
</script>

<section style="padding:48px 0">
  <h1>{page.status === 404 ? 'Hittades inte' : 'Något gick fel'}</h1>
  <p style="color:var(--muted)">{page.error?.message}</p>
  <a href="/" style="color:var(--gold)">← Till topplistan</a>
</section>
