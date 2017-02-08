/**
 * dimensions.js
 * @flow weak
 */

import Utils from "libs/utils";
import constants from "../constants";

// This is a class with static methods dealing with dimensions and
// conversions between them.

const Dimensions = {

  PLANE_XY: constants.PLANE_XY,
  PLANE_YZ: constants.PLANE_YZ,
  PLANE_XZ: constants.PLANE_XZ,
  TDView: constants.TDView,

  getIndices(planeID) {
    // Returns a ordered 3-tuple [x, y, z] which represents the dimensions from the viewpoint

    switch (planeID) {
      case constants.PLANE_XY: return [0, 1, 2];  // of each plane. For example, moving along the
      case constants.PLANE_YZ: return [2, 1, 0];  // X-Axis of the YZ-Plane is equivalent to moving
      case constants.PLANE_XZ: return [0, 2, 1];  // along the Z axis in the cube -> ind[0]=2
      default: return null;
    }
  },


  transDim(array, planeID) {
    // Translate Dimension: Helper method to translate arrays with three elements

    const ind = this.getIndices(planeID);
    return [array[ind[0]], array[ind[1]], array[ind[2]]];
  },


  planeForThirdDimension(dim) {
    // Return the plane in which dim is always the same

    switch (dim) {
      case 2: return this.PLANE_XY;
      case 0: return this.PLANE_YZ;
      case 1: return this.PLANE_XZ;
      default: throw new Error(`Unrecognized dimension: ${dim}`);
    }
  },


  thirdDimensionForPlane(planeID) {
    // Opposite of planeForThirdDimension

    switch (planeID) {
      case this.PLANE_XY: return 2;
      case this.PLANE_YZ: return 0;
      case this.PLANE_XZ: return 1;
      default: throw new Error(`Unrecognized plane ID: ${planeID}`);
    }
  },


  round(number) {
    // Floor number, as done at texture rendering

    return ~~number;
  },


  roundCoordinate(coordinate) {
    const res = coordinate.slice();
    for (const i of Utils.__range__(0, res.length, false)) {
      res[i] = this.round(res[i]);
    }
    return res;
  },


  distance(pos1, pos2) {
    let sumOfSquares = 0;
    for (const i of Utils.__range__(0, pos1.length, false)) {
      const diff = pos1[i] - pos2[i];
      sumOfSquares += diff * diff;
    }
    return Math.sqrt(sumOfSquares);
  },
};

export default Dimensions;
