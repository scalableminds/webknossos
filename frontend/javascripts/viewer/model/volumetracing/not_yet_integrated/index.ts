/**
 * NOT YET INTEGRATED — nothing in this folder may be imported from production
 * code (enforced by `tools/check-no-unintegrated-imports.js`). It holds the
 * parts of the design that are implemented but not yet wired into the app (the
 * journal, the editing session) plus `WorkingDataCube`, the in-memory stand-in
 * that lets `../core` be exercised without the viewer. See design doc §12.
 */

export { BucketJournal, type BucketLog, type BucketLogEntry } from "./journal";
export { VolumeEditingSession } from "./session";
export { WorkingDataCube } from "./working_data_cube";
