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
import type { useIframeBridge } from "./use_iframe_bridge";

const SYNC_INTERVAL_MS = 500;

type IframeBridge = Pick<ReturnType<typeof useIframeBridge>, "whenReady" | "sendMessage">;

/** Keeps the landmarks of the two workers and the persisted landmark annotation in sync:
 * 1. Once all iframes are ready, the stored landmarks of each side are imported into
 *    the worker of that side. The worker annotations are sandboxes and start empty.
 * 2. Afterwards, each worker is the source of truth for its side. The landmarks of both
 *    workers are polled. When the landmarks of a worker changed (added, deleted, moved,
 *    undo, ...), the group of that side in the landmark annotation is replaced with the
 *    trees of the worker.
 * Returns the current landmarks of both workers, and whether they were loaded from the
 * workers at least once.
 */
export function useLandmarkSync(
  { whenReady, sendMessage }: IframeBridge,
  fixedLayerName: string,
  movingLayerName: string,
): { landmarks: Record<Side, Landmark[]>; hasLoadedLandmarks: boolean } {
  const [landmarks, setLandmarks] = useState<Record<Side, Landmark[]>>({ A: [], B: [] });
  const [hasLoadedLandmarks, setHasLoadedLandmarks] = useState(false);
  // The ids of the tree groups that hold the landmarks of each side in the landmark
  // annotation. Null until the stored landmarks were imported into the workers.
  const [groupIds, setGroupIds] = useState<Record<Side, number> | null>(null);
  // The landmarks of each side as they were last written to the landmark annotation.
  const storedLandmarksRef = useRef<Record<Side, Landmark[]>>({ A: [], B: [] });

  useEffect(() => {
    const layerNames: LayerNames = { A: fixedLayerName, B: movingLayerName };
    let isCancelled = false;

    const importStoredLandmarks = async (side: Side): Promise<number> => {
      const groupId = await sendMessage<number>("store", "ensureTreeGroupPath", [
        getLandmarkGroupPath(layerNames, side),
      ]);
      const nmlString = await sendMessage<string>("store", "exportTreesAsNmlString", [{ groupId }]);
      await whenReady(side);
      if (isCancelled) {
        return groupId;
      }
      await sendMessage(side, "importNml", [nmlString]);
      storedLandmarksRef.current[side] = getLandmarks((await parseNml(nmlString)).trees);
      return groupId;
    };

    (async () => {
      await whenReady("store");
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
  }, [whenReady, sendMessage, fixedLayerName, movingLayerName]);

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
        await storeChangedLandmarks("A", workerA, groupIds.A);
        await storeChangedLandmarks("B", workerB, groupIds.B);
      } catch (error) {
        console.error("Could not sync the landmarks:", error);
      }
    },
    groupIds != null ? SYNC_INTERVAL_MS : null,
    [groupIds],
  );

  return { landmarks, hasLoadedLandmarks };
}
