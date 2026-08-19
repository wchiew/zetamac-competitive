<script lang="ts">
  import { DEFAULT_MODE, MAX_PLAYERS, MIN_PLAYERS } from '@zmc/shared';
  import { navigate } from '../lib/router.svelte';
</script>

<div class="menu">
  <p class="lede">Standard zetamac — {DEFAULT_MODE.durationSeconds} seconds, all four operations.</p>

  <div class="options">
    <button class="option" onclick={() => navigate('solo')}>
      <span class="title">Single player</span>
      <span class="detail">Practice on your own.</span>
    </button>

    <button class="option" onclick={() => navigate('multiplayer')}>
      <span class="title">Multiplayer</span>
      <span class="detail">{MIN_PLAYERS}–{MAX_PLAYERS} player competition.</span>
    </button>
  </div>
</div>

<style>
  .menu {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2.5rem;
    padding: 2rem 2rem calc(2rem + 16vh);
  }

  .lede {
    margin: 0;
    color: var(--muted);
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 1rem;
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 15rem;
    padding: 1.5rem;
    background: transparent;
    border: 1px solid var(--muted);
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
  }

  .option:hover {
    border-color: var(--accent);
  }

  .option:hover .title {
    color: var(--accent);
  }

  .title {
    font-size: 1.15rem;
  }

  .detail {
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
