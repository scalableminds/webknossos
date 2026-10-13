import { usePolling } from "libs/react_hooks";
import isEqual from "lodash-es/isEqual";
import { useEffect, useRef, useState } from "react";
import type { Vector3 } from "viewer/constants";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import {
  getLandmarkGroupPath,
  getLandmarkPairInfo,
  getLandmarks,
  type Landmark,
  type LandmarkPairInfo,
  type LayerNames,
  SIDES,
  type Side,
} from "./alignment_helpers";
import type { SendMessage } from "./use_iframe_bridge";

const SYNC_INTERVAL_MS = 500;

// What is compared to decide whether a side must be written to the landmark annotation. Tree
// ids change on every import and colors follow the pair ids, so both are left out.
function getStoredFields(
  landmarks: Landmark[],
): Array<{ pairId: number | null; position: Vector3 }> {
  return landmarks.map(({ pairId, position }) => ({ pairId, position }));
}

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
 *    trees of the worker. Each worker also gets the pair info that it needs to name its next
 *    landmark (see getLandmarkPairInfo).
 * Returns the current landmarks of both workers, the status of the sync, whether changed
 * landmarks still have to be written to the landmark annotation, a function that reads
 * the landmarks from the workers right away, and a function that stops the sync for good.
 */
export function useLandmarkSync(
  sendMessage: SendMessage,
  layerNames: LayerNames,
): {
  landmarks: Record<Side, Landmark[]>;
  status: LandmarkSyncStatus;
  hasUnsyncedLandmarks: boolean;
  fetchLandmarks: () => Promise<Record<Side, Landmark[]>>;
  stopSync: () => void;
} {
  const [landmarks, setLandmarks] = useState<Record<Side, Landmark[]>>({ A: [], B: [] });
  const [status, setStatus] = useState<LandmarkSyncStatus>("loading");
  const [hasUnsyncedLandmarks, setHasUnsyncedLandmarks] = useState(false);
  // The ids of the tree groups that hold the landmarks of each side in the landmark
  // annotation. Null until the stored landmarks were imported into the workers.
  const [groupIds, setGroupIds] = useState<Record<Side, number> | null>(null);
  // The landmarks of each side as they were last written to the landmark annotation.
  const storedFieldsRef = useRef<Record<Side, ReturnType<typeof getStoredFields>>>({
    A: [],
    B: [],
  });
  // The pair info that was last sent to each worker.
  const sentPairInfoRef = useRef<Partial<Record<Side, LandmarkPairInfo>>>({});
  // Set when a worker was reloaded. Its landmarks are then missing until the stored ones are
  // imported again, so writing them to the landmark annotation would delete landmarks.
  const isStoppedRef = useRef(false);
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
      await sendMessage(side, "importLandmarks", [nmlString]);
      storedFieldsRef.current[side] = getStoredFields(
        getLandmarks((await parseNml(nmlString)).trees),
      );
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
    const storedFields = getStoredFields(worker.landmarks);
    if (isStoppedRef.current || isEqual(storedFields, storedFieldsRef.current[side])) {
      return;
    }
    await sendMessage("store", "replaceTreesInGroup", [worker.nmlString, groupId]);
    storedFieldsRef.current[side] = storedFields;
  };

  const sendChangedPairInfo = async (side: Side, newLandmarks: Record<Side, Landmark[]>) => {
    const pairInfo = getLandmarkPairInfo(newLandmarks, side);
    if (isEqual(pairInfo, sentPairInfoRef.current[side])) {
      return;
    }
    await sendMessage(side, "setLandmarkPairInfo", [pairInfo]);
    sentPairInfoRef.current[side] = pairInfo;
  };

  // usePolling waits for one run to finish before it schedules the next one, so runs
  // can't overlap.
  usePolling(
    async () => {
      if (groupIds == null || isStoppedRef.current) {
        return;
      }
      try {
        const { workerA, workerB, newLandmarks } = await fetchWorkerLandmarks();
        // Sent before the overlay goes away, so that the first click already uses it.
        await Promise.all(SIDES.map((side) => sendChangedPairInfo(side, newLandmarks)));
        setStatus("ready");
        setHasUnsyncedLandmarks(
          SIDES.some(
            (side) => !isEqual(getStoredFields(newLandmarks[side]), storedFieldsRef.current[side]),
          ),
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

  const stopSync = () => {
    isStoppedRef.current = true;
  };

  return { landmarks, status, hasUnsyncedLandmarks, fetchLandmarks, stopSync };
}
