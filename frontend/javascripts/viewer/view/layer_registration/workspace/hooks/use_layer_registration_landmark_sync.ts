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
} from "../../helpers/layer_registration_helpers";
import type { SendMessage } from "./use_layer_registration_iframe_bridge";

const SYNC_INTERVAL_MS = 500;

// What is compared to decide whether a side must be written to the landmark annotation. Tree
// ids change on every import and colors follow the pair ids, so both are left out.
function getStoredFields(
  landmarks: Landmark[],
): Array<{ pairId: number | null; position: Vector3 }> {
  return landmarks.map(({ pairId, position }) => ({ pairId, position }));
}

// The landmarks of one worker, as NML and parsed.
type WorkerLandmarks = { nmlString: string; landmarks: Landmark[] };

function getParsedLandmarks(
  workerLandmarks: Record<Side, WorkerLandmarks>,
): Record<Side, Landmark[]> {
  return { fixed: workerLandmarks.fixed.landmarks, moving: workerLandmarks.moving.landmarks };
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
 * the landmarks from the workers right away, a function that stops the sync for good (e.g.
 * after a worker lost its landmarks), and functions to stop the sync after writing the last
 * changes and to resume it (e.g. before and after a failed switch to another moving layer).
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
  flushAndStopSync: () => Promise<void>;
  resumeSync: () => void;
} {
  const [landmarks, setLandmarks] = useState<Record<Side, Landmark[]>>({ fixed: [], moving: [] });
  const [status, setStatus] = useState<LandmarkSyncStatus>("loading");
  const [hasUnsyncedLandmarks, setHasUnsyncedLandmarks] = useState(false);
  // The ids of the tree groups that hold the landmarks of each side in the landmark
  // annotation. Null until the stored landmarks were imported into the workers.
  const [groupIds, setGroupIds] = useState<Record<Side, number> | null>(null);
  // The landmarks of each side as they were last written to the landmark annotation.
  const storedFieldsRef = useRef<Record<Side, ReturnType<typeof getStoredFields>>>({
    fixed: [],
    moving: [],
  });
  // The pair info that was last sent to each worker.
  const sentPairInfoRef = useRef<Partial<Record<Side, LandmarkPairInfo>>>({});
  // Set when a worker was reloaded. Its landmarks are then missing until the stored ones are
  // imported again, so writing them to the landmark annotation would delete landmarks. Also
  // set while switching to another moving layer.
  const isStoppedRef = useRef(false);
  // The sync run that is in progress, if any.
  const runningSyncRef = useRef<Promise<void> | null>(null);
  // The effect below depends on the names, not on the object, which is created anew on every
  // render.
  const { fixed: fixedLayerName, moving: movingLayerName } = layerNames;

  useEffect(() => {
    let isCancelled = false;

    const importStoredLandmarks = async (side: Side): Promise<number> => {
      const groupId = await sendMessage<number>("store", "ensureTreeGroupPath", [
        getLandmarkGroupPath({ fixed: fixedLayerName, moving: movingLayerName }, side),
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
      const fixedGroupId = await importStoredLandmarks("fixed");
      const movingGroupId = await importStoredLandmarks("moving");
      if (!isCancelled) {
        setGroupIds({ fixed: fixedGroupId, moving: movingGroupId });
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

  const fetchLandmarksOfWorker = async (side: Side): Promise<WorkerLandmarks> => {
    const nmlString = await sendMessage<string>(side, "exportTreesAsNmlString");
    return { nmlString, landmarks: getLandmarks((await parseNml(nmlString)).trees) };
  };

  // Reads the landmarks of both workers and updates the returned landmarks.
  const fetchWorkerLandmarks = async (): Promise<Record<Side, WorkerLandmarks>> => {
    const [fixed, moving] = await Promise.all(SIDES.map(fetchLandmarksOfWorker));
    const workerLandmarks = { fixed, moving };
    const newLandmarks = getParsedLandmarks(workerLandmarks);
    setLandmarks((previous) => (isEqual(previous, newLandmarks) ? previous : newLandmarks));
    return workerLandmarks;
  };

  const hasUnstoredChanges = (side: Side, landmarksOfSide: Landmark[]) =>
    !isEqual(getStoredFields(landmarksOfSide), storedFieldsRef.current[side]);

  // Replaces the stored landmarks of each side whose landmarks changed in its worker.
  const storeChangedLandmarks = async (
    workerLandmarks: Record<Side, WorkerLandmarks>,
    sideGroupIds: Record<Side, number>,
  ) => {
    for (const side of SIDES) {
      const { nmlString, landmarks: landmarksOfSide } = workerLandmarks[side];
      if (hasUnstoredChanges(side, landmarksOfSide)) {
        await sendMessage("store", "replaceTreesInGroup", [nmlString, sideGroupIds[side]]);
        storedFieldsRef.current[side] = getStoredFields(landmarksOfSide);
      }
    }
    setHasUnsyncedLandmarks(false);
  };

  const sendChangedPairInfo = async (side: Side, newLandmarks: Record<Side, Landmark[]>) => {
    const pairInfo = getLandmarkPairInfo(newLandmarks, side);
    if (isEqual(pairInfo, sentPairInfoRef.current[side])) {
      return;
    }
    await sendMessage(side, "setLandmarkPairInfo", [pairInfo]);
    sentPairInfoRef.current[side] = pairInfo;
  };

  const syncLandmarks = async (sideGroupIds: Record<Side, number>) => {
    try {
      const workerLandmarks = await fetchWorkerLandmarks();
      const newLandmarks = getParsedLandmarks(workerLandmarks);
      // Sent before the overlay goes away, so that the first click already uses it.
      await Promise.all(SIDES.map((side) => sendChangedPairInfo(side, newLandmarks)));
      setStatus("ready");
      setHasUnsyncedLandmarks(SIDES.some((side) => hasUnstoredChanges(side, newLandmarks[side])));
      if (!isStoppedRef.current) {
        await storeChangedLandmarks(workerLandmarks, sideGroupIds);
      }
    } catch (error) {
      console.error("Could not sync the landmarks:", error);
    }
  };

  // usePolling waits for one run to finish before it schedules the next one, so runs
  // can't overlap.
  usePolling(
    async () => {
      if (groupIds == null || isStoppedRef.current) {
        return;
      }
      runningSyncRef.current = syncLandmarks(groupIds);
      await runningSyncRef.current;
    },
    groupIds != null ? SYNC_INTERVAL_MS : null,
    [groupIds],
  );

  const fetchLandmarks = async () => getParsedLandmarks(await fetchWorkerLandmarks());

  const stopSync = () => {
    isStoppedRef.current = true;
  };

  // Writes the current landmarks of both workers to the landmark annotation, so that a
  // landmark placed right before is not lost, and stops the sync. Throws if writing fails.
  const flushAndStopSync = async () => {
    isStoppedRef.current = true;
    await runningSyncRef.current;
    if (groupIds == null) {
      // The stored landmarks were not imported yet, so the workers have nothing new.
      return;
    }
    await storeChangedLandmarks(await fetchWorkerLandmarks(), groupIds);
  };

  const resumeSync = () => {
    isStoppedRef.current = false;
  };

  return {
    landmarks,
    status,
    hasUnsyncedLandmarks,
    fetchLandmarks,
    stopSync,
    flushAndStopSync,
    resumeSync,
  };
}
