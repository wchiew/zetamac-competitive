<script lang="ts">
  import { initRouter, navigate, router, type Route } from './lib/router.svelte';
  import { initSettingsEffects } from './lib/settings.svelte';
  import Menu from './routes/Menu.svelte';
  import Game from './routes/Game.svelte';
  import Multiplayer from './routes/Multiplayer.svelte';
  import Settings from './routes/Settings.svelte';
  import Placeholder from './routes/Placeholder.svelte';

  initRouter();
  initSettingsEffects();

  const NAV: ReadonlyArray<{ route: Route; label: string }> = [
    { route: 'menu', label: 'play' },
    { route: 'leaderboard', label: 'leaderboard' },
    { route: 'profile', label: 'profile' },
    { route: 'settings', label: 'settings' },
  ];
</script>

<nav>
  <button class="brand" onclick={() => navigate('menu')}>
    zetamac<span class="dim">/competitive</span>
  </button>
  <div class="links">
    {#each NAV as item (item.route)}
      <button class:active={router.route === item.route} onclick={() => navigate(item.route)}>
        {item.label}
      </button>
    {/each}
  </div>
</nav>

<main>
  {#if router.route === 'menu'}
    <Menu />
  {:else if router.route === 'solo'}
    <Game />
  {:else if router.route === 'multiplayer'}
    <Multiplayer />
  {:else if router.route === 'settings'}
    <Settings />
  {:else if router.route === 'leaderboard'}
    <Placeholder title="Leaderboard" note="All-time and daily boards arrive in M3." />
  {:else}
    <Placeholder title="Profile" note="Accounts and stats arrive in M2." />
  {/if}
</main>

<style>
  nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 1.25rem;
    font-size: 0.85rem;
  }

  /* A button for keyboard and screen-reader access; styled back down to plain
     text so the nav stays visually unchanged. */
  .brand {
    background: none;
    border: none;
    padding: 0;
    font-size: inherit;
    color: var(--muted);
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  .brand:hover {
    color: var(--fg);
  }

  .dim {
    opacity: 0.55;
  }

  .links {
    display: flex;
    gap: 1rem;
  }

  .links button {
    background: none;
    border: none;
    padding: 0;
    color: var(--muted);
    cursor: pointer;
  }

  .links button:hover {
    color: var(--fg);
  }

  .links button.active {
    color: var(--accent);
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
</style>
