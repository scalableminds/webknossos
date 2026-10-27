import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import messages from "messages";
import type { APIAnnotation, APIDataset } from "types/api_types";
import { MappingStatusEnum, OrthoViews } from "viewer/constants";
import type {
  DirectLayerSpecificProps,
  MeshUrlDescriptor,
  PartialUrlManagerState,
  TdCameraUrlState,
  UrlStateByLayer,
} from "viewer/controller/url_manager";
import {
  getLayerByName,
  getSegmentationLayerByName,
  isSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { getInputCatcherRect } from "viewer/model/accessors/view_mode_accessor";
import {
  getMeshesForAdditionalCoordinates,
  hasEditableMapping,
  isMappingLocked,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  dispatchMaybeFetchMeshFilesAsync,
  updateCurrentMeshFileAction,
  updateMeshVisibilityAction,
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
  deselectActiveTreeAction,
  loadAgglomerateTreeFromIdAction,
  setActiveNodeAction,
  setShowSkeletonsAction,
} from "viewer/model/actions/skeletontracing_actions";
import { setTDCameraWithoutTimeTrackingAction } from "viewer/model/actions/view_mode_actions";
import type { MeshInformation } from "viewer/store";
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

  if (state.tdCamera != null) {
    Store.dispatch(setTDCameraWithoutTimeTrackingAction(state.tdCamera));
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

function isSameMesh(loadedMesh: MeshInformation, descriptor: MeshUrlDescriptor): boolean {
  if (loadedMesh.segmentId !== descriptor.segmentId) return false;
  if (loadedMesh.isPrecomputed && descriptor.isPrecomputed) {
    return loadedMesh.meshFileName === descriptor.meshFileName;
  }
  if (!loadedMesh.isPrecomputed && !descriptor.isPrecomputed) {
    return (
      (loadedMesh.mappingName ?? null) === (descriptor.mappingName ?? null) &&
      (loadedMesh.mappingType ?? null) === (descriptor.mappingType ?? null)
    );
  }
  return false;
}

// Widens the frustum horizontally or vertically so that the bookmarked view stays
// fully visible and undistorted in a 3D viewport with a different aspect ratio.
function fitTDCameraToAspectRatio(
  tdCamera: TdCameraUrlState,
  aspectRatio: number,
): TdCameraUrlState {
  const { left, right, top, bottom } = tdCamera;
  const width = right - left;
  const height = top - bottom;
  if (width <= 0 || height <= 0) return tdCamera;
  const newWidth = Math.max(width, height * aspectRatio);
  const newHeight = newWidth / aspectRatio;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return {
    ...tdCamera,
    left: centerX - newWidth / 2,
    right: centerX + newWidth / 2,
    top: centerY + newHeight / 2,
    bottom: centerY - newHeight / 2,
  };
}

// applyState only applies what the url state contains, which is enough for an initial page load.
// When jumping to a bookmark, the current view also has to be reset where getUrlState omits
// values that are off or default. Meshes and mappings that are already loaded are reused.
export function applyBookmarkState(urlState: PartialUrlManagerState, dataset: APIDataset) {
  const state = Store.getState();
  const stateByLayer: UrlStateByLayer = { ...urlState.stateByLayer };

  if (urlState.activeNode == null && state.annotation.skeleton != null) {
    Store.dispatch(deselectActiveTreeAction());
  }

  for (const [layerName, mappingInfo] of Object.entries(
    state.temporaryConfiguration.activeMappingByLayer,
  )) {
    if (mappingInfo.mappingStatus !== MappingStatusEnum.ENABLED) continue;
    const bookmarkedMapping = stateByLayer[layerName]?.mappingInfo;
    if (bookmarkedMapping == null) {
      if (!isMappingLocked(state, layerName) && !hasEditableMapping(state, layerName)) {
        Store.dispatch(setMappingEnabledAction(layerName, false));
      }
    } else if (
      bookmarkedMapping.mappingName === mappingInfo.mappingName &&
      bookmarkedMapping.mappingType === mappingInfo.mappingType
    ) {
      const { mappingInfo: _alreadyActive, ...rest } = stateByLayer[layerName];
      stateByLayer[layerName] = rest;
    }
  }

  const additionalCoordinates =
    urlState.additionalCoordinates ?? state.flycam.additionalCoordinates;
  for (const layerName of Object.keys(state.localSegmentationStateByLayer)) {
    const loadedMeshes = getMeshesForAdditionalCoordinates(state, additionalCoordinates, layerName);
    if (loadedMeshes == null) continue;
    const meshInfo = stateByLayer[layerName]?.meshInfo;
    const bookmarkedMeshes = meshInfo?.meshes ?? [];
    const meshesToLoad = bookmarkedMeshes.filter(
      (descriptor) => !Object.values(loadedMeshes).some((mesh) => isSameMesh(mesh, descriptor)),
    );
    for (const mesh of Object.values(loadedMeshes)) {
      const shouldBeVisible = bookmarkedMeshes.some((descriptor) => isSameMesh(mesh, descriptor));
      if (mesh.isVisible !== shouldBeVisible) {
        Store.dispatch(
          updateMeshVisibilityAction(
            layerName,
            mesh.segmentId,
            shouldBeVisible,
            additionalCoordinates,
          ),
        );
      }
    }
    if (meshInfo != null) {
      stateByLayer[layerName] = {
        ...stateByLayer[layerName],
        meshInfo: { ...meshInfo, meshes: meshesToLoad },
      };
    }
  }

  // If the 3D viewport is hidden, the camera controller adapts the aspect ratio once it is shown.
  const tdRect = getInputCatcherRect(state, OrthoViews.TDView);
  const tdCamera =
    urlState.tdCamera != null && tdRect.width > 0 && tdRect.height > 0
      ? fitTDCameraToAspectRatio(urlState.tdCamera, tdRect.width / tdRect.height)
      : urlState.tdCamera;

  applyState({ ...urlState, tdCamera, stateByLayer }, false, dataset);
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
      Store.dispatch(snapshotMappingDataForNextRebaseAction(effectiveLayerName));

      if (agglomerateIdsToImport != null) {
        const { annotation } = Store.getState();

        if (annotation.skeleton == null) {
          Toast.error(messages["tracing.agglomerate_tree.no_skeleton_tracing"]);
          continue;
        }

        if (mappingType !== "AGGLOMERATE") {
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
