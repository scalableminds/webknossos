import { useEffect, useRef } from "react";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getConnectomeDataForLayer } from "viewer/model/accessors/volumetracing_accessor";
import {
  initializeConnectomeTracingAction,
  removeConnectomeTracingAction,
  setActiveConnectomeAgglomerateIdsAction,
} from "viewer/model/actions/connectome_actions";
import Store from "viewer/store";

// Manages the lifecycle of the connectome skeleton that visualizes the synapses
// and agglomerates in the 3D scene. Whenever the segmentation layer changes (by name),
// the old skeleton is torn down, the connectome state of the old layer is reset
// and a new skeleton is initialized for the new layer.
export default function useConnectomeSkeleton(
  layerName: string | null | undefined,
  onLayerTeardown: () => void,
) {
  // Keep a ref to the latest callback so the effect only depends on the layer name.
  const onLayerTeardownRef = useRef(onLayerTeardown);
  onLayerTeardownRef.current = onLayerTeardown;

  useEffect(() => {
    if (layerName == null) return undefined;

    Store.dispatch(initializeConnectomeTracingAction(layerName));
    const skeletonId = getSceneController().addSkeleton(
      (state) => getConnectomeDataForLayer(state, layerName).skeleton ?? null,
      false,
    );

    return () => {
      if (!Store.getState().uiInformation.isWkInitialized) {
        // Because inner cleanups are executed before outer cleanups, we have
        // to check isWkInitialized here.
        // If isWkInitialized is false, this indicates that the WK viewer
        // was already torn down. In that case, the store was reset
        // and the scene controller destroyed. Executing the below
        // code would crash.
        return;
      }

      Store.dispatch(removeConnectomeTracingAction(layerName));
      getSceneController().removeSkeleton(skeletonId);
      // Reset the connectome selection and the local state of the tab
      Store.dispatch(setActiveConnectomeAgglomerateIdsAction(layerName, []));
      onLayerTeardownRef.current();
    };
  }, [layerName]);
}
