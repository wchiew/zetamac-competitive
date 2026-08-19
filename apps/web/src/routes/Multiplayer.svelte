<script lang="ts">
  import { DEFAULT_MODE, JOIN_CODE_LENGTH, MAX_PLAYERS, MIN_PLAYERS } from '@zmc/shared';
  import Arena from './Arena.svelte';
  import { net } from '../lib/net.svelte';
  import { navigate } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';

  let joinCode = $state('');
  let now = $state(Date.now());

  const canStart = $derived(net.isHost && net.players.filter((p) => p.connected).length >= MIN_PLAYERS);
  const joinCodeReady = $derived(joinCode.length === JOIN_CODE_LENGTH);
  const busy = $derived(net.phase === 'connecting');
  const fillSecondsLeft = $derived(
    net.fillDeadlineEpoch === 0 ? null : Math.max(0, Math.ceil((net.fillDeadlineEpoch - now) / 1000)),
  );

  // Ticks only while a fill window is actually counting down.
  $effect(() => {
    if (net.fillDeadlineEpoch === 0) return;
    // Resync immediately: `now` has been frozen since the last window ended,
    // so without this the first render shows a countdown measured against a
    // stale clock until the first tick lands.
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(id);
  });

  function onCodeInput(event: Event & { currentTarget: HTMLInputElement }): void {
    // Digits only, so the field cannot hold a code the server would reject.
    const digits = event.currentTarget.value.replace(/\D/g, '').slice(0, JOIN_CODE_LENGTH);
    joinCode = digits;
    event.currentTarget.value = digits;
    // Editing is an attempt at a new code, so a stale failure should not linger.
    if (net.error) net.error = '';

    // Codes are a fixed length, so the app already knows when you have finished
    // typing. A confirm button would only add a step and sit disabled until the
    // last digit — Enter still works for retrying the same code after a miss.
    if (digits.length === JOIN_CODE_LENGTH && !busy) {
      net.joinLobby(digits, settings.playerName);
    }
  }

  /**
   * Enter in a field runs the action that field feeds, mirroring the button
   * directly beneath it. The guards match each button's `disabled` state so
   * the keyboard can never trigger something the mouse cannot.
   */
  function onNameKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || busy) return;
    event.preventDefault();
    net.matchmake(settings.playerName);
  }

  function onCodeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || busy || !joinCodeReady) return;
    event.preventDefault();
    net.joinLobby(joinCode, settings.playerName);
  }

  function leave(): void {
    net.leave();
    navigate('menu');
  }
</script>

