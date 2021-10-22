// @flow
import { calculateGlobalPos } from "oxalis/model/accessors/view_mode_accessor";
import _ from "lodash";
import { type OrthoView, type Point2, type Vector3 } from "oxalis/constants";
import Store from "oxalis/store";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import Dimension from "oxalis/model/dimensions";
import { setUserBoundingBoxBoundsAction } from "oxalis/model/actions/annotation_actions";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import getSceneController from "oxalis/controller/scene_controller_provider";

const BOUNDING_BOX_HOVERING_THROTTLE_TIME = 100;

const getNeighbourEdgeIndexByEdgeIndex = {
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
};
const MAX_DISTANCE_TO_SELECTION = 15;

function getDistanceToBoundingBoxEdge(
  pos: Vector3,
  min: Vector3,
  max: Vector3,
  compareToMin: boolean,
  edgeDim: number,
  otherDim: number,
  planeRatio: Vector3,
) {
  // There are three cases how the distance to an edge needs to be calculated.
  // Here are all cases visualized via numbers that are referenced below:
  // Note that this is the perspective of the rendered bounding box cross section in a viewport.
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
  // This example is for the xy viewport for y as the main direction / edgeDim.

  // As the planeRatio is multiplied to the global coordinates passed to this method,
  // the distance between the mouse and the bounding box is distorted by the factor of planeRatio.
  // That's why we later divide exactly by this factor to let the hit box / distance
  // between the mouse and bounding box be the same in each dimension.
  const cornerToCompareWith = compareToMin ? min : max;
  if (pos[edgeDim] < min[edgeDim]) {
    // Case 1: Distance to the min corner is needed in edgeDim.
    return (
      Math.sqrt(
        Math.abs(pos[edgeDim] - min[edgeDim]) ** 2 +
          Math.abs(pos[otherDim] - cornerToCompareWith[otherDim]) ** 2,
      ) / planeRatio[edgeDim]
    );
  }
  if (pos[edgeDim] > max[edgeDim]) {
    // Case 2: Distance to max Corner is needed in edgeDim.
    return (
      Math.sqrt(
        Math.abs(pos[edgeDim] - max[edgeDim]) ** 2 +
          Math.abs(pos[otherDim] - cornerToCompareWith[otherDim]) ** 2,
      ) / planeRatio[edgeDim]
    );
  }
  // Case 3:
  // If the position is within the bounds of the edgeDim, the shortest distance
  // to the edge is simply the difference between the otherDim values.
  return Math.abs(pos[otherDim] - cornerToCompareWith[otherDim]) / planeRatio[edgeDim];
}

export type SelectedEdge = {
  boxId: number,
  direction: "horizontal" | "vertical",
  isMaxEdge: boolean,
  edgeId: number,
  resizableDimension: 0 | 1 | 2,
};

