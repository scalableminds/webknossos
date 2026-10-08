import type { Vector3 } from "viewer/constants";
import { MIN_SCALE } from "./relative_slider";

export type AxisLocks = [boolean, boolean, boolean];

// Scaling is uniform by default, so that a layer keeps its proportions unless the user unlocks an axis.
export const DEFAULT_AXIS_LOCKS: AxisLocks = [true, true, true];

// Changes the scale magnitude of one axis to newMagnitude. If that axis is locked, all other locked
// axes are scaled by the same factor, so that the proportions between the locked axes are kept
// (e.g. [1, 2, 4] becomes [2, 4, 8] when the first axis is set to 2).
//
// The factor is taken relative to referenceMagnitudes. While a slider is dragged, these should be
// the magnitudes from when the drag started, so that the rounding of the many intermediate updates
// cannot accumulate and slowly change the proportions.
//
// Derived values keep four significant digits. Axes that had the same
// magnitude as the changed axis get exactly newMagnitude, so that uniform scalings stay uniform.
export function applyLockedScaleChange(
  referenceMagnitudes: Vector3,
  locks: AxisLocks,
  axis: 0 | 1 | 2,
  newMagnitude: number,
): Vector3 {
  const result: Vector3 = [...referenceMagnitudes];
  result[axis] = newMagnitude;
  if (!locks[axis]) {
    return result;
  }
  const referenceMagnitude = referenceMagnitudes[axis];
  for (let other = 0; other < 3; other++) {
    if (other === axis || !locks[other]) continue;
    if (referenceMagnitudes[other] === referenceMagnitude || referenceMagnitude <= 0) {
      // Without a usable reference there are no proportions to keep, so the locked axes are set to
      // the same value.
      result[other] = newMagnitude;
    } else {
      const scaled = (referenceMagnitudes[other] * newMagnitude) / referenceMagnitude;
      result[other] = Math.max(MIN_SCALE, Number(scaled.toPrecision(4)));
    }
  }
  return result;
}
