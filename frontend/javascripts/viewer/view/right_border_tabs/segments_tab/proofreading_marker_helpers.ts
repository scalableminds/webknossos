import type { Dispatch } from "redux";
import { getSegmentIdForPosition } from "viewer/controller/combinations/volume_handlers";
import { getVolumeTracingByLayerName } from "viewer/model/accessors/volumetracing_accessor";
import { updateProofreadingMarkerPositionAction } from "viewer/model/actions/volumetracing_actions";
import Store from "viewer/store";

// Has to be called after the user removed segments from the segment list.
// The mapping saga adapts the active segment to the segment at the proofreading marker and
// re-adds that segment to the list if it's missing. Therefore, the marker is cleared if the
// segment at the marker or the active segment (which is usually the same) was removed.
// This is done here instead of in the REMOVE_SEGMENT reducer, because that reducer also
// handles removals that don't come from the user, such as remote update actions or the
// cleanup after a merge. In those cases, the marker should stay.
export function clearProofreadingMarkerIfItsSegmentWasRemoved(
  dispatch: Dispatch,
  removedSegmentIds: bigint[],
  layerName: string,
) {
  const state = Store.getState();
  const markerPosition = state.localSegmentationStateByLayer[layerName]?.proofreadingMarkerPosition;
  if (markerPosition == null || removedSegmentIds.length === 0) {
    return;
  }
  const activeCellId = getVolumeTracingByLayerName(state.annotation, layerName)?.activeCellId;
  const segmentIdAtMarker = getSegmentIdForPosition(markerPosition);
  if (removedSegmentIds.some((id) => id === activeCellId || id === segmentIdAtMarker)) {
    dispatch(updateProofreadingMarkerPositionAction(undefined, layerName));
  }
}