export function getClosestHoveredBoundingBox(
  pos: Point2,
  plane: OrthoView,
): [SelectedEdge, ?SelectedEdge] | null {
  const state = Store.getState();
  const globalPosition = calculateGlobalPos(state, pos, plane);
  const { userBoundingBoxes } = getSomeTracing(state.tracing);
  const reorderedIndices = Dimension.getIndices(plane);
  const planeRatio = getBaseVoxelFactors(state.dataset.dataSource.scale);
  const thirdDim = reorderedIndices[2];

  const zoomedMaxDistanceToSelection = MAX_DISTANCE_TO_SELECTION * state.flycam.zoomStep;
  let currentNearestDistance = zoomedMaxDistanceToSelection;
  let currentNearestBoundingBox = null;
  let currentNearestDistanceArray = null;

  for (const bbox of userBoundingBoxes) {
    const { min, max } = bbox.boundingBox;
    const isCrossSectionOfViewportVisible =
      globalPosition[thirdDim] >= min[thirdDim] && globalPosition[thirdDim] < max[thirdDim];
    if (!isCrossSectionOfViewportVisible) {
      continue;
    }
    // In getNeighbourEdgeIndexByEdgeIndex is a visualization
    // of how the indices of the array map to the visible bbox edges.
    const distanceArray = [
      getDistanceToBoundingBoxEdge(
        globalPosition,
        min,
        max,
        true,
        reorderedIndices[0],
        reorderedIndices[1],
        planeRatio,
      ),
      getDistanceToBoundingBoxEdge(
        globalPosition,
        min,
        max,
        false,
        reorderedIndices[0],
        reorderedIndices[1],
        planeRatio,
      ),
      getDistanceToBoundingBoxEdge(
        globalPosition,
        min,
        max,
        true,
        reorderedIndices[1],
        reorderedIndices[0],
        planeRatio,
      ),
      getDistanceToBoundingBoxEdge(
        globalPosition,
        min,
        max,
        false,
        reorderedIndices[1],
        reorderedIndices[0],
        planeRatio,
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
  const nearestBoundingBox = currentNearestBoundingBox;
  const getEdgeInfoFromId = (edgeId: number) => {
    const direction = edgeId < 2 ? "horizontal" : "vertical";
    const isMaxEdge = edgeId % 2 === 1;
    const resizableDimension = edgeId < 2 ? reorderedIndices[1] : reorderedIndices[0];
    return {
      boxId: nearestBoundingBox.id,
      direction,
      isMaxEdge,
      edgeId,
      resizableDimension,
    };
  };
  const nearestEdgeIndex = currentNearestDistanceArray.indexOf(currentNearestDistance);
  const primaryEdge = getEdgeInfoFromId(nearestEdgeIndex);
  let secondaryEdge = null;
  const [firstNeighbourId, secondNeighbourId] = getNeighbourEdgeIndexByEdgeIndex[nearestEdgeIndex];
  const firstNeighbourEdgeDistance = currentNearestDistanceArray[firstNeighbourId];
  const secondNeighbourEdgeDistance = currentNearestDistanceArray[secondNeighbourId];
  if (
    firstNeighbourEdgeDistance < secondNeighbourEdgeDistance &&
    firstNeighbourEdgeDistance < zoomedMaxDistanceToSelection
  ) {
    secondaryEdge = getEdgeInfoFromId(firstNeighbourId);
  } else if (
    secondNeighbourEdgeDistance < firstNeighbourEdgeDistance &&
    secondNeighbourEdgeDistance < zoomedMaxDistanceToSelection
  ) {
    secondaryEdge = getEdgeInfoFromId(secondNeighbourId);
  }
  return [primaryEdge, secondaryEdge];
}

export const highlightAndSetCursorOnHoveredBoundingBox = _.throttle(
  (delta: Point2, position: Point2, planeId: OrthoView) => {
    const hoveredEdgesInfo = getClosestHoveredBoundingBox(position, planeId);
    const inputCatcher = document.getElementById(`inputcatcher_${planeId}`);
    if (hoveredEdgesInfo != null && inputCatcher != null) {
      const [primaryHoveredEdge, secondaryHoveredEdge] = hoveredEdgesInfo;
      getSceneController().highlightUserBoundingBox(primaryHoveredEdge.boxId);
      if (secondaryHoveredEdge != null) {
        // If a corner is selected.
        inputCatcher.style.cursor =
          (primaryHoveredEdge.isMaxEdge && secondaryHoveredEdge.isMaxEdge) ||
          (!primaryHoveredEdge.isMaxEdge && !secondaryHoveredEdge.isMaxEdge)
            ? "nwse-resize"
            : "nesw-resize";
      } else if (primaryHoveredEdge.direction === "horizontal") {
        inputCatcher.style.cursor = "row-resize";
      } else {
        inputCatcher.style.cursor = "col-resize";
      }
    } else {
      getSceneController().highlightUserBoundingBox(null);
      if (inputCatcher != null) {
        inputCatcher.style.cursor = "auto";
      }
    }
  },
  BOUNDING_BOX_HOVERING_THROTTLE_TIME,
);

export function handleResizingBoundingBox(
  mousePosition: Point2,
  planeId: OrthoView,
  primaryEdge: SelectedEdge,
  secondaryEdge: ?SelectedEdge,
): { primary: boolean, secondary: boolean } {
  const state = Store.getState();
  const globalMousePosition = calculateGlobalPos(state, mousePosition, planeId);
  const { userBoundingBoxes } = getSomeTracing(state.tracing);
  const didMinAndMaxSwitch = { primary: false, secondary: false };
  const bboxToResize = userBoundingBoxes.find(bbox => bbox.id === primaryEdge.boxId);
  if (!bboxToResize) {
    return didMinAndMaxSwitch;
  }
  const updatedBounds = {
    min: [...bboxToResize.boundingBox.min],
    max: [...bboxToResize.boundingBox.max],
  };
  function updateBoundsAccordingToEdge(edge: SelectedEdge): boolean {
    const { resizableDimension } = edge;
    // For a horizontal edge only consider delta.y, for vertical only delta.x
    const newPositionValue = Math.round(globalMousePosition[resizableDimension]);
    const minOrMax = edge.isMaxEdge ? "max" : "min";
    const oppositeOfMinOrMax = edge.isMaxEdge ? "min" : "max";
    const otherEdgeValue = bboxToResize.boundingBox[oppositeOfMinOrMax][resizableDimension];
    if (otherEdgeValue === newPositionValue) {
      // Do not allow the same value for min and max for one dimension.
      return false;
    }
    const areMinAndMaxEdgeCrossing =
      // If the min / max edge is moved over the other one.
      (edge.isMaxEdge && newPositionValue < otherEdgeValue) ||
      (!edge.isMaxEdge && newPositionValue > otherEdgeValue);
    if (areMinAndMaxEdgeCrossing) {
      // As the edge moved over the other one, the values for min and max must be switched.
      updatedBounds[minOrMax][resizableDimension] = otherEdgeValue;
      updatedBounds[oppositeOfMinOrMax][resizableDimension] = newPositionValue;
      return true;
    } else {
      updatedBounds[minOrMax][resizableDimension] = newPositionValue;
      return false;
    }
  }
  didMinAndMaxSwitch.primary = updateBoundsAccordingToEdge(primaryEdge);
  if (secondaryEdge) {
    didMinAndMaxSwitch.secondary = updateBoundsAccordingToEdge(secondaryEdge);
  }
  Store.dispatch(setUserBoundingBoxBoundsAction(primaryEdge.boxId, updatedBounds));
  return didMinAndMaxSwitch;
}
