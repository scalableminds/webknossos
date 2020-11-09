/**
 * dimensions.js
 * @flow
 */

import { type OrthoView, OrthoViews, type Vector3 } from "oxalis/constants";

export type DimensionIndices = 0 | 1 | 2;
export type DimensionMap = [DimensionIndices, DimensionIndices, DimensionIndices];

// This is a class with static methods dealing with dimensions and
// conversions between them.

const Dimensions = {
  getIndices(planeID: OrthoView): DimensionMap {
    // Returns a ordered 3-tuple [x, y, z] which represents the dimensions from the viewpoint
    switch (planeID) {
      case OrthoViews.PLANE_XY:
        return [0, 1, 2]; // of each plane. For example, moving along the
      case OrthoViews.PLANE_YZ:
        return [2, 1, 0]; // X-Axis of the YZ-Plane is equivalent to moving
      case OrthoViews.PLANE_XZ:
        return [0, 2, 1]; // along the Z axis in the cube -> ind[0]=2
      default:
        return [0, 0, 0];
    }
  },

  transDim(array: Vector3, planeID: OrthoView): Vector3 {
    // Translate Dimension: Helper method to translate arrays with three elements
    const ind = this.getIndices(planeID);
    return [array[ind[0]], array[ind[1]], array[ind[2]]];
  },

  transDimWithIndices(array: Vector3, indices: DimensionMap): Vector3 {
    return [array[indices[0]], array[indices[1]], array[indices[2]]];
  },

  planeForThirdDimension(dim: DimensionIndices): OrthoView {
    // Return the plane in which dim is always the same
    switch (dim) {
      case 2:
        return OrthoViews.PLANE_XY;
      case 0:
        return OrthoViews.PLANE_YZ;
      case 1:
        return OrthoViews.PLANE_XZ;
      default:
        throw new Error(`Unrecognized dimension: ${dim}`);
    }
  },

  thirdDimensionForPlane(planeID: OrthoView): DimensionIndices {
    // Opposite of planeForThirdDimension
    switch (planeID) {
      case OrthoViews.PLANE_XY:
        return 2;
      case OrthoViews.PLANE_YZ:
        return 0;
      case OrthoViews.PLANE_XZ:
        return 1;
      default:
        throw new Error(`Unrecognized plane ID: ${planeID}`);
    }
  },

  roundCoordinate(coordinate: Vector3): Vector3 {
    return [Math.floor(coordinate[0]), Math.floor(coordinate[1]), Math.floor(coordinate[2])];
  },

  distance(pos1: Array<number>, pos2: Array<number>): number {
    let sumOfSquares = 0;
    for (let i = 0; i < Math.min(pos1.length, pos2.length); i++) {
      const diff = pos1[i] - pos2[i];
      sumOfSquares += diff * diff;
    }
    return Math.sqrt(sumOfSquares);
  },
};

export default Dimensions;
