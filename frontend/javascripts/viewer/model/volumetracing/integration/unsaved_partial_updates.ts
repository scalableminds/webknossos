/**
 * The partial bucket updates that are not saved yet, by bucket. They are taken from
 * the save queue, which keeps an action until its save request succeeded.
 *
 * Buckets whose data arrives (again) get these runs re-applied on top of the
 * backend's data (see DataBucket.receiveData), so that unsaved edits survive a
 * bucket being evicted and fetched again, e.g., after a remote change of it.
 * Runs are absolute writes, so re-applying a run that the fetched data already
 * contains is harmless.
 */

import memoizeOne from "memoize-one";
import type { BucketAddress } from "viewer/constants";
import { globalPositionToBucketPositionWithMag } from "viewer/model/helpers/position_converter";
import type { SaveQueueEntry } from "viewer/store";
import { decodeBucketDiff, type VoxelRun } from "../core/bucket_diff";

function keyOf(
  tracingId: string,
  [x, y, z, magIndex, additionalCoordinates]: BucketAddress,
): string {
  // Missing and empty additional coordinates mean the same.
  const coordinates = (additionalCoordinates ?? [])
    .map(({ name, value }) => `${name}=${value}`)
    .join(",");
  return `${tracingId}/${x},${y},${z},${magIndex};${coordinates}`;
}

// The encoded runs of each bucket, in save queue order. Decoding is left to the
// lookup, as only the buckets that are fetched need it.
const indexUnsavedPartialUpdates = memoizeOne(
  (saveQueue: SaveQueueEntry[]): Map<string, string[]> => {
    const encodedRunsByBucket = new Map<string, string[]>();
    for (const entry of saveQueue) {
      for (const action of entry.actions) {
        if (action.name !== "updateBucketPartial") continue;
        const { actionTracingId, position, mag, additionalCoordinates } = action.value;
        const address = globalPositionToBucketPositionWithMag(position, mag, additionalCoordinates);
        const key = keyOf(actionTracingId, address);
        let encodedRuns = encodedRunsByBucket.get(key);
        if (encodedRuns == null) {
          encodedRuns = [];
          encodedRunsByBucket.set(key, encodedRuns);
        }
        encodedRuns.push(action.value.voxelRunsBase64);
      }
    }
    return encodedRunsByBucket;
  },
);

/** The runs of the bucket's partial updates in the save queue, oldest first. */
export function getUnsavedPartialUpdateRuns(
  saveQueue: SaveQueueEntry[],
  tracingId: string,
  address: BucketAddress,
): VoxelRun[] {
  const encodedRuns = indexUnsavedPartialUpdates(saveQueue).get(keyOf(tracingId, address));
  if (encodedRuns == null) return [];
  return encodedRuns.flatMap((runsBase64) =>
    decodeBucketDiff(Uint8Array.from(atob(runsBase64), (char) => char.charCodeAt(0))),
  );
}
