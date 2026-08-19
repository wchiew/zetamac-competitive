<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { ProblemGenerator, type ModeConfig } from '@zmc/shared';
  import { RoundMetrics, summarize, type GameMode, type RoundSummary } from '../lib/metrics';
  import { settings } from '../lib/settings.svelte';

  interface Contender {
    id: string;
    name: string;
    score: number;
    connected: boolean;
  }

  let {
    // Named `config` rather than `mode` so it cannot be confused with
    // `gameMode` — one is the problem ruleset, the other is solo vs lobby.
    config,
    gameMode,
    serverVerified,
    seed,
    startAtEpoch,
    players = [],
    selfId = '',
    onStart,
    onProgress,
    onFinish,
  }: {
    config: ModeConfig;
    gameMode: GameMode;
    serverVerified: boolean;
    seed: number;
    /** Round start in Date.now() terms. In the past means start immediately. */
    startAtEpoch: number;
    /** Everyone in the round, including you. Empty in solo. */
    players?: Contender[];
    selfId?: string;
    /** Fires when the clock actually starts, which is what "started" counts. */
    onStart?: () => void;
    onProgress?: (solvedThrough: number) => void;
    /** Fires only when the round runs to the clock — an abandoned round emits nothing. */
    onFinish?: (summary: RoundSummary) => void;
  } = $props();

  // Reactive state is deliberately coarse: it changes on a correct answer
  // (~1/sec) or a whole-second tick, never on a keystroke.
  let phase = $state<'countdown' | 'running' | 'done'>('countdown');
  let problemText = $state('');
  let score = $state(0);
  // Seeded from `mode` in the setup effect below, not here, so it tracks the
  // prop rather than capturing whatever it happened to be at construction.
  let secondsLeft = $state(0);
  let countdownLeft = $state(0);

  /**
   * Live standings, each normalised against the current leader.
   *
   * Dividing by the best score rather than by some absolute ceiling is what
   * keeps the longest bar a constant length: whoever leads always fills the
   * track, so the lead changing hands re-scales everyone else rather than
   * resizing the winner.
   */
  const standings = $derived.by(() => {
    const rows = players.map((player) => ({
      ...player,
      // Your own row follows the local counter so it always agrees with the
      // score in the HUD; the server's copy of it trails by up to one
      // broadcast interval. Everyone else is as fresh as the network allows.
      value: player.id === selfId ? score : player.score,
    }));
    const best = Math.max(0, ...rows.map((row) => row.value));
    return rows.map((row) => ({ ...row, fraction: best === 0 ? 0 : row.value / best }));
  });

  // Hot-path values stay off the reactive graph entirely.
  let generator: ProblemGenerator | null = null;
  let answer = 0;
  let startsAt = 0;
  let endsAt = 0;
  let rafId = 0;
  let startTimer = 0;
  let endTimer = 0;
  // $state only because bind:this writes to it; it is never read in markup.
  let inputEl = $state<HTMLInputElement | null>(null);
  // Plain object on purpose — this is written from the keystroke handler.
  const metrics = new RoundMetrics();

  function nextProblem(): void {
    const problem = generator!.next();
    problemText = problem.text;
    answer = problem.answer;
    metrics.show(problem, performance.now());
    if (inputEl) inputEl.value = '';
  }

  /**
   * Display only. requestAnimationFrame is paused entirely while a tab is
   * hidden, so it must never be what decides when the round starts or ends —
   * that is what the timeouts below are for. This just redraws the numbers,
   * always recomputed from the clock so a resumed tab corrects itself.
   */
  function paint(): void {
    const now = performance.now();
    if (phase === 'countdown') {
      const seconds = Math.max(0, Math.ceil((startsAt - now) / 1000));
      if (seconds !== countdownLeft) countdownLeft = seconds;
    } else if (phase === 'running') {
      const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
      // Only touch reactive state when the displayed value changes, so the
      // other ~59 frames a second cost nothing.
      if (seconds !== secondsLeft) secondsLeft = seconds;
    }
    rafId = requestAnimationFrame(paint);
  }

  async function begin(): Promise<void> {
    if (phase !== 'countdown') return;
    phase = 'running';
    metrics.begin(performance.now());
    onStart?.();
    endTimer = setTimeout(finish, Math.max(0, endsAt - performance.now())) as unknown as number;
    // The input only exists once the phase change has been flushed to the DOM.
    await tick();
    nextProblem();
    inputEl?.focus();
  }

  function finish(): void {
    if (phase === 'done') return;
    clearTimers();
    // Close the problem that was on screen when the clock ran out; it counts
    // as attempted-but-unsolved rather than being dropped.
    metrics.close(null);
    secondsLeft = 0;
    phase = 'done';
    onFinish?.(
      summarize(metrics.records, score, {
        gameMode,
        serverVerified,
        durationSeconds: config.durationSeconds,
      }),
    );
  }

  function clearTimers(): void {
    cancelAnimationFrame(rafId);
    clearTimeout(startTimer);
    clearTimeout(endTimer);
    rafId = 0;
    startTimer = 0;
    endTimer = 0;
  }

  /**
   * The hot path. Runs on every keystroke, so it does no allocation beyond the
   * trimmed string and never writes reactive state unless the answer is right.
   */
  function onInput(): void {
    if (phase !== 'running' || !inputEl) return;
    const now = performance.now();
    // Records the first keystroke for this problem, separating thinking time
    // from typing time. Writes a plain field, so no render is triggered.
    metrics.keyed(now);

    const raw = inputEl.value.trim();
    if (raw === '' || !/^-?\d+$/.test(raw)) return;
    if (Number(raw) !== answer) return;
    metrics.close(now);
    score++;
    onProgress?.(score);
    nextProblem();
  }

  function setup(config: ModeConfig, gameSeed: number, epoch: number): void {
    generator = new ProblemGenerator(config, gameSeed);
    score = 0;
    secondsLeft = config.durationSeconds;

    // Convert the epoch start into the monotonic clock the timer runs on, so a
    // system clock adjustment mid-round cannot stretch or shorten the game.
    const offsetToPerf = performance.now() - Date.now();
    startsAt = epoch + offsetToPerf;
    endsAt = startsAt + config.durationSeconds * 1000;

    phase = 'countdown';
    const untilStart = startsAt - performance.now();
    countdownLeft = Math.max(0, Math.ceil(untilStart / 1000));
    rafId = requestAnimationFrame(paint);

    if (untilStart <= 0) void begin();
    else startTimer = setTimeout(() => void begin(), untilStart) as unknown as number;
  }

  $effect(() => {
    // Read the props here so they are the effect's only dependencies, then run
    // the setup untracked. `begin()` both reads and writes `phase`, so without
    // untrack the effect would depend on state it mutates and re-run forever,
    // clearing and rebuilding the deadline timer on every pass.
    const roundConfig = config;
    const gameSeed = seed;
    const epoch = startAtEpoch;
    untrack(() => setup(roundConfig, gameSeed, epoch));
    return clearTimers;
  });
