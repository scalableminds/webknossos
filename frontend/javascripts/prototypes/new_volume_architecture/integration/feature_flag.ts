/**
 * SPIKE TOGGLE — shared between every tool integration (brush_driver.ts,
 * flood_fill_driver.ts) so they all route through the new volume architecture
 * (frontend/javascripts/prototypes/new_volume_architecture) under the
 * identical condition.
 *
 * A leaf module with no other imports, so both `volumetracing_saga.tsx` and
 * `floodfill_saga.tsx` can import it without risking a cycle — the former
 * already imports the latter for the FLOOD_FILL watcher, so a dependency in
 * the other direction would close a loop.
 *
 * Disabled under test: the existing integration specs for both tools assert on
 * update actions and behaviour this path deliberately does not produce. The
 * spike has its own coverage in test/prototypes/new_volume_architecture.
 */
export const USE_NEW_VOLUME_ARCHITECTURE = !process.env.IS_TESTING;
