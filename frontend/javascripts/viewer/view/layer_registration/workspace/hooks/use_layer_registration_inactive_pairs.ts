import { useEffect, useState } from "react";
import type { Vector3 } from "viewer/constants";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import {
  getLandmarkGroupPath,
  getLandmarksFromTrees,
  type Landmark,
  SIDES,
  type Side,
} from "../../helpers/layer_registration_helpers";
import type { InactivePair, InactivePairs } from "../../helpers/layer_registration_moving_layers";
import { getLayerPairTransformEstimate } from "../../helpers/layer_registration_transform_estimation";
import type { SendMessage } from "../layer_registration_iframe_bridge";

async function readStoredSide(
  sendMessage: SendMessage,
  groupPath: string[],
): Promise<{ nmlString: string | null; landmarks: Landmark[] }> {
  // Reading must not create groups, otherwise every layer would get empty groups.
  const groupId = await sendMessage("store", "findTreeGroupPath", groupPath);
  if (groupId == null) {
    return { nmlString: null, landmarks: [] };
  }
  const nmlString = await sendMessage("store", "exportTreesAsNmlString", { groupId });
  return { nmlString, landmarks: getLandmarksFromTrees((await parseNml(nmlString)).trees) };
}

async function readInactivePair(
  sendMessage: SendMessage,
  fixedLayerName: string,
  movingLayerName: string,
  voxelSizeFactor: Vector3,
): Promise<InactivePair> {
  const layerNames = { fixed: fixedLayerName, moving: movingLayerName };
  const [fixedSide, movingSide] = await Promise.all(
    SIDES.map((side: Side) => readStoredSide(sendMessage, getLandmarkGroupPath(layerNames, side))),
  );
  return {
    estimate: getLayerPairTransformEstimate(
      { fixed: fixedSide.landmarks, moving: movingSide.landmarks },
      voxelSizeFactor,
    ),
    fixedSideNmlString: fixedSide.landmarks.length > 0 ? fixedSide.nmlString : null,
  };
}

/** Reads the stored landmarks of the moving layers that are not shown in the right view and
 * estimates their transforms. This happens once: an inactive layer's landmarks can't change,
 * because switching to another moving layer mounts the layer registration view anew.
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