</script>

{#if phase === 'countdown'}
  <p class="countdown">{countdownLeft}</p>
{:else}
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
      disabled={phase === 'done'}
    />
  </div>

  {#if standings.length > 1}
    <ul class="board">
      {#each standings as row (row.id)}
        <li class:you={row.id === selfId} class:gone={!row.connected}>
          <span class="who">{row.name}</span>
          <span class="track">
            <span class="fill" style="width: {row.fraction * 100}%"></span>
          </span>
          <span class="value">{row.value}</span>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .countdown {
    margin: 0;
    font-size: clamp(4rem, 16vw, 7rem);
    line-height: 1;
    /* Proportional figures at display size; see the results score. */
    font-variant-numeric: proportional-nums;
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
   * between problems. Your eyes stay in one place for the whole round.
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

  .board {
    /* Caps how long the leader's bar can get. */
    width: min(22rem, 100%);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--muted);
    font-size: 0.8rem;
  }

  .board li {
    display: grid;
    /* Fixed name and score columns so the tracks all start and end on the
       same x, which is what makes the bars comparable at a glance. */
    grid-template-columns: 5rem 1fr 2.5ch;
    align-items: center;
    gap: 0.6rem;
  }

  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track {
    height: 3px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 25%, transparent);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--muted);
    /* Scores arrive in 250ms steps; without this the bars visibly jump. */
    transition: width 200ms ease-out;
  }

  .value {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .you .who,
  .you .value {
    color: var(--fg);
  }

  .you .fill {
    background: var(--accent);
  }

  .gone {
    opacity: 0.4;
  }
</style>
