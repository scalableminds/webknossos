import { usePolling } from "libs/react_hooks";
import Toast from "libs/toast";
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

/** Keeps the landmarks of the two workers and the persisted landmark annotation in sync:
 * 1. Once all iframes are ready, the stored landmarks of each side are imported into
 *    the worker of that side. The worker annotations are sandboxes and start empty.
 * 2. Afterwards, each worker is the source of truth for its side. The landmarks of both
 *    workers are polled. When the landmarks of a worker changed (added, deleted, moved,
 *    undo, ...), the group of that side in the landmark annotation is replaced with the
 *    trees of the worker.
 * Returns the current landmarks of both workers, whether they were loaded from the workers at
 * least once, and whether changed landmarks still have to be written to the landmark
 * annotation.
 */
export function useLandmarkSync(
  sendMessage: SendMessage,
  layerNames: LayerNames,
): {
  landmarks: Record<Side, Landmark[]>;
  hasLoadedLandmarks: boolean;
  hasUnsyncedLandmarks: boolean;
} {
  const [landmarks, setLandmarks] = useState<Record<Side, Landmark[]>>({ A: [], B: [] });
  const [hasLoadedLandmarks, setHasLoadedLandmarks] = useState(false);
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
      console.error(error);
      Toast.error("Could not load the stored landmarks.");
    });

    return () => {
      isCancelled = true;
    };
  }, [sendMessage, fixedLayerName, movingLayerName]);

  const fetchWorkerLandmarks = async (side: Side) => {
    const nmlString = await sendMessage<string>(side, "exportTreesAsNmlString");
    return { nmlString, landmarks: getLandmarks((await parseNml(nmlString)).trees) };
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
        const [workerA, workerB] = await Promise.all(SIDES.map(fetchWorkerLandmarks));
        const newLandmarks = { A: workerA.landmarks, B: workerB.landmarks };
        setLandmarks((previous) => (isEqual(previous, newLandmarks) ? previous : newLandmarks));
        setHasLoadedLandmarks(true);
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

  return { landmarks, hasLoadedLandmarks, hasUnsyncedLandmarks };
}
