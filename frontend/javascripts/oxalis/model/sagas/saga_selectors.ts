import type { OxalisState } from "oxalis/store";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { V2 } from "libs/mjs";
import type { Vector2, OrthoView } from "oxalis/constants";
import { getBaseVoxelFactorsInUnit } from "oxalis/model/scaleinfo";
import { getPlaneExtentInVoxelFromStore } from "oxalis/model/accessors/view_mode_accessor";
import Dimensions from "oxalis/model/dimensions";

export function* getHalfViewportExtentsInVx(activeViewport: OrthoView): Saga<Vector2> {
  const zoom = yield* select((state) => state.flycam.zoomStep);
  const baseVoxelFactors = yield* select((state) =>
    Dimensions.transDim(getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale), activeViewport),
  );
  const viewportExtents = yield* select((state) =>
    getPlaneExtentInVoxelFromStore(state, zoom, activeViewport),
  );
  const baseVoxelFactorsXY = [baseVoxelFactors[0], baseVoxelFactors[1]] as Vector2;
  const scaledViewportExtents = V2.scale2(viewportExtents, baseVoxelFactorsXY);
  const halfViewportExtents = scaledViewportExtents.map((extent) =>
    Math.round(extent / 2),
  ) as Vector2;
  return halfViewportExtents;
}

export function getHalfViewportExtentsInUnitFromState(
  state: OxalisState,
  activeViewport: OrthoView,
): Vector2 {
  const zoom = state.flycam.zoomStep;
  const baseVoxelFactors = Dimensions.transDim(
    getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale),
    activeViewport,
  );
  const viewportExtents = getPlaneExtentInVoxelFromStore(state, zoom, activeViewport);
  const baseVoxelFactorsXY = [baseVoxelFactors[0], baseVoxelFactors[1]] as Vector2;
  const scaledViewportExtents = V2.scale2(viewportExtents, baseVoxelFactorsXY);
  const halfViewportExtents = scaledViewportExtents.map((extent) =>
    Math.round(extent / 2),
  ) as Vector2;
  return halfViewportExtents;
}
