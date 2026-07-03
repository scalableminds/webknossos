import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import messages from "messages";
import type { APIAnnotation, APIDataset } from "types/api_types";
import type {
  DirectLayerSpecificProps,
  PartialUrlManagerState,
  UrlStateByLayer,
} from "viewer/controller/url_manager";
import {
  getLayerByName,
  getSegmentationLayerByName,
  isSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  dispatchMaybeFetchMeshFilesAsync,
  updateCurrentMeshFileAction,
} from "viewer/model/actions/annotation_actions";
import {
  setActiveConnectomeAgglomerateIdsAction,
  updateCurrentConnectomeFileAction,
} from "viewer/model/actions/connectome_actions";
import {
  setAdditionalCoordinatesAction,
  setPositionAction,
  setRotationAction,
  setZoomStepAction,
} from "viewer/model/actions/flycam_actions";
import { snapshotMappingDataForNextRebaseAction } from "viewer/model/actions/save_actions";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "viewer/model/actions/segmentation_actions";
import {
  setMappingAction,
  setMappingEnabledAction,
  updateDatasetSettingAction,
  updateLayerSettingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import {
  loadAgglomerateTreeFromIdAction,
  setActiveNodeAction,
  setShowSkeletonsAction,
} from "viewer/model/actions/skeletontracing_actions";
import Store from "viewer/store";

export function applyState(
  state: PartialUrlManagerState,
  ignoreZoom: boolean = false,
  dataset?: APIDataset,
) {
  if (state.activeNode != null) {
    // Set the active node (without animating to its position) before setting the
    // position, since the position should take precedence.
    Store.dispatch(setActiveNodeAction(state.activeNode, true));
  }

  if (state.position != null) {
    Store.dispatch(setPositionAction(state.position));
  }

  if (!ignoreZoom && state.zoomStep != null) {
    Store.dispatch(setZoomStepAction(state.zoomStep));
  }

  if (state.rotation != null) {
    Store.dispatch(setRotationAction(state.rotation));
  }

  if (state.stateByLayer != null) {
    applyLayerState(state.stateByLayer);
  }

  if (state.additionalCoordinates != null) {
    Store.dispatch(setAdditionalCoordinatesAction(state.additionalCoordinates));
  }

  if ("nativelyRenderedLayerName" in state) {
    const isNativelyRenderedNamePresent =
      state.nativelyRenderedLayerName === null ||
      getIsNativelyRenderedNamePresent(dataset, state.nativelyRenderedLayerName);
    if (isNativelyRenderedNamePresent) {
      Store.dispatch(
        updateDatasetSettingAction(
          "nativelyRenderedLayerName",
          state.nativelyRenderedLayerName || null,
        ),
      );
    }
  }

  if (state.clippingDistance != null) {
    Store.dispatch(updateUserSettingAction("clippingDistance", state.clippingDistance));
  }

  if (state.clipSkeletonToCurrentSection != null) {
    Store.dispatch(
      updateUserSettingAction("clipSkeletonToCurrentSection", state.clipSkeletonToCurrentSection),
    );
  }
}

async function applyLayerState(stateByLayer: UrlStateByLayer) {
  for (const layerName of Object.keys(stateByLayer)) {
    const layerState = stateByLayer[layerName];
    let effectiveLayerName;

    const { dataset } = Store.getState();

    if (layerName === "Skeleton" && "isDisabled" in layerState) {
      Store.dispatch(setShowSkeletonsAction(!layerState.isDisabled));
      // The remaining options are only valid for data layers
      continue;
    }

    try {
      // The name of the layer could have changed if a volume tracing was created from a viewed annotation
      effectiveLayerName = getLayerByName(dataset, layerName, true).name;
    } catch (e) {
      Toast.error(
        // @ts-expect-error
        `URL configuration values for the layer "${layerName}" are ignored, because: ${e.message}`,
      );
      console.error(e);
      // @ts-expect-error
      ErrorHandling.notify(e, {
        urlLayerState: stateByLayer,
      });
      continue;
    }

    const layerSettingsKeys = [
      "isDisabled",
      "intensityRange",
      "color",
      "isInverted",
      "gammaCorrectionValue",
    ] as (keyof DirectLayerSpecificProps)[];
    layerSettingsKeys.forEach((key) => {
      if (key in layerState) {
        Store.dispatch(updateLayerSettingAction(effectiveLayerName, key, layerState[key]));
      }
    });

    if (!isSegmentationLayer(dataset, effectiveLayerName)) {
      // The remaining options are only valid for segmentation layers
      continue;
    }

    if (layerState.mappingInfo != null) {
      const { mappingName, mappingType, agglomerateIdsToImport } = layerState.mappingInfo;
      Store.dispatch(
        setMappingAction(effectiveLayerName, mappingName, mappingType, true, {
          showLoadingIndicator: true,
        }),
      );
      Store.dispatch(setMappingEnabledAction(effectiveLayerName, true));
      // Store initial changes of setMappingAction and setMappingEnabledAction in RebaseRelevantAnnotationState.
      Store.dispatch(snapshotMappingDataForNextRebaseAction(layerName));

      if (agglomerateIdsToImport != null) {
        const { annotation } = Store.getState();

        if (annotation.skeleton == null) {
          Toast.error(messages["tracing.agglomerate_tree.no_skeleton_tracing"]);
          continue;
        }

        if (mappingType !== "HDF5") {
          Toast.error(messages["tracing.agglomerate_tree.no_agglomerate_file_active"]);
          continue;
        }

        for (const agglomerateId of agglomerateIdsToImport) {
          Store.dispatch(
            loadAgglomerateTreeFromIdAction(effectiveLayerName, mappingName, agglomerateId),
          );
        }
      }
    }

    if (layerState.meshInfo) {
      const { meshFileName: currentMeshFileName, meshes } = layerState.meshInfo;

      if (currentMeshFileName != null) {
        const segmentationLayer = getSegmentationLayerByName(dataset, effectiveLayerName);
        // Ensure mesh files are loaded, so that the given mesh file name can be activated.
        // Doing this in a loop is fine, since it can only happen once (maximum) and there
        // are not many other iterations (== layers) which are blocked by this.

        await dispatchMaybeFetchMeshFilesAsync(Store.dispatch, segmentationLayer, dataset, false);
        Store.dispatch(updateCurrentMeshFileAction(effectiveLayerName, currentMeshFileName));
      }

      for (const mesh of meshes) {
        const { segmentId, seedPosition, seedAdditionalCoordinates } = mesh;

        if (mesh.isPrecomputed) {
          const { meshFileName } = mesh;
          Store.dispatch(
            loadPrecomputedMeshAction(
              segmentId,
              seedPosition,
              seedAdditionalCoordinates,
              meshFileName,
              undefined,
              undefined,
              effectiveLayerName,
            ),
          );
        } else {
          const { mappingName, mappingType } = mesh;
          Store.dispatch(
            loadAdHocMeshAction(
              segmentId,
              seedPosition,
              seedAdditionalCoordinates,
              {
                mappingName,
                mappingType,
              },
              effectiveLayerName,
            ),
          );
        }
      }
    }

    if (layerState.connectomeInfo != null) {
      const { connectomeName, agglomerateIdsToImport } = layerState.connectomeInfo;
      Store.dispatch(updateCurrentConnectomeFileAction(effectiveLayerName, connectomeName));

      if (agglomerateIdsToImport != null) {
        Store.dispatch(
          setActiveConnectomeAgglomerateIdsAction(effectiveLayerName, agglomerateIdsToImport),
        );
      }
    }
  }
}

export const getIsNativelyRenderedNamePresent = (
  dataset: APIDataset | null | undefined,
  nativelyRenderedLayerName: string | null | undefined,
  maybeAnnotation?: APIAnnotation | null,
) => {
  if (dataset == null) return false;
  return (
    dataset.dataSource.dataLayers.some(
      (layer) =>
        layer.name === nativelyRenderedLayerName ||
        (layer.category === "segmentation" && layer.fallbackLayer === nativelyRenderedLayerName),
    ) || maybeAnnotation?.annotationLayers.some((layer) => layer.name === nativelyRenderedLayerName)
  );
};
