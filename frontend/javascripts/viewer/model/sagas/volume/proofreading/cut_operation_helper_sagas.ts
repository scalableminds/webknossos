import {
  getEdgesForAgglomerateMinCut,
  getNeighborsForAgglomerateNode,
  type MinCutTargetEdge,
  type NeighborInfo,
} from "admin/rest_api";
import Toast from "libs/toast";
import isEqual from "lodash-es/isEqual";
import { call, put } from "typed-redux-saga";
import type { Vector3 } from "viewer/constants";
import { areGeometriesTransformed } from "viewer/model/accessors/skeletontracing_accessor";
import { deleteEdgeAction } from "viewer/model/actions/skeletontracing_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import {
  splitAgglomerate,
  type UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import type { Tree } from "../../../types/tree_types";

// Returns a tuple of whether the min cut failed and if successful a list of edges removed by the min cut.
export function* performMinCut(
  sourceAgglomerateId: number,
  targetAgglomerateId: number,
  sourceSegmentIds: number[],
  targetSegmentIds: number[],
  agglomerateFileMag: Vector3,
  volumeTracingId: string,
  sourceTree: Tree | null,
  version: number,
  items: UpdateActionWithoutIsolationRequirement[],
): Saga<[boolean, MinCutTargetEdge[]]> {
  if (sourceAgglomerateId !== targetAgglomerateId) {
    Toast.error(
      `Segments need to be in the same agglomerate to perform a min-cut splitting operation. Agglomerate ids are ${sourceAgglomerateId} and ${targetAgglomerateId}.`,
    );
    return [true, []];
  }

  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  const segmentsInfo = {
    partition1: sourceSegmentIds,
    partition2: targetSegmentIds,
    mag: agglomerateFileMag,
    agglomerateId: sourceAgglomerateId,
    editableMappingId: volumeTracingId,
  };

  let edgesToRemove: MinCutTargetEdge[] = [];
  try {
    edgesToRemove = yield* call(
      getEdgesForAgglomerateMinCut,
      tracingStoreUrl,
      volumeTracingId,
      version,
      segmentsInfo,
    );
  } catch (exception) {
    console.error(exception);
    Toast.error("Could not determine which edges to delete for cut. Please try again.");
    return [true, []];
  }

  // Use untransformedPosition below because agglomerate trees should not have
  // any transforms, anyway.
  if (yield* select((state) => areGeometriesTransformed(state))) {
    Toast.error("Proofreading is currently not supported when the skeleton layer is transformed.");
    return [true, []];
  }

  for (const edge of edgesToRemove) {
    if (sourceTree) {
      const result = getDeleteEdgeActionForEdgePositions(sourceTree, edge);
      if (result == null) {
        return [true, []];
      }
      const { firstNodeId, secondNodeId } = result;
      yield* put(deleteEdgeAction(firstNodeId, secondNodeId, Date.now(), "PROOFREADING"));
    }

    console.log(
      "Splitting agglomerate",
      sourceAgglomerateId,
      "with segment ids",
      edge.segmentId1,
      "and",
      edge.segmentId2,
    );
    items.push(
      splitAgglomerate(edge.segmentId1, edge.segmentId2, sourceAgglomerateId, volumeTracingId),
    );
  }

  return [false, edgesToRemove];
}

export function* performCutFromNeighbors(
  agglomerateId: number,
  segmentId: number,
  segmentPosition: Vector3 | null,
  agglomerateFileMag: Vector3,
  volumeTracingId: string,
  annotationVersion: number,
  sourceTree: Tree | null | undefined,
  items: UpdateActionWithoutIsolationRequirement[],
): Saga<
  { didCancel: false; neighborInfo: NeighborInfo } | { didCancel: true; neighborInfo?: null }
> {
  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  const segmentsInfo = {
    segmentId,
    mag: agglomerateFileMag,
    agglomerateId,
    editableMappingId: volumeTracingId,
  };

  let neighborInfo;
  try {
    neighborInfo = yield* call(
      getNeighborsForAgglomerateNode,
      tracingStoreUrl,
      volumeTracingId,
      annotationVersion,
      segmentsInfo,
    );
  } catch (exception) {
    console.error(exception);
    Toast.error("Could not load neighbors of agglomerate node. Please try again.");
    return { didCancel: true };
  }

  const edgesToRemove: Array<
    | {
        position1: Vector3;
        position2: Vector3;
        segmentId1: number;
        segmentId2: number;
      }
    | {
        position1: null;
        position2: Vector3;
        segmentId1: number;
        segmentId2: number;
      }
  > = neighborInfo.neighbors.map(
    (neighbor) =>
      ({
        position1: segmentPosition,
        position2: neighbor.position,
        segmentId1: segmentId,
        segmentId2: neighbor.segmentId,
      }) as const,
  );

  if (edgesToRemove.length === 0) {
    Toast.info("No neighbors found.");
    return { didCancel: true };
  }

  for (const edge of edgesToRemove) {
    if (sourceTree) {
      if (edge.position1 == null) {
        // Satisfy TypeScript. Should not happen because segmentPosition should not be null
        // when a sourceTree was passed.
        Toast.warning("Could not perform cut from neighbors. See console for more details.");
        console.warn(
          "segmentPosition is not available even though a tree was passed to performCutFromNeighbors.",
        );
        return { didCancel: true };
      }
      const result = getDeleteEdgeActionForEdgePositions(sourceTree, edge);
      if (result == null) {
        return { didCancel: true };
      }
      const { firstNodeId, secondNodeId } = result;
      yield* put(deleteEdgeAction(firstNodeId, secondNodeId, Date.now(), "PROOFREADING"));
    }

    items.push(splitAgglomerate(edge.segmentId1, edge.segmentId2, agglomerateId, volumeTracingId));
  }

  return { didCancel: false, neighborInfo };
}

function getDeleteEdgeActionForEdgePositions(
  sourceTree: Tree,
  edge: { position1: Vector3; position2: Vector3 },
) {
  let firstNodeId;
  let secondNodeId;
  for (const node of sourceTree.nodes.values()) {
    if (isEqual(node.untransformedPosition, edge.position1)) {
      firstNodeId = node.id;
    } else if (isEqual(node.untransformedPosition, edge.position2)) {
      secondNodeId = node.id;
    }
    if (firstNodeId && secondNodeId) {
      break;
    }
  }

  if (!firstNodeId || !secondNodeId) {
    Toast.warning(
      `Unable to find all nodes for positions ${!firstNodeId ? edge.position1 : null}${
        !secondNodeId ? [", ", edge.position2] : null
      } in ${sourceTree.name}.`,
    );
    return null;
  }
  return { firstNodeId, secondNodeId };
}
