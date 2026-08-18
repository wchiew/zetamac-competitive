<script lang="ts">
  import {
    CUSTOM_THEME_KEY,
    FONTS,
    THEMES,
    applyCustomTheme,
    applyFont,
    applyTheme,
    resetSettings,
    setColor,
    settings,
  } from '../lib/settings.svelte';

  const COLOR_CHANNELS = [
    { key: 'background', label: 'Background' },
    { key: 'foreground', label: 'Text' },
    { key: 'accent', label: 'Accent' },
  ] as const;
</script>

<div class="settings">
  <h1>Settings</h1>

  <section>
    <h2>Font</h2>
    <div class="choices">
      {#each FONTS as font (font.key)}
        <button
          class="choice"
          class:active={settings.fontKey === font.key}
          style="font-family: {font.stack}"
          onclick={() => applyFont(font.key)}
        >
          {font.label}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h2>Theme</h2>
    <div class="choices">
      {#each THEMES as theme (theme.key)}
        <button
          class="choice"
          class:active={settings.themeKey === theme.key}
          onclick={() => applyTheme(theme.key)}
        >
          <span class="swatch" style="background: {theme.background}; border-color: {theme.foreground}"></span>
          {theme.label}
        </button>
      {/each}
      <!-- Rendered outside the loop because its colours are the player's, not a preset's. -->
      <button
        class="choice"
        class:active={settings.themeKey === CUSTOM_THEME_KEY}
        onclick={applyCustomTheme}
      >
        <span
          class="swatch"
          style="background: {settings.custom.background}; border-color: {settings.custom.foreground}"
        ></span>
        Custom
      </button>
    </div>
  </section>

  <section>
    <h2>Custom colors</h2>
    <div class="rows">
      {#each COLOR_CHANNELS as channel (channel.key)}
        <label>
          <span>{channel.label}</span>
          <!-- Not bind:value — going through setColor is what switches the
               active theme to Custom as soon as a colour is touched. -->
          <input
            type="color"
            value={settings[channel.key]}
            oninput={(event) => setColor(channel.key, event.currentTarget.value)}
          />
        </label>
      {/each}
    </div>
  </section>

  <section>
    <h2>During a game</h2>
    <div class="rows">
      <label>
        <span>Show timer</span>
        <input type="checkbox" bind:checked={settings.showTimer} />
      </label>
      <label>
        <span>Show score</span>
        <input type="checkbox" bind:checked={settings.showScore} />
      </label>
    </div>
  </section>

  <button class="reset" onclick={resetSettings}>Reset to defaults</button>
</div>

<style>
  .settings {
    width: min(42rem, 100%);
    margin: 0 auto;
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 500;
  }

  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.8rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .choice {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: transparent;
    border: 1px solid var(--muted);
    border-radius: 4px;
    padding: 0.5rem 1rem;
    cursor: pointer;
  }

  .choice.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .swatch {
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 50%;
    border: 1px solid;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .rows label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--muted) 30%, transparent);
  }

  input[type='color'] {
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    background: transparent;
    border: 1px solid var(--muted);
    border-radius: 3px;
    cursor: pointer;
  }

  /* Chrome insets the swatch inside the control, which would letterbox the
     square back into a rectangle. Strip the inset so the colour fills it. */
  input[type='color']::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  input[type='color']::-webkit-color-swatch {
    border: none;
    border-radius: 2px;
  }

  input[type='checkbox'] {
    width: 1rem;
    height: 1rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .reset {
    align-self: flex-start;
    background: transparent;
    border: none;
    padding: 0;
    color: var(--muted);
    font-size: 0.85rem;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
