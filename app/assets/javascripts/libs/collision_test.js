// @flow
import { V2 } from "libs/mjs";

type Vector3 = [number, number, number];
type Shape = {
  normals: Vector3[],
  corners: Vector3[],
};

function SATtest(axis: Vector3, ptSet: Vector3[]): [number, number] {
  let minAlong = 2 ** 24;
  let maxAlong = -(2 ** 24);
  for (const point of ptSet) {
    // just dot the point to get the min/max along this axis.
    const dotVal = V2.dot(point, axis);
    if (dotVal < minAlong) minAlong = dotVal;
    if (dotVal > maxAlong) maxAlong = dotVal;
  }

  return [minAlong, maxAlong];
}

// Shape1 and Shape2 must be CONVEX HULLS
export function intersects(shape1: Shape, shape2: Shape): boolean {
  // Get the normals for one of the shapes,
  for (const normal of shape1.normals.concat(shape2.normals)) {
    const [shape1Min, shape1Max] = SATtest(normal, shape1.corners);
    const [shape2Min, shape2Max] = SATtest(normal, shape2.corners);
    if (!overlaps(shape1Min, shape1Max, shape2Min, shape2Max)) {
      return false; // NO INTERSECTION
    }
  }
  return true;
}

function overlaps(min1: number, max1: number, min2: number, max2: number): boolean {
  return isBetweenOrdered(min2, min1, max1) || isBetweenOrdered(min1, min2, max2);
}

function isBetweenOrdered(val: number, lowerBound: number, upperBound: number): boolean {
  return lowerBound <= val && val <= upperBound;
}
