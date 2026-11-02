import { handleGenericError } from "libs/error_handling";
import { V3 } from "libs/mjs";
import { document } from "libs/window";
import throttle from "lodash-es/throttle";
import type { BoundingBoxMinMaxType } from "types/bounding_box";
import type { OrthoView, Point2, Vector2, Vector3 } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getIsRebasingOrForwarding } from "viewer/model/accessors/annotation_accessor";
import { getSomeTracing } from "viewer/model/accessors/tracing_accessor";
import {
  calculateGlobalDelta,
  calculateGlobalPos,
  calculateMaybeGlobalPos,
} from "viewer/model/accessors/view_mode_accessor";
import { dispatchGetNewIdAsync } from "viewer/model/actions/actions";
import {
  addUserBoundingBoxAction,
  changeUserBoundingBoxAction,
} from "viewer/model/actions/annotation_actions";
import type { DimensionIndices, DimensionMap } from "viewer/model/dimensions";
import Dimension from "viewer/model/dimensions";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";
import Store, { type UserBoundingBox, type WebknossosState } from "viewer/store";

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
// If the min and max edge of a box's thinnest dimension are at most this many screen pixels apart,
// they look like a single line (e.g., the depth of a box that was drawn in a single slice). The user
// cannot tell which of the two they grabbed, so such an edge is anchored (see SelectedEdge.anchoredExtent).
const MAX_SCREEN_GAP_OF_OVERLAPPING_EDGES = 5;

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
  // Set if this edge and its opposite edge overlap on screen, so the user cannot tell which of the
  // two they grabbed. It holds the [min, max] of resizableDimension when the edge was grabbed.
  // While dragging, the box then spans this extent plus the mouse position, so it always keeps
  // the slices it contained, no matter where the drag started or in which direction it goes.
  anchoredExtent?: Vector2;
};
type DistanceArray = [number, number, number, number];

