import { usePolling } from "libs/react_hooks";
import Toast from "libs/toast";
import { useEffect, useRef, useState } from "react";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import type { MutableTreeMap } from "viewer/model/types/tree_types";
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

// Keeps the landmarks of the two workers and the persisted landmark annotation in sync:
// 1. Once all iframes are ready, the stored landmarks of each side are imported into
//    the worker of that side. The worker annotations are sandboxes and start empty.
// 2. Afterwards, the landmarks of both workers are polled. Landmarks that were added in
//    a worker are copied into the group of that side in the landmark annotation.
//    Deleting a landmark in a worker doesn't delete it from the landmark annotation.
// Returns the current landmarks of both workers.
export function useLandmarkSync(
  { whenReady, sendMessage }: IframeBridge,
  fixedLayerName: string,
  movingLayerName: string,
): Record<Side, Landmark[]> {
  const [landmarks, setLandmarks] = useState<Record<Side, Landmark[]>>({ A: [], B: [] });
  // The ids of the tree groups that hold the landmarks of each side in the landmark
  // annotation. Null until the stored landmarks were imported into the workers.
  const [groupIds, setGroupIds] = useState<Record<Side, number> | null>(null);
  // The ids of the worker trees that already exist in the landmark annotation.
  const storedTreeIdsRef = useRef<Record<Side, Set<number>>>({ A: new Set(), B: new Set() });

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
      const importedTreeIds = await sendMessage<number[]>(side, "importNml", [nmlString]);
      storedTreeIdsRef.current[side] = new Set(importedTreeIds);
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

  const fetchWorkerTrees = async (side: Side): Promise<MutableTreeMap> => {
    const nmlString = await sendMessage<string>(side, "exportTreesAsNmlString");
    return (await parseNml(nmlString)).trees;
  };

  const storeNewLandmarks = async (side: Side, trees: MutableTreeMap, groupId: number) => {
    const storedTreeIds = storedTreeIdsRef.current[side];
    const newTreeIds = Array.from(trees.keys()).filter((treeId) => !storedTreeIds.has(treeId));
    if (newTreeIds.length === 0) {
      return;
    }
    const nmlString = await sendMessage<string>(side, "exportTreesAsNmlString", [
      { treeIds: newTreeIds },
    ]);
    await sendMessage("store", "importNml", [nmlString, groupId]);
    for (const treeId of newTreeIds) {
      storedTreeIds.add(treeId);
    }
  };

  // usePolling waits for one run to finish before it schedules the next one, so the
  // same landmark can't be stored twice by overlapping runs.
  usePolling(
    async () => {
      if (groupIds == null) {
        return;
      }
      try {
        const [treesA, treesB] = await Promise.all(SIDES.map(fetchWorkerTrees));
        setLandmarks({ A: getLandmarks(treesA), B: getLandmarks(treesB) });
        await storeNewLandmarks("A", treesA, groupIds.A);
        await storeNewLandmarks("B", treesB, groupIds.B);
      } catch (error) {
        console.error("Could not sync the landmarks:", error);
      }
    },
    groupIds != null ? SYNC_INTERVAL_MS : null,
    [groupIds],
  );

  return landmarks;
}
