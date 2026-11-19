// Accessors of the unified datasets prototype (features.unifiedDatasets). In unified mode, users
// only see datasets. A dataset's annotation layers live in its backing annotation, which is never
// shown as an object of its own.
import features from "features";
import { ControlModeEnum } from "viewer/constants";
import type { WebknossosState } from "viewer/store";

// True if the loaded annotation is the backing annotation of the loaded dataset. Task annotations
// and legacy annotations opened via /annotations/:id are never backing annotations.
export function isBackingAnnotationLoaded(state: WebknossosState): boolean {
  const backingAnnotationId = state.dataset.backingAnnotationId;
  return (
    Boolean(features().unifiedDatasets) &&
    backingAnnotationId != null &&
    state.temporaryConfiguration.controlMode === ControlModeEnum.TRACE &&
    state.annotation.annotationId === backingAnnotationId
  );
}

// True if the viewer shows a dataset the unified way: either its backing annotation, or the plain
// dataset without annotation layers (view mode).
export function isUnifiedDatasetView(state: WebknossosState): boolean {
  if (!features().unifiedDatasets) {
    return false;
  }
  return (
    state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW ||
    isBackingAnnotationLoaded(state)
  );
}

// True if the user may change annotation layers of the dataset shown in unified mode.
export function mayEditUnifiedDataset(state: WebknossosState): boolean {
  return isBackingAnnotationLoaded(state) && state.annotation.restrictions.allowUpdate;
}
