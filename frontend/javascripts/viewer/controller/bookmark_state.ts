import type { APIAnnotationBookmarkLayerState, APIAnnotationBookmarkState } from "types/api_types";
import type {
  CompleteUrlManagerState,
  UrlManagerState,
  UrlStateByLayer,
} from "viewer/controller/url_manager";

// The url state stores the skeleton visibility as a pseudo layer.
const SKELETON_LAYER_NAME = "Skeleton";

export function urlStateToBookmarkState(
  urlState: CompleteUrlManagerState,
): APIAnnotationBookmarkState {
  const { [SKELETON_LAYER_NAME]: skeletonLayerState, ...dataLayerStates } =
    urlState.stateByLayer ?? {};
  const layers = Object.entries(dataLayerStates).map(
    ([layerName, layerState]): APIAnnotationBookmarkLayerState => ({
      layerName,
      isDisabled: layerState.isDisabled,
      intensityRange: layerState.intensityRange,
      color: layerState.color,
      isInverted: layerState.isInverted,
      gammaCorrectionValue: layerState.gammaCorrectionValue,
      mapping:
        layerState.mappingInfo != null
          ? {
              mappingName: layerState.mappingInfo.mappingName,
              mappingType: layerState.mappingInfo.mappingType,
            }
          : null,
      meshFileName: layerState.meshInfo?.meshFileName,
      meshes: (layerState.meshInfo?.meshes ?? []).map((mesh) =>
        mesh.isPrecomputed
          ? {
              segmentId: mesh.segmentId,
              seedPosition: mesh.seedPosition,
              isPrecomputed: true,
              meshFileName: mesh.meshFileName,
            }
          : {
              segmentId: mesh.segmentId,
              seedPosition: mesh.seedPosition,
              isPrecomputed: false,
              mappingName: mesh.mappingName,
              mappingType: mesh.mappingType,
            },
      ),
    }),
  );
  return {
    position: urlState.position,
    mode: urlState.mode,
    zoomStep: urlState.zoomStep,
    rotation: urlState.rotation,
    activeNodeId: urlState.activeNode,
    additionalCoordinates: urlState.additionalCoordinates,
    nativelyRenderedLayerName: urlState.nativelyRenderedLayerName,
    clippingDistance: urlState.clippingDistance,
    clipSkeletonToCurrentSection: urlState.clipSkeletonToCurrentSection,
    tdCamera: urlState.tdCamera,
    showSkeletons: skeletonLayerState != null ? !skeletonLayerState.isDisabled : null,
    layers,
  };
}

export function bookmarkStateToUrlState(state: APIAnnotationBookmarkState): UrlManagerState {
  const stateByLayer: UrlStateByLayer = {};
  for (const layer of state.layers) {
    const layerState: UrlStateByLayer[string] = {};
    // applyState checks layer settings with the `in` operator, so unset ones must not be added.
    if (layer.isDisabled != null) layerState.isDisabled = layer.isDisabled;
    if (layer.intensityRange != null) layerState.intensityRange = layer.intensityRange;
    if (layer.color != null) layerState.color = layer.color;
    if (layer.isInverted != null) layerState.isInverted = layer.isInverted;
    if (layer.gammaCorrectionValue != null)
      layerState.gammaCorrectionValue = layer.gammaCorrectionValue;
    if (layer.mapping != null) layerState.mappingInfo = layer.mapping;
    if (layer.meshFileName != null || layer.meshes.length > 0) {
      layerState.meshInfo = { meshFileName: layer.meshFileName, meshes: layer.meshes };
    }
    stateByLayer[layer.layerName] = layerState;
  }
  if (state.showSkeletons != null) {
    stateByLayer[SKELETON_LAYER_NAME] = { isDisabled: !state.showSkeletons };
  }

  return {
    position: state.position,
    mode: state.mode,
    zoomStep: state.zoomStep,
    rotation: state.rotation ?? undefined,
    activeNode: state.activeNodeId ?? undefined,
    // Unset repeated proto fields are decoded as empty arrays.
    additionalCoordinates:
      state.additionalCoordinates != null && state.additionalCoordinates.length > 0
        ? state.additionalCoordinates
        : null,
    nativelyRenderedLayerName: state.nativelyRenderedLayerName ?? null,
    clippingDistance: state.clippingDistance,
    clipSkeletonToCurrentSection: state.clipSkeletonToCurrentSection,
    tdCamera: state.tdCamera ?? undefined,
    stateByLayer,
  };
}
