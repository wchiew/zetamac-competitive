<script lang="ts" module>
  let instances = 0;
</script>

<script lang="ts">
  import PaceChart from './PaceChart.svelte';
  import { OP_SYMBOL, type RoundSummary } from '../lib/metrics';

  let { summary }: { summary: RoundSummary } = $props();

  const COLUMNS = [
    { label: 'solved', description: 'Correct answers for this operation' },
    {
      label: 'median',
      description: 'Time from the problem appearing to the correct answer',
    },
    { label: 'think', description: 'Time taken before the first keystroke' },
    { label: 'type', description: 'Time between first keystroke and correct response' },
  ] as const;

  // Ids must be unique per instance, since solo and multiplayer can both have
  // mounted a breakdown.
  const uid = `bd${++instances}`;

  // Operations that never came up are dropped rather than shown as blanks.
  const rows = $derived(summary.byOp.filter((stats) => stats.solved > 0));

  const solved = $derived(summary.problems.filter((p) => p.msToSolve !== null));

  /** Named outright, because "your slowest was 12 × 87" is the actionable bit. */
  const slowest = $derived.by(() => {
    if (solved.length === 0) return null;
    return solved.reduce((worst, p) => (p.msToSolve! > worst.msToSolve! ? p : worst));
  });

  /** Attempted means keys were pressed but the clock won. */
  const unfinished = $derived(
    summary.problems.filter((p) => p.msToSolve === null && p.msToFirstKey !== null).length,
  );

  function seconds(ms: number | null): string {
    return ms === null ? '—' : `${(ms / 1000).toFixed(2)}s`;
  }
</script>

{#if rows.length > 0}
  <div class="breakdown">
    <table>
      <thead>
        <tr>
          <th class="op"><span class="sr">Operation</span></th>
          {#each COLUMNS as column (column.label)}
            <th>
              <!-- A real button, not a span with tabindex: it is focusable by
                   default, announced as a control, and works on touch, so the
                   description is never mouse-only. -->
              <button type="button" class="head" aria-describedby="{uid}-{column.label}">
                {column.label}
              </button>
              <span class="tip" role="tooltip" id="{uid}-{column.label}">{column.description}</span>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as stats (stats.op)}
          <tr>
            <td class="op">{OP_SYMBOL[stats.op]}</td>
            <td>{stats.solved}</td>
            <td>{seconds(stats.medianSolveMs)}</td>
            <td>{seconds(stats.medianThinkMs)}</td>
            <td>{seconds(stats.medianTypeMs)}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <p class="overall">
      overall · think {seconds(summary.medianThinkMs)} · type {seconds(summary.medianTypeMs)}
    </p>

    <PaceChart problems={summary.problems} durationSeconds={summary.durationSeconds} />

    <p class="overall">
      {#if slowest}
        slowest · {slowest.left}
        {OP_SYMBOL[slowest.op]}
        {slowest.right} in {seconds(slowest.msToSolve)}
      {/if}
      {#if unfinished > 0}
        · {unfinished} left unfinished
      {/if}
    </p>
  </div>
{/if}

<style>
  .breakdown {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    color: var(--muted);
    font-size: 0.8rem;
  }

  table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th {
    position: relative;
    font-weight: 400;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid color-mix(in srgb, var(--muted) 30%, transparent);
  }

  th,
  td {
    /* Centred under the heading. Every value in a column shares a format and
       carries tabular figures, so they still line up despite not being
       right-aligned. */
    text-align: center;
    padding: 0.25rem 0 0.25rem 1.1rem;
  }

  .op {
    padding-left: 0;
    text-align: left;
    color: var(--fg);
    /* Fixed so the symbol column cannot shift as rows change. */
    width: 1.5rem;
  }

  /* Dotted underline is the conventional "there is an explanation here" cue. */
  .head {
    background: none;
    border: none;
    border-bottom: 1px dotted color-mix(in srgb, var(--muted) 60%, transparent);
    padding: 0;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    cursor: help;
    outline: none;
  }

  .head:hover,
  .head:focus {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .tip {
    position: absolute;
    bottom: calc(100% + 0.4rem);
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    width: max-content;
    max-width: min(14rem, 60vw);
    padding: 0.4rem 0.55rem;
    background: var(--bg);
    border: 1px solid color-mix(in srgb, var(--muted) 45%, transparent);
    border-radius: 4px;
    color: var(--fg);
    font-size: 0.7rem;
    text-transform: none;
    letter-spacing: 0;
    line-height: 1.35;
    text-align: left;
    /* Hidden from layout and from the pointer until asked for. */
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease-out;
  }

  /* `:focus`, not `:focus-visible` — a tap gives focus without matching
     focus-visible, and touch users need the description too. */
  .head:hover + .tip,
  .head:focus + .tip {
    visibility: visible;
    opacity: 1;
  }

  td {
    color: var(--fg);
  }

  .overall {
    margin: 0;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
