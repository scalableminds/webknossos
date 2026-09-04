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
 * Always on, including under test: the new code paths should get exercised by
 * the existing test suite too, not just by test/prototypes/new_volume_architecture.
 */
export const USE_NEW_VOLUME_ARCHITECTURE = true;
