import { V3 } from "libs/mjs";
import { document } from "libs/window";
import _ from "lodash";
import type { BoundingBoxType, OrthoView, Point2, Vector2, Vector3 } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getSomeTracing } from "viewer/model/accessors/tracing_accessor";
import {
  calculateGlobalDelta,
  calculateGlobalPos,
  calculateMaybeGlobalPos,
} from "viewer/model/accessors/view_mode_accessor";
import {
  addUserBoundingBoxAction,
  changeUserBoundingBoxAction,
} from "viewer/model/actions/annotation_actions";
import type { DimensionIndices, DimensionMap } from "viewer/model/dimensions";
import Dimension from "viewer/model/dimensions";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";
import Store, { type WebknossosState, type UserBoundingBox } from "viewer/store";

const BOUNDING_BOX_HOVERING_THROTTLE_TIME = 100;
const getNeighbourEdgeIndexByEdgeIndex: { [key: number]: Vector2 } = {
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
// This value is in "mouse tolerance to trigger a selection". It is in "unzoomed worldcoordinates".
const MAX_DISTANCE_TO_SELECTION = 15;

function getDistanceToBoundingBoxEdge(
  pos: Vector3,
  min: Vector3,
  max: Vector3,
  compareToMin: boolean,
  primaryAndSecondaryDim: [DimensionIndices, DimensionIndices],
  planeRatio: Vector3,
) {
  // This method calculates the distance between the given pos and a single edge of a cross section
  // of bounding box given min and max that is displayed in a certain viewport.
  // The edge dimension that the edge extents along is given by the first entry of primaryAndSecondaryDim.
  // Namely, 0 -> x direction (i.e., horizontal), 1 -> y direction and 2 -> z direction.
  // The second entry of primaryAndSecondaryDim gives the other extent of the viewport / cross section.
  // The boolean compareToMin tells which of the two edges in the primary direction should be compared with.
  // To calculate the distance there are three cases depending on the primary dimension value of pos.
  // - One when the given pos is on the left of the minimum of the edge (case 1),
  // - one if pos is on the right of the maximum of the edge (case 2)
  // - and the last if pos is inbeween the minimum and maximum of the edge (case 3).
  // If the cross section is on the xy viewport and the edge to compare to is the min edge in x direction
  // an example for the different cases is: compareToMin = true, primaryAndSecondaryDim = [0,1] = [x,y]
  // ---> x
  // |       min.x                                                   max.x
  // ↓ y       ↓                                                      ↓
  //           ↓                                                      ↓
  // case 1    ↓           case 3                  case 3             ↓   case 2
  //       '.                |                       |                   .'
  //         '↘              ↓                       ↓                 ↙'
  //           --------------------------------------------------------
  //           |                                                      |
  //           |  edge extends along x direction -> primary dim = x   |
  //           |                                                      |
  // As the planeRatio is multiplied to the global coordinates passed to this method,
  // the distance between the mouse and the bounding box is distorted by the factor of planeRatio.
  // That's why we later divide exactly by this factor to let the hit box / distance
  // between the mouse and bounding box be the same in each dimension.
  const [primaryEdgeDim, secondaryEdgeDim] = primaryAndSecondaryDim;
  const cornerToCompareWith = compareToMin ? min : max;

  const toScreenSpace = (value: number, dimension: DimensionIndices) =>
    value / planeRatio[dimension];

  if (pos[primaryEdgeDim] < min[primaryEdgeDim]) {
    // Case 1: Distance to the min corner is needed in primaryEdgeDim.
    return Math.hypot(
      toScreenSpace(pos[primaryEdgeDim] - min[primaryEdgeDim], primaryEdgeDim),
      toScreenSpace(
        pos[secondaryEdgeDim] - cornerToCompareWith[secondaryEdgeDim],
        secondaryEdgeDim,
      ),
    );
  }

  if (pos[primaryEdgeDim] > max[primaryEdgeDim]) {
    // Case 2: Distance to max Corner is needed in primaryEdgeDim.
    return Math.hypot(
      toScreenSpace(pos[primaryEdgeDim] - max[primaryEdgeDim], primaryEdgeDim),
      toScreenSpace(
        pos[secondaryEdgeDim] - cornerToCompareWith[secondaryEdgeDim],
        secondaryEdgeDim,
      ),
    );
  }

  // Case 3:
  return Math.abs(
    toScreenSpace(pos[secondaryEdgeDim] - cornerToCompareWith[secondaryEdgeDim], secondaryEdgeDim),
  );
}

export type SelectedEdge = {
  boxId: number;
  direction: "horizontal" | "vertical";
  isMaxEdge: boolean;
  edgeId: number;
  resizableDimension: 0 | 1 | 2;
};
type DistanceArray = [number, number, number, number];

function computeDistanceArray(
  boundingBoxBounds: BoundingBoxType,
  globalPosition: Vector3,
  indices: DimensionMap,
  planeRatio: Vector3,
): DistanceArray {
  const { min, max } = boundingBoxBounds;
  const distanceArray = [0, 1, 2, 3].map((edgeId) => {
    const direction = edgeId < 2 ? "horizontal" : "vertical";
    const isMaxEdge = edgeId % 2 === 1;
    const primaryAndSecondaryDim =
      direction === "horizontal" ? [indices[0], indices[1]] : [indices[1], indices[0]];
    return getDistanceToBoundingBoxEdge(
      globalPosition,
      min,
      max,
      !isMaxEdge,
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'DimensionIndices[]' is not assig... Remove this comment to see the full error message
      primaryAndSecondaryDim,
      planeRatio,
    );
  });
  return distanceArray as any as DistanceArray;
}

const _getEdgeInfoFromId = (boxId: number, indices: DimensionMap, edgeId: number): SelectedEdge => {
  const direction: SelectedEdge["direction"] = edgeId < 2 ? "horizontal" : "vertical";
  const isMaxEdge = edgeId % 2 === 1;
  const resizableDimension = direction === "horizontal" ? indices[1] : indices[0];
  return {
    boxId,
    direction,
    isMaxEdge,
    edgeId,
    resizableDimension,
  };
};

// Return the edge or edges of the bounding box closest to the mouse position if their distance is below a certain threshold.
// If no edge is close to the mouse null is returned instead. Otherwise the first entry is always the closest edge.
// If the mouse is near a corner, there is always an additional edge that is close to the mouse.
// If such an edge exists then this edge is the second entry of the array.
// If the mouse isn't close to a corner of a crossection, the second entry is null.
export function getClosestHoveredBoundingBox(
  pos: Point2,
  plane: OrthoView,
): [SelectedEdge, SelectedEdge | null | undefined] | null {
  const state = Store.getState();
  const globalPosition = calculateMaybeGlobalPos(state, pos, plane);

  if (globalPosition == null) return null;

  const { userBoundingBoxes } = getSomeTracing(state.annotation);
  const indices = Dimension.getIndices(plane);
  const planeRatio = getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale);
  const thirdDim = indices[2];
  const zoomedMaxDistanceToSelection = MAX_DISTANCE_TO_SELECTION * state.flycam.zoomStep;
  let currentNearestDistance = zoomedMaxDistanceToSelection;
  let currentNearestBoundingBox = null;
  let currentNearestDistanceArray = null;

  for (const bbox of userBoundingBoxes) {
    const { min, max } = bbox.boundingBox;
    const isCrossSectionOfViewportVisible =
      globalPosition[thirdDim] >= min[thirdDim] && globalPosition[thirdDim] < max[thirdDim];

    if (!isCrossSectionOfViewportVisible || !bbox.isVisible) {
      continue;
    }

    // In getNeighbourEdgeIndexByEdgeIndex is a visualization
    // of how the indices of the array map to the visible bbox edges.
    const distanceArray = computeDistanceArray(
      bbox.boundingBox,
      globalPosition,
      indices,
      planeRatio,
    );
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

  const nearestEdgeIndex = currentNearestDistanceArray.indexOf(currentNearestDistance);
  const primaryEdge = _getEdgeInfoFromId(nearestBoundingBox.id, indices, nearestEdgeIndex);
  let secondaryEdge = null;
  const [firstNeighbourId, secondNeighbourId] = getNeighbourEdgeIndexByEdgeIndex[nearestEdgeIndex];
  const firstNeighbourEdgeDistance = currentNearestDistanceArray[firstNeighbourId];
  const secondNeighbourEdgeDistance = currentNearestDistanceArray[secondNeighbourId];

  if (
    firstNeighbourEdgeDistance < secondNeighbourEdgeDistance &&
    firstNeighbourEdgeDistance < zoomedMaxDistanceToSelection
  ) {
    secondaryEdge = _getEdgeInfoFromId(nearestBoundingBox.id, indices, firstNeighbourId);
  } else if (
    secondNeighbourEdgeDistance < firstNeighbourEdgeDistance &&
    secondNeighbourEdgeDistance < zoomedMaxDistanceToSelection
  ) {
    secondaryEdge = _getEdgeInfoFromId(nearestBoundingBox.id, indices, secondNeighbourId);
  }

  return [primaryEdge, secondaryEdge];
}

export function createBoundingBoxAndGetEdges(
  pos: Point2,
  plane: OrthoView,
): [SelectedEdge, SelectedEdge | null | undefined] | null {
  const state = Store.getState();
  const globalPosition = calculateMaybeGlobalPos(state, pos, plane);

  if (globalPosition == null) return null;

  Store.dispatch(
    addUserBoundingBoxAction({
      boundingBox: {
        min: globalPosition,
        // The last argument ensures that a Vector3 is used and not a
        // Float32Array.
        max: V3.add(globalPosition, [1, 1, 1], [0, 0, 0]),
      },
    }),
  );
  const { userBoundingBoxes } = getSomeTracing(Store.getState().annotation);

  const indices = Dimension.getIndices(plane);
  const newestBoundingBox =
    userBoundingBoxes.length > 0 ? userBoundingBoxes[userBoundingBoxes.length - 1] : null;

  if (newestBoundingBox == null) {
    return null;
  }

  const nearestBoundingBox = newestBoundingBox;

  const primaryEdge = _getEdgeInfoFromId(nearestBoundingBox.id, indices, 1);
  const secondaryEdge = _getEdgeInfoFromId(nearestBoundingBox.id, indices, 3);

  return [primaryEdge, secondaryEdge];
}

export const highlightAndSetCursorOnHoveredBoundingBox = _.throttle(
  (position: Point2, planeId: OrthoView, event: MouseEvent | KeyboardEvent) => {
    const hoveredEdgesInfo = getClosestHoveredBoundingBox(position, planeId);
    // Access the parent element as that is where the cursor style property is set
    const inputCatcher = document.getElementById(`inputcatcher_${planeId}`)?.parentElement;

    if (hoveredEdgesInfo != null && inputCatcher != null) {
      const [primaryHoveredEdge, secondaryHoveredEdge] = hoveredEdgesInfo;
      getSceneController().highlightUserBoundingBox(primaryHoveredEdge.boxId);
      if (event.ctrlKey || event.metaKey) {
        inputCatcher.style.cursor = "move";
      } else if (secondaryHoveredEdge != null) {
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
        inputCatcher.style.cursor = "copy";
      }
    }
  },
  BOUNDING_BOX_HOVERING_THROTTLE_TIME,
);

function getBoundingBoxOfPrimaryEdge(
  primaryEdge: SelectedEdge,
  state: WebknossosState,
): UserBoundingBox | undefined {
  const { userBoundingBoxes } = getSomeTracing(state.annotation);
  return userBoundingBoxes.find((bbox) => bbox.id === primaryEdge.boxId);
}

export function handleResizingBoundingBox(
  mousePosition: Point2,
  planeId: OrthoView,
  primaryEdge: SelectedEdge,
  secondaryEdge: SelectedEdge | null | undefined,
) {
  const state = Store.getState();
  const globalMousePosition = calculateGlobalPos(state, mousePosition, planeId);
  const bboxToResize = getBoundingBoxOfPrimaryEdge(primaryEdge, state);

  if (!bboxToResize) {
    return;
  }

  const updatedBounds = {
    min: [...bboxToResize.boundingBox.min] as Vector3,
    max: [...bboxToResize.boundingBox.max] as Vector3,
  };

  function updateBoundsAccordingToEdge(edge: SelectedEdge): boolean {
    const { resizableDimension } = edge;
    // For a horizontal edge only consider delta.y, for vertical only delta.x
    const newPositionValue = Math.round(globalMousePosition[resizableDimension]);
    const minOrMax = edge.isMaxEdge ? "max" : "min";
    const oppositeOfMinOrMax = edge.isMaxEdge ? "min" : "max";
    // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
    const otherEdgeValue = bboxToResize.boundingBox[oppositeOfMinOrMax][resizableDimension];

    if (otherEdgeValue === newPositionValue) {
      // Do not allow the same value for min and max for one dimension.
      return false;
    }

    const areMinAndMaxEdgeCrossing = // If the min / max edge is moved over the other one.
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

  let didMinAndMaxEdgeSwitch = updateBoundsAccordingToEdge(primaryEdge);

  if (didMinAndMaxEdgeSwitch) {
    primaryEdge.isMaxEdge = !primaryEdge.isMaxEdge;
  }

  if (secondaryEdge) {
    didMinAndMaxEdgeSwitch = updateBoundsAccordingToEdge(secondaryEdge);

    if (didMinAndMaxEdgeSwitch) {
      secondaryEdge.isMaxEdge = !secondaryEdge.isMaxEdge;
    }
  }

  Store.dispatch(
    changeUserBoundingBoxAction(primaryEdge.boxId, {
      boundingBox: updatedBounds,
    }),
  );
}

export function handleMovingBoundingBox(
  delta: Point2,
  planeId: OrthoView,
  primaryEdge: SelectedEdge,
) {
  const state = Store.getState();
  const globalDelta = calculateGlobalDelta(state, delta, planeId);
  const bboxToResize = getBoundingBoxOfPrimaryEdge(primaryEdge, state);

  if (!bboxToResize) {
    return;
  }

  const updatedBounds = {
    min: V3.toArray(V3.add(bboxToResize.boundingBox.min, globalDelta)),
    max: V3.toArray(V3.add(bboxToResize.boundingBox.max, globalDelta)),
  };

  Store.dispatch(
    changeUserBoundingBoxAction(primaryEdge.boxId, {
      boundingBox: updatedBounds,
    }),
  );
}