function computeDistanceArray(
  boundingBoxBounds: BoundingBoxMinMaxType,
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
  if (globalPosition == null || globalPosition.rounded == null) return null;
  const roundedPosition = globalPosition.rounded;

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
      roundedPosition[thirdDim] >= min[thirdDim] && roundedPosition[thirdDim] < max[thirdDim];

    if (!isCrossSectionOfViewportVisible || !bbox.isVisible) {
      continue;
    }

    // In getNeighbourEdgeIndexByEdgeIndex is a visualization
    // of how the indices of the array map to the visible bbox edges.
    const distanceArray = computeDistanceArray(
      bbox.boundingBox,
      globalPosition.rounded,
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
  const getEdgeInfo = (edgeId: number): SelectedEdge => {
    const edge = _getEdgeInfoFromId(nearestBoundingBox.id, indices, edgeId);
    const { min, max } = nearestBoundingBox.boundingBox;
    const dim = edge.resizableDimension;
    if (
      isThinDimensionOverlappingOnScreen(
        nearestBoundingBox.boundingBox,
        dim,
        planeRatio,
        state.flycam.zoomStep,
      )
    ) {
      edge.anchoredExtent = [min[dim], max[dim]];
    }
    return edge;
  };

  const nearestEdgeIndex = currentNearestDistanceArray.indexOf(currentNearestDistance);
  const primaryEdge = getEdgeInfo(nearestEdgeIndex);
  let secondaryEdge = null;
  const [firstNeighbourId, secondNeighbourId] = getNeighbourEdgeIndexByEdgeIndex[nearestEdgeIndex];
  const firstNeighbourEdgeDistance = currentNearestDistanceArray[firstNeighbourId];
  const secondNeighbourEdgeDistance = currentNearestDistanceArray[secondNeighbourId];

  if (
    firstNeighbourEdgeDistance < secondNeighbourEdgeDistance &&
    firstNeighbourEdgeDistance < zoomedMaxDistanceToSelection
  ) {
    secondaryEdge = getEdgeInfo(firstNeighbourId);
  } else if (
    secondNeighbourEdgeDistance < firstNeighbourEdgeDistance &&
    secondNeighbourEdgeDistance < zoomedMaxDistanceToSelection
  ) {
    secondaryEdge = getEdgeInfo(secondNeighbourId);
  }

  return [primaryEdge, secondaryEdge];
}

export async function createBoundingBoxAndGetEdges(
  pos: Point2,
  plane: OrthoView,
): Promise<[SelectedEdge, SelectedEdge | null | undefined] | null> {
  const state = Store.getState();
  // A drag-created box cannot be meaningfully deferred, so we simply don't start one while a
  // rebase/forwarding is active (the add would be dropped by the rebase edit guard anyway).
  if (getIsRebasingOrForwarding(state)) return null;
  const globalPosition = calculateMaybeGlobalPos(state, pos, plane);
  if (globalPosition == null || globalPosition.rounded == null) return null;

  const tracingId = getSomeTracing(state.annotation).tracingId;
  let id: number;
  try {
    id = await dispatchGetNewIdAsync(Store.dispatch, tracingId, "BoundingBox");
  } catch (error) {
    handleGenericError(error as Error, "Could not create a new bounding box.");
    return null;
  }

  Store.dispatch(
    addUserBoundingBoxAction(
      {
        boundingBox: {
          min: globalPosition.rounded,
          // The last argument ensures that a Vector3 is used and not a
          // Float32Array.
          max: V3.add(globalPosition.rounded, [1, 1, 1], [0, 0, 0]),
        },
      },
      undefined,
      id,
    ),
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

export const highlightAndSetCursorOnHoveredBoundingBox = throttle(
  (position: Point2, planeId: OrthoView, event: MouseEvent | KeyboardEvent) => {
    const hoveredEdgesInfo = getClosestHoveredBoundingBox(position, planeId);
    // Access the parent element as that is where the cursor style property is set
    const inputCatcher = document.getElementById(`inputcatcher_${planeId}`)?.parentElement;

    if (hoveredEdgesInfo != null && inputCatcher != null) {
      const [primaryHoveredEdge, secondaryHoveredEdge] = hoveredEdgesInfo;
      getSceneController().highlightUserBoundingBox(primaryHoveredEdge.boxId);
      if (event.ctrlKey || event.metaKey) {
        inputCatcher.style.cursor = "move";
      } else if (
        secondaryHoveredEdge != null &&
        primaryHoveredEdge.anchoredExtent == null &&
        secondaryHoveredEdge.anchoredExtent == null
      ) {
        // If a corner is selected. For an anchored edge, it is unknown in which direction it will
        // grow, so the diagonal is unknown, too. The fallback below shows a two-sided cursor.
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

// Returns whether the min and max edge of the given dimension are so close on screen that they
// look like a single line. Only the box's thinnest dimension is considered (e.g., the depth of a box
// that was drawn in a single slice), so that resizing ordinary boxes while zoomed out is unaffected.
export function isThinDimensionOverlappingOnScreen(
  boundingBox: BoundingBoxMinMaxType,
  dimension: DimensionIndices,
  planeRatio: Vector3,
  zoomStep: number,
): boolean {
  const extents = V3.sub(boundingBox.max, boundingBox.min);
  if (extents.some((extent) => extent < extents[dimension])) {
    return false;
  }
  const extentInScreenPixels = extents[dimension] / planeRatio[dimension] / zoomStep;
  return extentInScreenPixels <= MAX_SCREEN_GAP_OF_OVERLAPPING_EDGES;
}

// Returns the bounds after moving the given edge to newPositionValue (along its resizableDimension).
// If the edge is moved over its opposite edge, min and max are switched and edge.isMaxEdge is
// flipped, so that the edge keeps following the mouse.
export function getBoundsResizedAlongEdge(
  bounds: BoundingBoxMinMaxType,
  edge: SelectedEdge,
  newPositionValue: number,
): BoundingBoxMinMaxType {
  const { resizableDimension } = edge;
  const min = [...bounds.min] as Vector3;
  const max = [...bounds.max] as Vector3;

  if (edge.anchoredExtent != null) {
    const [anchoredMin, anchoredMax] = edge.anchoredExtent;
    min[resizableDimension] = Math.min(anchoredMin, newPositionValue);
    max[resizableDimension] = Math.max(anchoredMax, newPositionValue);
    return { min, max };
  }

  const minOrMax = edge.isMaxEdge ? "max" : "min";
  const oppositeOfMinOrMax = edge.isMaxEdge ? "min" : "max";
  const otherEdgeValue = bounds[oppositeOfMinOrMax][resizableDimension];

  if (otherEdgeValue === newPositionValue) {
    // Do not allow the same value for min and max for one dimension.
    return bounds;
  }

  const updatedBounds = { min, max };
  const areMinAndMaxEdgeCrossing = // If the min / max edge is moved over the other one.
    (edge.isMaxEdge && newPositionValue < otherEdgeValue) ||
    (!edge.isMaxEdge && newPositionValue > otherEdgeValue);

  if (areMinAndMaxEdgeCrossing) {
    // As the edge moved over the other one, the values for min and max must be switched.
    updatedBounds[minOrMax][resizableDimension] = otherEdgeValue;
    updatedBounds[oppositeOfMinOrMax][resizableDimension] = newPositionValue;
    edge.isMaxEdge = !edge.isMaxEdge;
  } else {
    updatedBounds[minOrMax][resizableDimension] = newPositionValue;
  }
  return updatedBounds;
}

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
  const globalMousePosition = calculateGlobalPos(state, mousePosition, planeId, true);
  const bboxToResize = getBoundingBoxOfPrimaryEdge(primaryEdge, state);

  if (!bboxToResize || globalMousePosition == null || globalMousePosition.rounded == null) {
    return;
  }

  const globalPositionRounded = globalMousePosition.rounded;
  const currentBounds = bboxToResize.boundingBox;
  let updatedBounds = getBoundsResizedAlongEdge(
    currentBounds,
    primaryEdge,
    Math.round(globalPositionRounded[primaryEdge.resizableDimension]),
  );
  if (secondaryEdge) {
    updatedBounds = getBoundsResizedAlongEdge(
      updatedBounds,
      secondaryEdge,
      Math.round(globalPositionRounded[secondaryEdge.resizableDimension]),
    );
  }

  if (
    V3.equals(updatedBounds.min, currentBounds.min) &&
    V3.equals(updatedBounds.max, currentBounds.max)
  ) {
    return;
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
  movementAccumulator: Vector3,
) {
  const state = Store.getState();
  const globalDelta = calculateGlobalDelta(state, delta, planeId);
  const bboxToResize = getBoundingBoxOfPrimaryEdge(primaryEdge, state);

  if (!bboxToResize) {
    return movementAccumulator;
  }

  const accumulatedDelta = V3.add(movementAccumulator, globalDelta);

  // As bounding box positions are stored as integers, only move by whole numbers.
  const roundedDelta = V3.round(accumulatedDelta);

  if (roundedDelta.some((delta) => delta !== 0)) {
    const minPosition = V3.add(bboxToResize.boundingBox.min, roundedDelta);
    const maxPosition = V3.add(bboxToResize.boundingBox.max, roundedDelta);

    const updatedBounds = {
      min: minPosition,
      max: maxPosition,
    };

    Store.dispatch(
      changeUserBoundingBoxAction(primaryEdge.boxId, {
        boundingBox: updatedBounds,
      }),
    );
  }

  // Store the fractional remainder for next time
  movementAccumulator = [
    accumulatedDelta[0] - roundedDelta[0],
    accumulatedDelta[1] - roundedDelta[1],
    accumulatedDelta[2] - roundedDelta[2],
  ];
  return movementAccumulator;
}
