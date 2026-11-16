import type { OrthoView, Vector2 } from "viewer/constants";
import { getPlaneExtentInVoxelFromStore } from "viewer/model/accessors/view_mode_accessor";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import type { WebknossosState } from "viewer/store";

export function* getHalfViewportExtentsInVx(activeViewport: OrthoView): Saga<Vector2> {
  return yield* select((state) => getHalfViewportExtentsInVxFromState(state, activeViewport));
}

export function getHalfViewportExtentsInVxFromState(
  state: WebknossosState,
  activeViewport: OrthoView,
): Vector2 {
  const viewportExtents = getPlaneExtentInVoxelFromStore(
    state,
    state.flycam.zoomStep,
    activeViewport,
  );
  return viewportExtents.map((extent) => Math.round(extent / 2)) as Vector2;
}
