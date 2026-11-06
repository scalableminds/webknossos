import type { Dispatch } from "redux";
import { getVolumeTracingByLayerName } from "viewer/model/accessors/volumetracing_accessor";
import { updateProofreadingMarkerPositionAction } from "viewer/model/actions/volumetracing_actions";
import Store from "viewer/store";

// Has to be called after the user removed segments from the segment list.
// The mapping saga adapts the active segment to the segment at the proofreading marker and
// re-adds that segment to the list if it's missing. The marker always refers to the active
// segment (see clearProofreadingMarkerWhenActiveSegmentDiverges), so the marker is cleared if
// the active segment was removed.
// This is done here instead of in the REMOVE_SEGMENT reducer, because that reducer also
// handles removals that don't come from the user, such as remote update actions or the
// cleanup after a merge. In those cases, the marker should stay.
export function clearProofreadingMarkerIfItsSegmentWasRemoved(
  dispatch: Dispatch,
  removedSegmentIds: bigint[],
  layerName: string,
) {
  const activeCellId = getVolumeTracingByLayerName(
    Store.getState().annotation,
    layerName,
  )?.activeCellId;
  if (activeCellId != null && removedSegmentIds.includes(activeCellId)) {
    dispatch(updateProofreadingMarkerPositionAction(undefined, layerName));
  }
}
