import type { OxalisState } from "oxalis/store";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { V2 } from "libs/mjs";
import type { Vector2, OrthoView } from "oxalis/constants";
import "oxalis/constants";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getPlaneExtentInVoxelFromStore } from "oxalis/model/accessors/flycam_accessor";
import Dimensions from "oxalis/model/dimensions";
export function* getHalfViewportExtents(activeViewport: OrthoView): Saga<Vector2> {
  const zoom = yield* select((state) => state.flycam.zoomStep);
  const baseVoxelFactors = yield* select((state) =>
    Dimensions.transDim(getBaseVoxelFactors(state.dataset.dataSource.scale), activeViewport),
  );
  const viewportExtents = yield* select((state) =>
    getPlaneExtentInVoxelFromStore(state, zoom, activeViewport),
  );
  const scaledViewportExtents = V2.scale2(viewportExtents, baseVoxelFactors);
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'extent' implicitly has an 'any' type.
  const halfViewportExtents = scaledViewportExtents.map((extent) => Math.round(extent / 2));
  return halfViewportExtents;
}
export function getHalfViewportExtentsFromState(
  state: OxalisState,
  activeViewport: OrthoView,
): Vector2 {
  const zoom = state.flycam.zoomStep;
  const baseVoxelFactors = Dimensions.transDim(
    getBaseVoxelFactors(state.dataset.dataSource.scale),
    activeViewport,
  );
  const viewportExtents = getPlaneExtentInVoxelFromStore(state, zoom, activeViewport);
  const scaledViewportExtents = V2.scale2(viewportExtents, baseVoxelFactors);
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'extent' implicitly has an 'any' type.
  const halfViewportExtents = scaledViewportExtents.map((extent) => Math.round(extent / 2));
  return halfViewportExtents;
}