<div class="mp">
  {#if net.phase === 'offline' || net.phase === 'connecting'}
    <div class="panel">
      <button
        class="primary"
        disabled={busy}
        onclick={() => net.matchmake(settings.playerName)}
      >
        Find a game
      </button>

      <!-- Below the primary action, because your name is a setting you pick
           once, not a decision standing between you and a game. -->
      <p class="identity">
        <label for="player-name">playing as</label>
        <input
          id="player-name"
          type="text"
          maxlength="16"
          bind:value={settings.playerName}
          placeholder="Player"
          onkeydown={onNameKeydown}
        />
      </p>

      <p class="divider">or play with friends</p>

      <button
        class="secondary"
        disabled={busy}
        onclick={() => net.createLobby(settings.playerName)}
      >
        Create a lobby
      </button>

      <p class="code-row">
        <label for="join-code">have a code?</label>
        <input
          id="join-code"
          class="code-input"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder="0000"
          value={joinCode}
          oninput={onCodeInput}
          onkeydown={onCodeKeydown}
        />
      </p>

      {#if net.error}
        <p class="error">{net.error}</p>
      {/if}

      <button class="link" onclick={() => navigate('menu')}>Back to menu</button>
    </div>
  {:else if net.phase === 'lobby' || net.phase === 'done'}
    <div class="panel">
      <!-- Only private lobbies are joined by code; a matchmade one is reached
           through the matchmaker, so showing its code invites nothing. -->
      {#if net.autoStart}
        <p class="lede">{net.phase === 'done' ? 'Results' : 'Finding players'}</p>
      {:else}
        <p class="lede">Join code</p>
        <p class="code">{net.code}</p>
      {/if}

      {#if net.phase === 'done'}
        <ol class="standings">
          {#each net.standings as row (row.id)}
            <li class:you={row.id === net.playerId}>
              <span class="place">{row.placement}</span>
              <span class="name">{row.name}</span>
              <span class="value">{row.score}</span>
            </li>
          {/each}
        </ol>
      {:else}
        <ul class="roster">
          {#each net.players as player (player.id)}
            <li>
              <span class="name">{player.name}</span>
              <!-- Meaningless in a matchmade lobby: nobody presses start. -->
              {#if !net.autoStart && player.id === net.hostId}<span class="tag">host</span>{/if}
              {#if player.id === net.playerId}<span class="tag">you</span>{/if}
            </li>
          {/each}
        </ul>
        <p class="hint">{net.players.length} / {MAX_PLAYERS} players</p>
      {/if}

      {#if net.autoStart}
        {#if fillSecondsLeft !== null}
          <p class="starting">
            {net.phase === 'done' ? 'Next round in' : 'Starting in'}
            {fillSecondsLeft}s
          </p>
          <p class="hint">Filling up to {MAX_PLAYERS} — starts sooner if the lobby fills.</p>
        {:else if net.phase === 'done'}
          <p class="hint">Waiting for another player before the next round.</p>
        {:else}
          <p class="hint">Waiting for another player to join.</p>
        {/if}
      {:else if net.isHost}
        <button class="primary" disabled={!canStart} onclick={() => net.startGame()}>
          {net.phase === 'done' ? 'Play again' : 'Start game'}
        </button>
        {#if !canStart}
          <p class="hint">Need at least {MIN_PLAYERS} players.</p>
        {/if}
      {:else}
        <p class="hint">Waiting for the host to start.</p>
      {/if}

      {#if net.error}
        <p class="error">{net.error}</p>
      {/if}

      <button class="link" onclick={leave}>Leave lobby</button>
    </div>
  {:else}
    <!-- Keyed on the seed so each round builds a fresh arena rather than
         reusing one whose timer is already running. -->
    {#key net.seed}
      <Arena
        mode={DEFAULT_MODE}
        seed={net.seed}
        startAtEpoch={net.startAtEpoch}
        players={net.players}
        selfId={net.playerId}
        onProgress={(solved) => net.reportSolved(solved)}
      />
    {/key}
  {/if}
</div>

<style>
  .mp {
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
    width: min(20rem, 100%);
    text-align: center;
  }

  /*
   * Both inputs read as inline text rather than boxed form fields — a boxed
   * control reads as a required step, and neither of these is one.
   */
  .identity,
  .code-row {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.5rem;
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .identity input,
  .code-row input {
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--muted) 45%, transparent);
    padding: 0.1rem 0.15rem;
    color: var(--fg);
    font-size: 0.85rem;
    outline: none;
  }

  .identity input:focus,
  .code-row input:focus {
    border-bottom-color: var(--accent);
  }

  .identity input {
    width: 9ch;
  }

  .code-input {
    /* Wide enough for four digits *plus* the trailing letter-spacing each one
       adds, otherwise the last digit is clipped. */
    width: 7ch;
    letter-spacing: 0.25em;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .lede {
    margin: 0;
    color: var(--muted);
  }

  .code {
    margin: 0;
    font-size: clamp(2.5rem, 10vw, 4rem);
    line-height: 1;
    letter-spacing: 0.15em;
    font-variant-numeric: tabular-nums;
  }

  /* Rules on either side, so the split between the two paths is structural
     rather than just another line of muted text. */
  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    margin: 0.4rem 0 0;
    color: var(--muted);
    font-size: 0.75rem;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: color-mix(in srgb, var(--muted) 30%, transparent);
  }

  .roster,
  .standings {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .roster li,
  .standings li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--muted) 30%, transparent);
  }

  .standings .place {
    width: 1.5rem;
    color: var(--muted);
    text-align: left;
  }

  .name {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    font-variant-numeric: tabular-nums;
  }

  .standings .you {
    color: var(--accent);
  }

  .tag {
    color: var(--muted);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .primary,
  .secondary {
    width: 100%;
    background: transparent;
    border: 1px solid var(--muted);
    border-radius: 4px;
    padding: 0.6rem 2rem;
    cursor: pointer;
  }

  /* The matchmaking path is the default action, so it carries the accent. */
  .primary {
    border-color: var(--accent);
    color: var(--accent);
  }

  .primary:hover:not(:disabled),
  .secondary:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .primary:disabled,
  .secondary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .starting {
    margin: 0;
    font-size: 1.15rem;
  }

  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .error {
    margin: 0;
    color: #e5484d;
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
</style>
