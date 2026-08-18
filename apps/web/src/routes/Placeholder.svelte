<script lang="ts">
  let { title, note }: { title: string; note: string } = $props();
</script>

<div class="placeholder">
  <h1>{title}</h1>
  <p>{note}</p>
</div>

<style>
  .placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 2rem;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 500;
  }

  p {
    margin: 0;
    color: var(--muted);
  }
</style>
