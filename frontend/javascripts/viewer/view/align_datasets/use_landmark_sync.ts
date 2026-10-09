import { usePolling } from "libs/react_hooks";
import isEqual from "lodash-es/isEqual";
import { useEffect, useRef, useState } from "react";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import {
  getLandmarkGroupPath,
  getLandmarks,
  type Landmark,
  type LayerNames,
  SIDES,
  type Side,
} from "./alignment_helpers";
import type { SendMessage } from "./use_iframe_bridge";

const SYNC_INTERVAL_MS = 500;

// "loading" until the stored landmarks were imported into the workers and the landmarks of
// the workers were read once. "failed" if the import failed. Then nothing is synced, because
// the workers would overwrite the stored landmarks with their incomplete ones.
export type LandmarkSyncStatus = "loading" | "ready" | "failed";

/** Keeps the landmarks of the two workers and the persisted landmark annotation in sync:
 * 1. Once all iframes are ready, the stored landmarks of each side are imported into
 *    the worker of that side. The worker annotations are sandboxes and start empty.
 * 2. Afterwards, each worker is the source of truth for its side. The landmarks of both
 *    workers are polled. When the landmarks of a worker changed (added, deleted, moved,
 *    undo, ...), the group of that side in the landmark annotation is replaced with the
 *    trees of the worker.
 * Returns the current landmarks of both workers, the status of the sync, whether changed
 * landmarks still have to be written to the landmark annotation, and a function that reads
 * the landmarks from the workers right away.
 */
export function useLandmarkSync(
  sendMessage: SendMessage,
  layerNames: LayerNames,
): {
  landmarks: Record<Side, Landmark[]>;
  status: LandmarkSyncStatus;
  hasUnsyncedLandmarks: boolean;
  fetchLandmarks: () => Promise<Record<Side, Landmark[]>>;
} {
  const [landmarks, setLandmarks] = useState<Record<Side, Landmark[]>>({ A: [], B: [] });
  const [status, setStatus] = useState<LandmarkSyncStatus>("loading");
  const [hasUnsyncedLandmarks, setHasUnsyncedLandmarks] = useState(false);
  // The ids of the tree groups that hold the landmarks of each side in the landmark
  // annotation. Null until the stored landmarks were imported into the workers.
  const [groupIds, setGroupIds] = useState<Record<Side, number> | null>(null);
  // The landmarks of each side as they were last written to the landmark annotation.
  const storedLandmarksRef = useRef<Record<Side, Landmark[]>>({ A: [], B: [] });
  // The effect below depends on the names, not on the object, which is created anew on every
  // render.
  const { A: fixedLayerName, B: movingLayerName } = layerNames;

  useEffect(() => {
    let isCancelled = false;

    const importStoredLandmarks = async (side: Side): Promise<number> => {
      const groupId = await sendMessage<number>("store", "ensureTreeGroupPath", [
        getLandmarkGroupPath({ A: fixedLayerName, B: movingLayerName }, side),
      ]);
      const nmlString = await sendMessage<string>("store", "exportTreesAsNmlString", [{ groupId }]);
      if (isCancelled) {
        return groupId;
      }
      await sendMessage(side, "importNml", [nmlString]);
      storedLandmarksRef.current[side] = getLandmarks((await parseNml(nmlString)).trees);
      return groupId;
    };

    (async () => {
      const groupIdA = await importStoredLandmarks("A");
      const groupIdB = await importStoredLandmarks("B");
      if (!isCancelled) {
        setGroupIds({ A: groupIdA, B: groupIdB });
      }
    })().catch((error) => {
      console.error("Could not load the stored landmarks:", error);
      if (!isCancelled) {
        setStatus("failed");
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [sendMessage, fixedLayerName, movingLayerName]);

  const fetchLandmarksOfWorker = async (side: Side) => {
    const nmlString = await sendMessage<string>(side, "exportTreesAsNmlString");
    return { nmlString, landmarks: getLandmarks((await parseNml(nmlString)).trees) };
  };

  // Reads the landmarks of both workers and updates the returned landmarks.
  const fetchWorkerLandmarks = async () => {
    const [workerA, workerB] = await Promise.all(SIDES.map(fetchLandmarksOfWorker));
    const newLandmarks = { A: workerA.landmarks, B: workerB.landmarks };
    setLandmarks((previous) => (isEqual(previous, newLandmarks) ? previous : newLandmarks));
    return { workerA, workerB, newLandmarks };
  };

  const storeChangedLandmarks = async (
    side: Side,
    worker: { nmlString: string; landmarks: Landmark[] },
    groupId: number,
  ) => {
    if (isEqual(worker.landmarks, storedLandmarksRef.current[side])) {
      return;
    }
    await sendMessage("store", "replaceTreesInGroup", [worker.nmlString, groupId]);
    storedLandmarksRef.current[side] = worker.landmarks;
  };

  // usePolling waits for one run to finish before it schedules the next one, so runs
  // can't overlap.
  usePolling(
    async () => {
      if (groupIds == null) {
        return;
      }
      try {
        const { workerA, workerB, newLandmarks } = await fetchWorkerLandmarks();
        setStatus("ready");
        setHasUnsyncedLandmarks(
          SIDES.some((side) => !isEqual(newLandmarks[side], storedLandmarksRef.current[side])),
        );
        await storeChangedLandmarks("A", workerA, groupIds.A);
        await storeChangedLandmarks("B", workerB, groupIds.B);
        setHasUnsyncedLandmarks(false);
      } catch (error) {
        console.error("Could not sync the landmarks:", error);
      }
    },
    groupIds != null ? SYNC_INTERVAL_MS : null,
    [groupIds],
  );

  const fetchLandmarks = async () => (await fetchWorkerLandmarks()).newLandmarks;

  return { landmarks, status, hasUnsyncedLandmarks, fetchLandmarks };
}
