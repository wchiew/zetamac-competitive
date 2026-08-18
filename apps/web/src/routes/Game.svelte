<script lang="ts">
  import { tick } from 'svelte';
  import { DEFAULT_MODE, ProblemGenerator, randomSeed } from '@zmc/shared';
  import { settings } from '../lib/settings.svelte';

  type Phase = 'idle' | 'running' | 'done';

  // Reactive state is deliberately coarse: it changes on a correct answer
  // (~1/sec) or a whole-second timer tick, never on a keystroke.
  let phase = $state<Phase>('idle');
  let problemText = $state('');
  let score = $state(0);
  let secondsLeft = $state(DEFAULT_MODE.durationSeconds);

  // Hot-path values stay off the reactive graph entirely.
  let generator: ProblemGenerator | null = null;
  let answer = 0;
  let endsAt = 0;
  let rafId = 0;
  // $state only because bind:this writes to it; it is never read in markup.
  let inputEl = $state<HTMLInputElement | null>(null);

  function nextProblem(): void {
    const problem = generator!.next();
    problemText = problem.text;
    answer = problem.answer;
    if (inputEl) inputEl.value = '';
  }

  function frame(): void {
    const remainingMs = endsAt - performance.now();
    if (remainingMs <= 0) {
      finish();
      return;
    }
    const s = Math.ceil(remainingMs / 1000);
    // Only touch reactive state when the displayed value actually changes,
    // so the other ~59 frames a second cost nothing.
    if (s !== secondsLeft) secondsLeft = s;
    rafId = requestAnimationFrame(frame);
  }

  async function start(): Promise<void> {
    generator = new ProblemGenerator(DEFAULT_MODE, randomSeed());
    score = 0;
    secondsLeft = DEFAULT_MODE.durationSeconds;
    phase = 'running';
    // The input only exists once the phase change has been flushed to the DOM,
    // and the clock should not start until the player can actually type.
    await tick();
    nextProblem();
    inputEl?.focus();
    endsAt = performance.now() + DEFAULT_MODE.durationSeconds * 1000;
    rafId = requestAnimationFrame(frame);
  }

  function finish(): void {
    cancelAnimationFrame(rafId);
    rafId = 0;
    secondsLeft = 0;
    phase = 'done';
  }

  /**
   * The hot path. Runs on every keystroke, so it does no allocation beyond the
   * trimmed string and never writes reactive state unless the answer is right.
   */
  function onInput(): void {
    if (phase !== 'running' || !inputEl) return;
    const raw = inputEl.value.trim();
    if (raw === '' || !/^-?\d+$/.test(raw)) return;
    if (Number(raw) !== answer) return;
    score++;
    nextProblem();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (phase !== 'running' && event.key === 'Enter') {
      event.preventDefault();
      void start();
    }
  }

  $effect(() => () => cancelAnimationFrame(rafId));
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
  {:else if phase === 'running'}
    <div class="hud">
      <span class:invisible={!settings.showScore}>Score: {score}</span>
      <span class:invisible={!settings.showTimer}>Seconds left: {secondsLeft}</span>
    </div>
    <div class="problem">
      <span class="expr">{problemText}</span>
      <span class="eq">=</span>
      <input
        bind:this={inputEl}
        oninput={onInput}
        type="text"
        inputmode="numeric"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label="Answer"
      />
    </div>
  {:else}
    <div class="panel">
      <p class="lede">Time's up</p>
      <p class="final">{score}</p>
      <button class="primary" onclick={start}>Play again</button>
      <p class="hint">or press Enter</p>
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

  .hud {
    display: flex;
    gap: 3rem;
    color: var(--muted);
    font-size: 0.95rem;
    /* Reserve the row so hiding both readouts never shifts the problem. */
    min-height: 1.4em;
  }

  /*
   * Removed from flow rather than hidden, so the remaining readout stays
   * centred. Safe because these are settings, not in-game state — they cannot
   * change while a round is running.
   */
  .invisible {
    display: none;
  }

  /*
   * Three columns rather than a centered flex row: the "=" is pinned to the
   * centre and the expression grows leftward, so the answer field never moves
   * between problems. Your eyes stay in one place for the whole 120 seconds.
   */
  .problem {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: baseline;
    gap: 0.5rem;
    width: min(44rem, 100%);
    font-size: clamp(2rem, 7vw, 3.5rem);
    letter-spacing: 0.01em;
  }

  .expr {
    text-align: right;
    white-space: nowrap;
  }

  .eq {
    color: var(--muted);
  }

  .problem input {
    /* Widest possible answer is 1200 (12 × 100). */
    width: 4.5ch;
    justify-self: start;
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--muted);
    padding: 0 0.1em;
    font-size: inherit;
    font-variant-numeric: tabular-nums;
    outline: none;
  }

  .problem input:focus {
    border-bottom-color: var(--accent);
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
</style>
