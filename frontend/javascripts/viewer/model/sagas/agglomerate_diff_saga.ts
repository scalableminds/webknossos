import {
  getAgglomerateDiffToReferenceAsSkeletonTracing,
  getUnmappedSegmentIdAtPosition,
} from "admin/rest_api";
import ErrorHandling from "libs/error_handling";
import Toast, { type Message } from "libs/toast";
import { all, call, put, takeEvery } from "typed-redux-saga";
import type { ServerSkeletonTracingTree } from "types/api_types";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import { isConcurrentCollaborationMode } from "viewer/model/accessors/annotation_accessor";
import { getLayerByName, getMagInfo } from "viewer/model/accessors/dataset_accessor";
import {
  getSkeletonTracing,
  getTreeNameForAgglomerateTree,
} from "viewer/model/accessors/skeletontracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  addTreesAndGroupsAction,
  batchUpdateGroupsAndTreesAction,
  deleteTreesAction,
  setTreeGroupsAction,
} from "viewer/model/actions/skeletontracing_actions";
import {
  getAgglomerateDiffInfo,
  getAgglomerateDiffMetadata,
  getReferenceAgglomerateIdOfServerTree,
} from "viewer/model/helpers/agglomerate_diff_helpers";
import { parseProtoTracing } from "viewer/model/helpers/proto_helpers";
import { createMutableTreeMapFromTreeArray } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import { type Saga, select } from "viewer/model/sagas/effect_generators";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import type { Tree, TreeGroup } from "viewer/model/types/tree_types";
import type { SkeletonTracing } from "viewer/store";
import {
  MISSING_GROUP_ID,
  makeBasicGroupObject,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";

// Local id of the group that holds the diff trees of one agglomerate before it is added to the annotation
const DIFF_GROUP_ID = 1;
// Number of diffs that are requested in parallel when the reference agglomerate view changes
const MAX_PARALLEL_DIFF_REQUESTS = 4;

// The segment of the agglomerate whose reference agglomerate is compared, given as its id or position
type AgglomerateSegment = { id: bigint } | { positionInLayer: Vector3 };

export type FetchedAgglomerateDiff = {
  referenceMappingName: string;
  segmentId: bigint;
  diffTrees: Array<ServerSkeletonTracingTree>;
};

function getReferenceMappingName(skeletonTracing: SkeletonTracing, layerName: string) {
  return (
    skeletonTracing.agglomerateDiffReferences.find((ref) => ref.layerName === layerName)
      ?.referenceMappingName ?? null
  );
}

function getAgglomerateKey(mappingName: string, agglomerateId: bigint): string {
  return `${mappingName}-${agglomerateId}`;
}

// Only agglomerate trees that were loaded from an agglomerate file (not from an editable mapping)
// are compared to the reference agglomerate view. Returns null for all other trees.
function getComparableAgglomerateKey(tree: Tree): string | null {
  const info = tree.agglomerateInfo;
  if (
    tree.type !== TreeTypeEnum.AGGLOMERATE ||
    info == null ||
    info.tracingId != null ||
    info.mappingName == null
  ) {
    return null;
  }
  return getAgglomerateKey(info.mappingName, info.agglomerateId);
}

function findAgglomerateTree(
  skeletonTracing: SkeletonTracing,
  agglomerateId: bigint,
  mappingName: string,
): Tree | undefined {
  const key = getAgglomerateKey(mappingName, agglomerateId);
  return skeletonTracing.trees.values().find((tree) => getComparableAgglomerateKey(tree) === key);
}

function isDiffLoaded(
  skeletonTracing: SkeletonTracing,
  layerName: string,
  mappingName: string,
  agglomerateId: bigint,
  referenceMappingName: string,
): boolean {
  return skeletonTracing.trees.values().some((tree) => {
    const info = getAgglomerateDiffInfo(tree);
    return (
      info != null &&
      info.layerName === layerName &&
      info.agglomerateId === agglomerateId &&
      info.mappingName === mappingName &&
      info.referenceMappingName === referenceMappingName
    );
  });
}

function handleDiffLoadingError(e: { messages: Array<Message> } | Error) {
  if (!(e instanceof Error) && e.messages != null) {
    Toast.messages(e.messages);
  } else {
    Toast.error(`Could not load the agglomerate diff: ${(e as Error).message}`);
  }
  console.error(e);
  ErrorHandling.notify(e as Error);
}

/*
 * Requests the trees that show the added and removed edges of the given agglomerate compared to
 * the reference agglomerate view that is configured for the layer (if any). Only the reference
 * agglomerate that contains the given segment of the agglomerate is compared.
 * The agglomerate skeleton doesn't need to be loaded, so that both can be requested in parallel.
 * Errors are shown to the user and null is returned instead, so that this saga can be forked.
 */
export function* fetchAgglomerateDiff(
  layerName: string,
  mappingName: string,
  agglomerateId: bigint,
  segment: AgglomerateSegment,
): Saga<FetchedAgglomerateDiff | null> {
  const skeletonTracing = yield* select((state) => getSkeletonTracing(state.annotation));
  if (skeletonTracing == null) return null;
  const referenceMappingName = getReferenceMappingName(skeletonTracing, layerName);
  if (referenceMappingName == null || referenceMappingName === mappingName) return null;
  if (yield* select(isConcurrentCollaborationMode)) return null;
  if (isDiffLoaded(skeletonTracing, layerName, mappingName, agglomerateId, referenceMappingName)) {
    return null;
  }

  const dataset = yield* select((state) => state.dataset);
  const layerInfo = getLayerByName(dataset, layerName);
  // If there is a fallbackLayer, request the agglomerate for that instead of the tracing segmentation layer
  const effectiveLayerName =
    layerInfo.category === "segmentation" && layerInfo.fallbackLayer != null
      ? layerInfo.fallbackLayer
      : layerName;

  try {
    const segmentId =
      "id" in segment
        ? segment.id
        : yield* call(
            getUnmappedSegmentIdAtPosition,
            dataset.dataStore.url,
            dataset,
            effectiveLayerName,
            layerInfo.elementClass,
            segment.positionInLayer,
            getMagInfo(layerInfo.mags).getFinestMag(),
          );
    const protoBuffer = yield* call(
      getAgglomerateDiffToReferenceAsSkeletonTracing,
      dataset.dataStore.url,
      dataset,
      effectiveLayerName,
      mappingName,
      agglomerateId,
      referenceMappingName,
      segmentId,
    );
    const parsedTracing = parseProtoTracing(protoBuffer, "skeleton");
    if (!("trees" in parsedTracing)) {
      throw new Error("Skeleton tracing doesn't contain trees");
    }
    // The server returns one tree per connected component of added or removed edges
    const diffTrees = parsedTracing.trees.filter((tree) => tree.nodes.length > 0);
    return { referenceMappingName, segmentId, diffTrees };
  } catch (e) {
    // @ts-expect-error
    handleDiffLoadingError(e);
    return null;
  }
}

/*
 * Adds the fetched diff trees next to the agglomerate skeleton they belong to.
 */
export function* addAgglomerateDiffTrees(
  layerName: string,
  mappingName: string,
  agglomerateId: bigint,
  diff: FetchedAgglomerateDiff,
): Saga<void> {
  const { referenceMappingName, segmentId, diffTrees } = diff;
  // The annotation might have changed while the diff was requested
  const skeletonTracing = yield* select((state) => getSkeletonTracing(state.annotation));
  if (
    skeletonTracing == null ||
    getReferenceMappingName(skeletonTracing, layerName) !== referenceMappingName ||
    isDiffLoaded(skeletonTracing, layerName, mappingName, agglomerateId, referenceMappingName)
  ) {
    return;
  }
  const agglomerateTree = findAgglomerateTree(skeletonTracing, agglomerateId, mappingName);
  if (agglomerateTree == null) return;

  if (diffTrees.length === 0) {
    Toast.info(
      `Agglomerate ${agglomerateId} does not differ from the reference agglomerate view ${referenceMappingName}.`,
    );
    return;
  }
  const agglomerateTreeName = getTreeNameForAgglomerateTree(agglomerateId, mappingName);
  const referenceAgglomerateId = getReferenceAgglomerateIdOfServerTree(diffTrees[0]);
  const referenceName =
    referenceAgglomerateId != null
      ? `agglomerate ${referenceAgglomerateId} of ${referenceMappingName}`
      : referenceMappingName;
  const diffInfo = {
    layerName,
    agglomerateId,
    mappingName,
    referenceMappingName,
    segmentId,
    referenceAgglomerateId,
  };
  for (const tree of diffTrees) {
    // The server names the trees "added edges" and "removed edges"
    tree.name = `${agglomerateTreeName}: ${tree.name} compared to ${referenceName}`;
    tree.metadata = getAgglomerateDiffMetadata(diffInfo);
    tree.groupId = DIFF_GROUP_ID;
  }
  // The group gets a new id when it is added next to the agglomerate tree
  const diffGroup = makeBasicGroupObject(
    DIFF_GROUP_ID,
    `${agglomerateTreeName} compared to ${referenceName}`,
  );

  yield* put(
    addTreesAndGroupsAction(
      createMutableTreeMapFromTreeArray(diffTrees),
      [diffGroup],
      undefined,
      true,
      agglomerateTree.groupId ?? MISSING_GROUP_ID,
    ),
  );
}

/*
 * Loads the diff trees of an agglomerate skeleton that is already loaded. If no segment is given,
 * the segment at the first node of the agglomerate skeleton is compared.
 */
export function* loadAgglomerateDiffTrees(
  layerName: string,
  mappingName: string,
  agglomerateId: bigint,
  segment: AgglomerateSegment | null,
): Saga<void> {
  let segmentToCompare = segment;
  if (segmentToCompare == null) {
    const skeletonTracing = yield* select((state) => getSkeletonTracing(state.annotation));
    const firstNode =
      skeletonTracing != null
        ? findAgglomerateTree(skeletonTracing, agglomerateId, mappingName)?.nodes.values().next()
            .value
        : undefined;
    if (firstNode == null) return;
    // Agglomerate skeleton nodes are placed at segment positions of the agglomerate file
    segmentToCompare = { positionInLayer: firstNode.untransformedPosition };
  }
  const diff = yield* call(
    fetchAgglomerateDiff,
    layerName,
    mappingName,
    agglomerateId,
    segmentToCompare,
  );
  if (diff != null) {
    yield* call(addAgglomerateDiffTrees, layerName, mappingName, agglomerateId, diff);
  }
}

function removeEmptyGroups(
  groups: TreeGroup[],
  groupIdsToCheck: Set<number>,
  nonEmptyGroupIds: Set<number>,
): TreeGroup[] {
  return groups
    .map((group) => ({
      ...group,
      children: removeEmptyGroups(group.children, groupIdsToCheck, nonEmptyGroupIds),
    }))
    .filter(
      (group) =>
        !groupIdsToCheck.has(group.groupId) ||
        group.children.length > 0 ||
        nonEmptyGroupIds.has(group.groupId),
    );
}

/*
 * Deletes all diff trees whose agglomerate skeleton was removed or whose reference
 * agglomerate view no longer matches the one configured for the layer. Groups that
 * become empty because of that are deleted, too.
 */
function* cleanUpAgglomerateDiffTrees(): Saga<void> {
  const skeletonTracing = yield* select((state) => getSkeletonTracing(state.annotation));
  if (skeletonTracing == null) return;

  const agglomerateKeys = new Set(
    skeletonTracing.trees
      .values()
      .map(getComparableAgglomerateKey)
      .filter((key) => key != null),
  );
  const obsoleteTrees = skeletonTracing.trees
    .values()
    .filter((tree) => {
      const info = getAgglomerateDiffInfo(tree);
      if (info == null) return false;
      return (
        getReferenceMappingName(skeletonTracing, info.layerName) !== info.referenceMappingName ||
        !agglomerateKeys.has(getAgglomerateKey(info.mappingName, info.agglomerateId))
      );
    })
    .toArray();
  if (obsoleteTrees.length === 0) return;

  const obsoleteTreeIds = new Set(obsoleteTrees.map((tree) => tree.treeId));
  const groupIdsOfObsoleteTrees = new Set(
    obsoleteTrees.map((tree) => tree.groupId).filter((groupId) => groupId != null),
  );
  const groupIdsOfRemainingTrees = new Set(
    skeletonTracing.trees
      .values()
      .filter((tree) => !obsoleteTreeIds.has(tree.treeId) && tree.groupId != null)
      .map((tree) => tree.groupId as number),
  );
  const newTreeGroups = removeEmptyGroups(
    skeletonTracing.treeGroups,
    groupIdsOfObsoleteTrees,
    groupIdsOfRemainingTrees,
  );

  yield* put(
    batchUpdateGroupsAndTreesAction([
      deleteTreesAction([...obsoleteTreeIds], true),
      setTreeGroupsAction(newTreeGroups),
    ]),
  );
}

function* handleAgglomerateDiffReferenceChange(
  action: Extract<Action, { type: "SET_AGGLOMERATE_DIFF_REFERENCE" }>,
): Saga<void> {
  // Remember which segments the obsolete diffs were based on, so that the new diffs
  // compare the same part of the agglomerates.
  const segmentIdByAgglomerate = new Map<string, bigint>();
  const previousSkeletonTracing = yield* select((state) => getSkeletonTracing(state.annotation));
  for (const tree of previousSkeletonTracing?.trees.values() ?? []) {
    const info = getAgglomerateDiffInfo(tree);
    if (info != null && info.layerName === action.layerName) {
      segmentIdByAgglomerate.set(
        getAgglomerateKey(info.mappingName, info.agglomerateId),
        info.segmentId,
      );
    }
  }

  yield* call(cleanUpAgglomerateDiffTrees);
  if (action.referenceMappingName == null) return;

  // Load the diffs for all agglomerate skeletons of the layer that are already present
  const skeletonTracing = yield* select((state) => getSkeletonTracing(state.annotation));
  const dataset = yield* select((state) => state.dataset);
  const layerInfo = getLayerByName(dataset, action.layerName);
  if (skeletonTracing == null || layerInfo.category !== "segmentation") return;
  const agglomerateFilesOfLayer = new Set(layerInfo.agglomerates ?? []);

  const agglomeratesToLoad = skeletonTracing.trees
    .values()
    .filter((tree) => getComparableAgglomerateKey(tree) != null)
    .map((tree) => ({
      mappingName: tree.agglomerateInfo!.mappingName!,
      agglomerateId: tree.agglomerateInfo!.agglomerateId,
    }))
    .filter(({ mappingName }) => agglomerateFilesOfLayer.has(mappingName))
    .toArray();

  // Each diff request might take a few seconds, so several are done in parallel
  function* loadNextDiffs(): Saga<void> {
    for (
      let agglomerate = agglomeratesToLoad.shift();
      agglomerate != null;
      agglomerate = agglomeratesToLoad.shift()
    ) {
      const { mappingName, agglomerateId } = agglomerate;
      const segmentId = segmentIdByAgglomerate.get(getAgglomerateKey(mappingName, agglomerateId));
      yield* call(
        loadAgglomerateDiffTrees,
        action.layerName,
        mappingName,
        agglomerateId,
        segmentId != null ? { id: segmentId } : null,
      );
    }
  }
  yield* all(Array.from({ length: MAX_PARALLEL_DIFF_REQUESTS }, () => call(loadNextDiffs)));
}

export default function* watchAgglomerateDiffs(): Saga<void> {
  yield* call(ensureWkInitialized);
  yield* takeEvery("SET_AGGLOMERATE_DIFF_REFERENCE", handleAgglomerateDiffReferenceChange);
  yield* takeEvery(
    ["DELETE_TREE", "DELETE_TREES", "BATCH_UPDATE_GROUPS_AND_TREES", "MERGE_TREES"],
    cleanUpAgglomerateDiffTrees,
  );
}
