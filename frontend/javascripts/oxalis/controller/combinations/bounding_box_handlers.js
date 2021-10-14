// @flow
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import { type OrthoView, type Point2, type Vector3 } from "oxalis/constants";
import Store from "oxalis/store";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import Dimension from "oxalis/model/dimensions";

/* const neighbourEdgeIndexByEdgeIndex = {
  // TODO: Use this to detect corners properly.
  // The edges are indexed within the plane like this:
  // See the distanceArray calculation as a reference.
  //  +---0---+
  //  |       |
  //  2       3
  //  |       |
  //  +---1---+
  //
  "0": [2, 3],
  "1": [2, 3],
  "2": [0, 1],
  "3": [0, 1],
}; */
const MAX_DISTANCE_TO_SELECTION = 15;

function getDistanceToBoundingBoxEdge(
  pos: Vector3,
  min: Vector3,
  max: Vector3,
  compareToMin: boolean,
  edgeDim: number,
  otherDim: number,
) {
  // There are four cases how the distance to an edge needs to be calculated.
  // Here are all cases visualized via a number that are referenced below:
  // Note that this is the perspective of the rendered bounding box cross section.
  // ---> x
  // |  1                  1
  // ↓    '.             .'
  // y      ↘          ↙
  //          +-------+
  //          |       |
  //    3 --> |       | <-- 3
  //          |       |
  //          +-------+
  //        ↗           ↖
  //      .'             '.
  //     2                 2
  //
  // This example is for the xy viewport for x as the main direction / edgeDim.
  const cornerToCompareWith = compareToMin ? min : max;
  if (pos[edgeDim] < min[edgeDim]) {
    // Case 1: Distance to the min corner is needed in edgeDim.
    return Math.sqrt(
      Math.abs(pos[edgeDim] - min[edgeDim]) ** 2 +
        Math.abs(pos[otherDim] - cornerToCompareWith[otherDim]) ** 2,
    );
  }
  if (pos[edgeDim] > max[edgeDim]) {
    // Case 2: Distance to max Corner is needed in edgeDim.
    return Math.sqrt(
      Math.abs(pos[edgeDim] - max[edgeDim]) ** 2 +
        Math.abs(pos[otherDim] - cornerToCompareWith[otherDim]) ** 2,
    );
  }
  // Case 3:
  // If the position is within the bounds of the edgeDim, the shortest distance
  // to the edge is simply the difference between the otherDim values.
  return Math.abs(pos[otherDim] - cornerToCompareWith[otherDim]);
}

export default function getClosestHoveredBoundingBox(pos: Point2, plane: OrthoView) {
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, pos, plane);
  const { userBoundingBoxes } = getSomeTracing(state.tracing);
  const reorderedIndices = Dimension.getIndices(plane);
  const thirdDim = reorderedIndices[2];

  let currentNearestDistance = MAX_DISTANCE_TO_SELECTION * state.flycam.zoomStep;
  let currentNearestBoundingBox = null;
  let currentNearestDistanceArray = null;

  for (const bbox of userBoundingBoxes) {
    const { min, max } = bbox.boundingBox;
    const isCrossSectionOfViewportVisible =
      globalPosition[thirdDim] >= min[thirdDim] && globalPosition[thirdDim] < max[thirdDim];
    if (!isCrossSectionOfViewportVisible) {
      continue;
    }
    const distanceArray = [
      getDistanceToBoundingBoxEdge(
        globalPosition,
        min,
        max,
        true,
        reorderedIndices[0],
        reorderedIndices[1],
      ),
      getDistanceToBoundingBoxEdge(
        globalPosition,
        min,
        max,
        false,
        reorderedIndices[0],
        reorderedIndices[1],
      ),
      getDistanceToBoundingBoxEdge(
        globalPosition,
        min,
        max,
        true,
        reorderedIndices[1],
        reorderedIndices[0],
      ),
      getDistanceToBoundingBoxEdge(
        globalPosition,
        min,
        max,
        false,
        reorderedIndices[1],
        reorderedIndices[0],
      ),
    ];
    const minimumDistance = Math.min(...distanceArray);
    if (minimumDistance < currentNearestDistance) {
      currentNearestDistance = minimumDistance;
      currentNearestBoundingBox = bbox;
      currentNearestDistanceArray = distanceArray;
    }
  }
  if (currentNearestBoundingBox == null || currentNearestDistanceArray == null) {
    return null;
  }
  const nearestEdgeIndex = currentNearestDistanceArray.indexOf(currentNearestDistance);
  const dimensionOfNearestEdge = nearestEdgeIndex < 2 ? reorderedIndices[0] : reorderedIndices[1];
  const direction = nearestEdgeIndex < 2 ? "horizontal" : "vertical";
  const isMaxEdge = nearestEdgeIndex % 2 === 1;
  const resizableDimension = nearestEdgeIndex < 2 ? reorderedIndices[1] : reorderedIndices[0];
  // TODO: Add feature to select corners.
  return {
    boxId: currentNearestBoundingBox.id,
    dimensionIndex: dimensionOfNearestEdge,
    direction,
    isMaxEdge,
    nearestEdgeIndex,
    resizableDimension,
  };
}
