<script lang="ts">
  import { DEFAULT_MODE, randomSeed } from '@zmc/shared';
  import Arena from './Arena.svelte';
  import { navigate } from '../lib/router.svelte';

  type Phase = 'idle' | 'playing' | 'done';

  let phase = $state<Phase>('idle');
  let seed = $state(0);
  let startAtEpoch = $state(0);
  let finalScore = $state(0);
  /** Keys the arena. A counter rather than the seed, so restarting always
      remounts even in the vanishingly rare case of the same seed twice. */
  let runId = $state(0);

  function start(): void {
    seed = randomSeed();
    startAtEpoch = Date.now();
    runId++;
    phase = 'playing';
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (phase !== 'playing' && event.key === 'Enter') {
      event.preventDefault();
      start();
    }
  }
</script>

<svelte:window on:keydown={onWindowKeydown} />

<div class="game">
  {#if phase === 'idle'}
    <div class="panel">
      <p class="lede">
        Standard zetamac — {DEFAULT_MODE.durationSeconds} seconds, all four operations.
      </p>
      <button class="primary" onclick={start}>Start</button>
      <p class="hint">or press Enter</p>
    </div>
  {:else if phase === 'playing'}
    <!-- Keyed so replaying tears the arena down and builds a fresh one,
         rather than trying to reset a round already in flight. -->
    {#key runId}
      <Arena
        mode={DEFAULT_MODE}
        {seed}
        {startAtEpoch}
        onFinish={(score) => {
          finalScore = score;
          phase = 'done';
        }}
      />
    {/key}

    <!--
      Solo only — a multiplayer round is shared, so one player cannot restart
      it. Sits immediately after the arena in DOM order, which is what puts it
      one Tab away from the answer field without needing a tabindex.
    -->
    <button class="restart" onclick={start}>
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <polyline points="21 3 21 9 15 9" />
      </svg>
      Restart
    </button>
  {:else}
    <div class="panel">
      <p class="lede">Time's up</p>
      <p class="final">{finalScore}</p>
      <button class="primary" onclick={start}>Play again</button>
      <p class="hint">or press Enter</p>
      <button class="link" onclick={() => navigate('menu')}>Back to menu</button>
    </div>
  {/if}
</div>

<style>
  .game {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3rem;
    padding: 2rem 2rem calc(2rem + 16vh);
  }

  .panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    text-align: center;
  }

  .lede {
    margin: 0;
    color: var(--muted);
  }

  .final {
    margin: 0;
    font-size: clamp(3.5rem, 14vw, 6rem);
    line-height: 1;
  }

  .primary {
    background: transparent;
    border: 1px solid var(--muted);
    border-radius: 4px;
    padding: 0.6rem 2rem;
    cursor: pointer;
  }

  .primary:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--muted);
    font-size: 0.85rem;
    text-decoration: underline;
    cursor: pointer;
  }

  .restart {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.35rem 0.7rem;
    color: var(--muted);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .restart:hover {
    color: var(--accent);
  }

  /* Visible ring, since reaching this by Tab from the answer field is the
     intended path and focus has to be obvious when it lands. */
  .restart:focus-visible {
    outline: none;
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
