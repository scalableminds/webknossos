import { useEffect, useState } from "react";
import type { Vector3 } from "viewer/constants";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import {
  getLandmarkGroupPath,
  getLandmarks,
  getLayerPairAlignment,
  type Landmark,
  type LayerPairAlignment,
  SIDES,
  type Side,
} from "./alignment_helpers";
import type { SendMessage } from "./use_iframe_bridge";

// A moving layer that is not shown in the right view.
export type InactivePair = {
  alignment: LayerPairAlignment;
  // The stored landmarks of the fixed layer side, to copy them to the active pair. Null if
  // there are none.
  fixedSideNmlString: string | null;
};

// Null while loading. The map has no entry for a layer whose landmarks could not be read.
export type InactivePairs = Map<string, InactivePair> | null;

async function readStoredSide(
  sendMessage: SendMessage,
  groupPath: string[],
): Promise<{ nmlString: string | null; landmarks: Landmark[] }> {
  // Reading must not create groups, otherwise every layer would get empty groups.
  const groupId = await sendMessage<number | null>("store", "findTreeGroupPath", [groupPath]);
  if (groupId == null) {
    return { nmlString: null, landmarks: [] };
  }
  const nmlString = await sendMessage<string>("store", "exportTreesAsNmlString", [{ groupId }]);
  return { nmlString, landmarks: getLandmarks((await parseNml(nmlString)).trees) };
}

async function readInactivePair(
  sendMessage: SendMessage,
  fixedLayerName: string,
  movingLayerName: string,
  voxelSizeFactor: Vector3,
): Promise<InactivePair> {
  const layerNames = { A: fixedLayerName, B: movingLayerName };
  const [sideA, sideB] = await Promise.all(
    SIDES.map((side: Side) => readStoredSide(sendMessage, getLandmarkGroupPath(layerNames, side))),
  );
  return {
    alignment: getLayerPairAlignment({ A: sideA.landmarks, B: sideB.landmarks }, voxelSizeFactor),
    fixedSideNmlString: sideA.landmarks.length > 0 ? sideA.nmlString : null,
  };
}

/** Reads the stored landmarks of the moving layers that are not shown in the right view and
 * estimates their alignments. This happens once: an inactive layer's landmarks can't change,
 * because switching to another moving layer mounts the alignment view anew.
 */
export function useInactivePairs(
  sendMessage: SendMessage,
  fixedLayerName: string,
  inactiveMovingLayerNames: string[],
  voxelSizeFactor: Vector3,
): InactivePairs {
  const [inactivePairs, setInactivePairs] = useState<InactivePairs>(null);
  // The effect below depends on the names, not on the array, which is created anew on every
  // render.
  const layerNamesKey = inactiveMovingLayerNames.join("\n");
  const [voxelSizeX, voxelSizeY, voxelSizeZ] = voxelSizeFactor;

  useEffect(() => {
    let isCancelled = false;
    const layerNames = layerNamesKey === "" ? [] : layerNamesKey.split("\n");
    Promise.all(
      layerNames.map(async (layerName): Promise<[string, InactivePair] | null> => {
        try {
          const pair = await readInactivePair(sendMessage, fixedLayerName, layerName, [
            voxelSizeX,
            voxelSizeY,
            voxelSizeZ,
          ]);
          return [layerName, pair];
        } catch (error) {
          console.error(`Could not read the stored landmarks of layer ${layerName}:`, error);
          return null;
        }
      }),
    ).then((entries) => {
      if (!isCancelled) {
        setInactivePairs(new Map(entries.filter((entry) => entry != null)));
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [sendMessage, fixedLayerName, layerNamesKey, voxelSizeX, voxelSizeY, voxelSizeZ]);

  return inactivePairs;
}
