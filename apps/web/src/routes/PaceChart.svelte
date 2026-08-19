<script lang="ts">
  import { OP_SYMBOL, type ProblemRecord } from '../lib/metrics';

  let {
    problems,
    durationSeconds,
  }: { problems: ProblemRecord[]; durationSeconds: number } = $props();

  // Fixed coordinate space; CSS scales the whole thing proportionally, and
  // non-scaling strokes keep line weights honest at any width.
  const W = 600;
  const H = 80;
  // Headroom inside the plot: the peak is pinned to this line, so a small pad
  // leaves the tallest point touching the caption above it.
  const PAD_Y = 12;

  const solved = $derived(problems.filter((p) => p.msToSolve !== null));
  const totalMs = $derived(durationSeconds * 1000);

  /**
   * Scaled to the slowest answer rather than a percentile. Clipping the
   * outlier would hide the one problem worth looking at; the median line below
   * gives back the sense of scale that a tall peak flattens out of the rest.
   */
  const maxMs = $derived(Math.max(1, ...solved.map((p) => p.msToSolve!)));

  const medianMs = $derived.by(() => {
    if (solved.length === 0) return null;
    const sorted = solved.map((p) => p.msToSolve!).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  });

  interface Point {
    x: number;
    y: number;
    record: ProblemRecord;
  }

  const points = $derived<Point[]>(
    solved.map((record) => ({
      x: (record.offsetMs / totalMs) * W,
      y: PAD_Y + (1 - record.msToSolve! / maxMs) * (H - PAD_Y * 2),
      record,
    })),
  );

  const path = $derived(points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '));
  const medianY = $derived(
    medianMs === null ? null : PAD_Y + (1 - medianMs / maxMs) * (H - PAD_Y * 2),
  );

  let svgEl = $state<SVGSVGElement | null>(null);
  let hovered = $state<Point | null>(null);

  function onMove(event: MouseEvent): void {
    if (!svgEl || points.length === 0) return;
    const rect = svgEl.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    let nearest = points[0]!;
    for (const point of points) {
      if (Math.abs(point.x - x) < Math.abs(nearest.x - x)) nearest = point;
    }
    hovered = nearest;
  }

  function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(2)}s`;
  }
</script>

{#if points.length >= 2}
  <figure class="pace">
    <figcaption>
      <span>seconds per answer</span>
      <span class="scale">peak {seconds(maxMs)}</span>
    </figcaption>

    <div class="plot">
      <svg
        bind:this={svgEl}
        viewBox="0 0 {W} {H}"
        role="img"
        aria-label="Time taken per answer across the round"
        onmousemove={onMove}
        onmouseleave={() => (hovered = null)}
      >
        {#if medianY !== null}
          <line class="median" x1="0" y1={medianY} x2={W} y2={medianY} />
        {/if}

        <path class="line" d={path} />

        {#if hovered}
          <line class="crosshair" x1={hovered.x} y1="0" x2={hovered.x} y2={H} />
          <circle class="dot" cx={hovered.x} cy={hovered.y} r="4" />
        {/if}
      </svg>

      {#if hovered}
        <div class="tip" style="left: {(hovered.x / W) * 100}%">
          {hovered.record.left}
          {OP_SYMBOL[hovered.record.op]}
          {hovered.record.right} · {seconds(hovered.record.msToSolve!)}
        </div>
      {/if}
    </div>

    <div class="axis">
      <span>0s</span>
      {#if medianMs !== null}<span class="median-label">median {seconds(medianMs)}</span>{/if}
      <span>{durationSeconds}s</span>
    </div>
  </figure>
{/if}

<style>
  .pace {
    width: min(28rem, 100%);
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }


  figcaption,
  .axis {
    display: flex;
    justify-content: space-between;
    color: var(--muted);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .axis {
    text-transform: none;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }

  .scale,
  .median-label {
    opacity: 0.7;
  }

  .plot {
    position: relative;
    /* Separates the plot from the caption above it, and leaves room for the
       hover readout, which is positioned above the plot. */
    margin-top: 0.9rem;
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }

  /* Recessive reference; the data line is the only thing that should read. */
  .median {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 3 4;
    opacity: 0.5;
    vector-effect: non-scaling-stroke;
  }

  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .crosshair {
    stroke: var(--muted);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .dot {
    fill: var(--accent);
    /* Surface ring so the marker stays legible where it sits on the line. */
    stroke: var(--bg);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }

  .tip {
    position: absolute;
    top: -1.5rem;
    transform: translateX(-50%);
    white-space: nowrap;
    color: var(--fg);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
</style>
