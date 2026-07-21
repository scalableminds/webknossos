import { useEffect } from "react";
import getSceneController from "viewer/controller/scene_controller_provider";
import {
  clearMappingLevelPreviewAction,
  initializeMappingLevelPreviewSkeletonAction,
} from "viewer/model/actions/proofread_actions";
import Store from "viewer/store";

// Manages the lifecycle of the ephemeral skeleton that previews an agglomerate at a different mapping level
// (see SPIKE-per-agglomerate-mapping-level.md). Mount this while the mapping-level subtool panel is open.
// The skeleton is kept fully separate from the user's real skeleton (annotation.skeleton), mirroring the
// connectome tab's use_connectome_skeleton pattern. On teardown the ephemeral skeleton and preview state are removed.
export default function useMappingLevelPreviewSkeleton(layerName: string | null | undefined) {
  useEffect(() => {
    if (layerName == null) return undefined;

    // Seed an empty skeleton BEFORE registering it, so the three.js Skeleton initializes its buffers
    // (a null tracing would crash on the first render). Mirrors the connectome tab.
    Store.dispatch(initializeMappingLevelPreviewSkeletonAction());
    const skeletonId = getSceneController().addSkeleton(
      (state) =>
        state.localSegmentationStateByLayer[layerName]?.mappingLevelPreviewSkeleton ?? null,
      false,
    );

    return () => {
      if (!Store.getState().uiInformation.isWkInitialized) {
        // The viewer was already torn down (store reset, scene controller destroyed); doing anything here would crash.
        // See the same guard in use_connectome_skeleton.ts.
        return;
      }
      getSceneController().removeSkeleton(skeletonId);
      Store.dispatch(clearMappingLevelPreviewAction());
    };
  }, [layerName]);
}
