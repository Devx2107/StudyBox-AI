# Motion tuning

All new motion rules and keyframes live in the `/* === MOTION LAYER === */` section at the end of `src/styles/index.css`. Existing keyframes remain intact; `msg-in` accepts a role-specific horizontal offset.

| Surface | Timing controls | Distance, stagger, and easing |
| --- | --- | --- |
| Global tabs | `--dur-tab-out` 100ms, `--dur-tab-in` 200ms | `--tab-distance` 24px, `--ease-motion` ease-out; shorten incoming duration first if switching feels slow. |
| Page and model banner | `--dur-mid` 250ms, `--dur-fast` 150ms, `--dur-slow` 400ms for download progress | `--ease-motion`; banner exit moves 8px upward. |
| Chat | `--dur-tab-in` 200ms for bubbles, `--dur-token` 80ms, `--dur-send` 120ms | `--msg-enter-x` ±12px, `--ease-spring`; cursor uses existing `blink`. Fade changes opacity without moving text. |
| Flashcards | `--dur-flip` 300ms, `--dur-mid` 250ms for entry, `--dur-slow` 400ms for progress | `--motion-distance` 12px, `--deck-stagger` 60ms, `--ease-spring`; perspective is 1000px. Entry uses `translate` separately from flip `transform`. |
| Quiz | `--dur-tab-in` 200ms, `--dur-shake` 200ms, `--dur-count` 250ms | `--tab-distance` 24px, `--motion-stagger` 50ms, spring hover; shake is ±4px. `--dur-quiz-final` 600ms controls the feedback hold before results. |
| Smart notes | `--dur-tab-in` 200ms; skeleton uses existing 1.5s `shimmer` | Headings and bullets enter from 8px below with ease-out. Streaming arrival controls reveal order; existing blocks retain their original animation timestamps. |
| Concept map | `--dur-tab-in` 200ms for nodes, `--dur-edge` 600ms | `--motion-stagger` 50ms, scale .8 → 1 with spring easing; hover reaches 1.03. Edge masks preserve the existing dashed leaf edges. |
| Voice | `--dur-wave` 100ms, `--dur-recording` 1200ms | Wave bars use ease-in-out and real signal levels. Three rings have equally spaced phases and scale 1 → 1.6. Speaking pulse is 1s. |
| Vision | `--dur-tab-in` 200ms, `--dur-fast` 150ms | Image moves `--motion-distance` 12px; analysis overlay reuses the existing 2.5s `scan`. |
| Profile | `--dur-xp` 600ms, `--dur-streak` 400ms | Ease-out for progress and digit reels. Prior displayed values survive tab unmounts; saved values are shown directly during initial hydration. |
| Achievements | `--dur-mid` 250ms entry, `--dur-achievement-hold` 2000ms, `--dur-fast` 150ms exit | Spring entry from top-right, 24px horizontally and vertically. Notifications are queued, do not take focus, and announce once. |

Prefer shortening duration before increasing movement. All accents use the current theme's variables. Reduced motion turns off decorative CSS animation, smooth scrolling, counters, and the custom cursor trail; controls, flipped faces, status text, and notifications remain functional.

## Validation

Run `npm run build` for TypeScript and the production bundle. `tests/motion-smoke.mjs` exercises the real components and CSS in an installed browser with deterministic model I/O, covering stream rendering, notes failure recovery, quiz feedback, card flips, map masks, voice states, themes, mobile surfaces, reduced motion, and persistence snapshots.

Run `npm test` for regression checks that do not require a browser or model downloads. These cover model load failures and memory cleanup, stream cancellation and both SDK error channels, late media permissions, stale task completions, asynchronous voice playback, and immediate save recovery with ordered disk writes.

The smoke test requires an existing Playwright installation; it adds no project dependencies. Set `STUDYBOX_PLAYWRIGHT_PATH` to the installed package directory and optionally `STUDYBOX_BROWSER_CHANNEL` to `chrome` or `msedge`, then run `node tests/motion-smoke.mjs`. The default paths use this workspace's bundled Playwright and installed Edge. Screenshots are written to the ignored `.playwright-mcp/` directory. No local model downloads or saved user-data writes occur during these fixture tests.

Use `node tests/motion-smoke.mjs --real` for an additional SDK startup and navigation smoke test without replacing the model integration. Add `--mobile` to check a 390px viewport. It initializes the SDK but does not download model weights.
