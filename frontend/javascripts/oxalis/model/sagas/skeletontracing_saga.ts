import { Modal } from "antd";
import _ from "lodash";
import type { Action } from "oxalis/model/actions/actions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import {
  actionChannel,
  take,
  takeEvery,
  throttle,
  all,
  call,
  fork,
  put,
  race,
} from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import { TreeTypeEnum } from "oxalis/constants";
import {
  createEdge,
  createNode,
  createTree,
  deleteEdge,
  deleteNode,
  deleteTree,
  updateTreeVisibility,
  updateTreeEdgesVisibility,
  updateNode,
  updateSkeletonTracing,
  updateUserBoundingBoxes,
  updateTree,
  updateTreeGroups,
} from "oxalis/model/sagas/update_actions";
import { V3 } from "libs/mjs";
import type { LoadAgglomerateSkeletonAction } from "oxalis/model/actions/skeletontracing_actions";
import {
  deleteBranchPointAction,
  setTreeNameAction,
  addTreesAndGroupsAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  generateTreeName,
  createMutableTreeMapFromTreeArray,
} from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import {
  getActiveNode,
  getBranchPoints,
  enforceSkeletonTracing,
  findTreeByName,
  getTreeNameForAgglomerateSkeleton,
  getTreesWithType,
  getNodePosition,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import {
  setAdditionalCoordinatesAction,
  setPositionAction,
  setRotationAction,
} from "oxalis/model/actions/flycam_actions";
import { setVersionRestoreVisibilityAction } from "oxalis/model/actions/ui_actions";
import DiffableMap, { diffDiffableMaps } from "libs/diffable_map";
import EdgeCollection, { diffEdgeCollections } from "oxalis/model/edge_collection";
import ErrorHandling from "libs/error_handling";
import type {
  Flycam,
  Node,
  NodeMap,
  OxalisState,
  SkeletonTracing,
  Tree,
  TreeMap,
} from "oxalis/store";
import Store from "oxalis/store";
import type { Message } from "libs/toast";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { api } from "oxalis/singletons";
import messages from "messages";
import { getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { getAgglomerateSkeleton, getEditableAgglomerateSkeleton } from "admin/admin_rest_api";
import { parseProtoTracing } from "oxalis/model/helpers/proto_helpers";
import createProgressCallback from "libs/progress_callback";
import {
  addConnectomeTreesAction,
  deleteConnectomeTreesAction,
} from "oxalis/model/actions/connectome_actions";
import type { ServerSkeletonTracing } from "types/api_flow_types";
import memoizeOne from "memoize-one";
import { isAnnotationEditingAllowedByFullState } from "../accessors/annotation_accessor";

function* centerActiveNode(action: Action): Saga<void> {
  if ("suppressCentering" in action && action.suppressCentering) {
    return;
  }
  if (["DELETE_NODE", "DELETE_BRANCHPOINT"].includes(action.type)) {
    const centerNewNode = yield* select(
      (state: OxalisState) => state.userConfiguration.centerNewNode,
    );

    if (!centerNewNode) {
      // The active node should not be centered upon node manipulation.
      return;
    }
  }

  const activeNode = getActiveNode(
    yield* select((state: OxalisState) => enforceSkeletonTracing(state.tracing)),
  );

  if (activeNode != null) {
    const activeNodePosition = yield* select((state: OxalisState) =>
      getNodePosition(activeNode, state),
    );
    if ("suppressAnimation" in action && action.suppressAnimation) {
      Store.dispatch(setPositionAction(activeNodePosition));
      Store.dispatch(setRotationAction(activeNode.rotation));
    } else {
      api.tracing.centerPositionAnimated(activeNodePosition, false, activeNode.rotation);
    }
    if (activeNode.additionalCoordinates) {
      Store.dispatch(setAdditionalCoordinatesAction(activeNode.additionalCoordinates));
    }
  }
}

function* watchBranchPointDeletion(): Saga<void> {
  let lastActionCreatedNode = true;

  while (true) {
    const { deleteBranchpointAction } = yield* race({
      deleteBranchpointAction: take("REQUEST_DELETE_BRANCHPOINT"),
      createNodeAction: take("CREATE_NODE"),
    });

    if (deleteBranchpointAction) {
      const hasBranchPoints = yield* select(
        (state: OxalisState) => getBranchPoints(state.tracing).getOrElse([]).length > 0,
      );

      if (hasBranchPoints) {
        if (lastActionCreatedNode === true) {
          yield* put(deleteBranchPointAction());
        } else {
          Modal.confirm({
            title: "Jump again?",
            content: messages["tracing.branchpoint_jump_twice"],
            okText: "Jump again!",
            onOk: () => {
              Store.dispatch(deleteBranchPointAction());
            },
          });
        }

        lastActionCreatedNode = false;
      } else {
        Toast.warning(messages["tracing.no_more_branchpoints"]);
      }
    } else {
      lastActionCreatedNode = true;
    }
  }
}

function* watchFailedNodeCreations(): Saga<void> {
  while (true) {
    yield* take("CREATE_NODE");
    const activeTreeId = yield* select(
      (state) => enforceSkeletonTracing(state.tracing).activeTreeId,
    );

    if (activeTreeId == null) {
      Toast.warning(messages["tracing.cant_create_node"]);
    }
  }
}

function* watchTracingConsistency(): Saga<void> {
  const state = yield* select((_state) => _state);
  const invalidTreeDetails = [];

  for (const tree of _.values(enforceSkeletonTracing(state.tracing).trees)) {
    const edgeCount = tree.edges.size();
    const nodeCount = tree.nodes.size();

    // For a tree, edge_count = node_count - 1 should hold true. For graphs, the edge count
    // would be even higher.
    if (edgeCount < nodeCount - 1) {
      invalidTreeDetails.push({
        treeId: tree.treeId,
        name: tree.name,
        timestamp: tree.timestamp,
        isVisible: tree.isVisible,
        edgeCount,
        nodeCount,
      });
    }
  }

  if (invalidTreeDetails.length > 0) {
    const error = new Error("Corrupted tracing. See the action log for details.");
    Toast.error(messages["tracing.invalid_state"]);
    ErrorHandling.notify(error, {
      invalidTreeDetails,
    });
  }
}

export function* watchTreeNames(): Saga<void> {
  const state = yield* select((_state) => _state);

  // rename trees with an empty/default tree name
  for (const tree of _.values(enforceSkeletonTracing(state.tracing).trees)) {
    if (tree.name === "") {
      const newName = generateTreeName(state, tree.timestamp, tree.treeId);
      yield* put(setTreeNameAction(newName, tree.treeId));
    }
  }
}
export function* checkVersionRestoreParam(): Saga<void> {
  const showVersionRestore = yield* call(Utils.hasUrlParam, "showVersionRestore");

  if (showVersionRestore) {
    yield* put(setVersionRestoreVisibilityAction(true));
  }
}
export function* watchAgglomerateLoading(): Saga<void> {
  // Buffer actions since they might be dispatched before WK_READY
  const channel = yield* actionChannel("LOAD_AGGLOMERATE_SKELETON");
  yield* take("INITIALIZE_SKELETONTRACING");
  yield* take("WK_READY");
  yield* takeEvery(channel, loadAgglomerateSkeletonWithId);
}
export function* watchConnectomeAgglomerateLoading(): Saga<void> {
  // Buffer actions since they might be dispatched before WK_READY
  const channel = yield* actionChannel("LOAD_CONNECTOME_AGGLOMERATE_SKELETON");
  // The order of these two actions is not guaranteed, but they both need to be dispatched
  yield* all([take("INITIALIZE_CONNECTOME_TRACING"), take("WK_READY")]);
  yield* takeEvery(channel, loadConnectomeAgglomerateSkeletonWithId);
  yield* takeEvery(
    "REMOVE_CONNECTOME_AGGLOMERATE_SKELETON",
    removeConnectomeAgglomerateSkeletonWithId,
  );
}

function* getAgglomerateSkeletonTracing(
  layerName: string,
  mappingName: string,
  agglomerateId: number,
): Saga<ServerSkeletonTracing> {
  const dataset = yield* select((state) => state.dataset);
  const annotation = yield* select((state) => state.tracing);
  const layerInfo = getLayerByName(dataset, layerName);

  const editableMapping = annotation.mappings.find(
    (mapping) => mapping.mappingName === mappingName,
  );

  try {
    let nmlProtoBuffer;
    if (editableMapping == null) {
      // If there is a fallbackLayer, request the agglomerate for that instead of the tracing segmentation layer
      const effectiveLayerName =
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fallbackLayer' does not exist on type 'A... Remove this comment to see the full error message
        layerInfo.fallbackLayer != null ? layerInfo.fallbackLayer : layerName;
      nmlProtoBuffer = yield* call(
        getAgglomerateSkeleton,
        dataset.dataStore.url,
        dataset,
        effectiveLayerName,
        mappingName,
        agglomerateId,
      );
    } else {
      nmlProtoBuffer = yield* call(
        getEditableAgglomerateSkeleton,
        annotation.tracingStore.url,
        editableMapping.tracingId,
        agglomerateId,
      );
    }
    const parsedTracing = parseProtoTracing(nmlProtoBuffer, "skeleton");

    if (!("trees" in parsedTracing)) {
      // This check is only for typescript to realize that we have a skeleton tracing
      // on our hands.
      throw new Error("Skeleton tracing doesn't contain trees");
    }

    if (parsedTracing.trees.length !== 1) {
      throw new Error(
        `Agglomerate skeleton response does not contain exactly one tree, but ${parsedTracing.trees.length} instead.`,
      );
    }

    // Make sure the tree is named as expected
    parsedTracing.trees[0].name = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);

    return parsedTracing;
  } catch (e) {
    // @ts-ignore
    if (e.messages != null) {
      // Enhance the error message for agglomerates that are too large
      // @ts-ignore
      const agglomerateTooLargeMessages = e.messages
        .filter(
          (message: Message) =>
            message.chain?.includes("too many") || message.error?.includes("too many"),
        )
        // Demote error message to chain message so that it is shown in conjunction with the newly
        // introduced error (as the chain). Otherwise there would be two toasts.
        .map((message: Message) => (message.error != null ? { chain: message.error } : message));

      if (agglomerateTooLargeMessages.length > 0) {
        throw {
          // @ts-ignore
          ...e,
          messages: [
            {
              error: "Agglomerate is too large to be loaded",
            },
            ...agglomerateTooLargeMessages,
          ],
        };
      }
    }

    throw e;
  }
}

function handleAgglomerateLoadingError(
  e:
    | {
        messages: Array<Message>;
      }
    | Error,
) {
  if (!(e instanceof Error)) {
    Toast.messages(e.messages);
  } else {
    Toast.error(e.message);
  }

  console.error(e);
  ErrorHandling.notify(e);
}

export function* loadAgglomerateSkeletonWithId(
  action: LoadAgglomerateSkeletonAction,
): Saga<[string, number] | null> {
  const allowEditing = yield* select((state) => isAnnotationEditingAllowedByFullState(state));
  if (!allowEditing) return null;
  const { layerName, mappingName, agglomerateId } = action;

  if (agglomerateId === 0) {
    Toast.error(messages["tracing.agglomerate_skeleton.no_cell"]);
    return null;
  }

  const treeName = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);
  const trees = yield* select((state) =>
    getTreesWithType(enforceSkeletonTracing(state.tracing), TreeTypeEnum.AGGLOMERATE),
  );
  const maybeTree = findTreeByName(trees, treeName);

  if (maybeTree != null) {
    console.warn(
      `Skeleton for agglomerate ${agglomerateId} with mapping ${mappingName} is already loaded. Its tree name is "${treeName}".`,
    );
    return [treeName, maybeTree.treeId];
  }

  const progressCallback = createProgressCallback({
    pauseDelay: 100,
    successMessageDelay: 2000,
  });
  const { hideFn } = yield* call(
    progressCallback,
    false,
    `Loading skeleton for agglomerate ${agglomerateId} with mapping ${mappingName}`,
  );

  let usedTreeIds: number[] | null = null;
  try {
    const parsedTracing = yield* call(
      getAgglomerateSkeletonTracing,
      layerName,
      mappingName,
      agglomerateId,
    );
    yield* put(
      addTreesAndGroupsAction(
        createMutableTreeMapFromTreeArray(parsedTracing.trees),
        parsedTracing.treeGroups,
        (newTreeIds) => {
          usedTreeIds = newTreeIds;
        },
      ),
    );
    // @ts-ignore TS infers usedTreeIds to be never, but it should be number[] if its not null
    if (usedTreeIds == null || usedTreeIds.length !== 1) {
      throw new Error(
        "Assumption violated while adding agglomerate skeleton. Exactly one tree should have been added.",
      );
    }
  } catch (e) {
    // Hide the progress notification and handle the error
    hideFn();
    // @ts-ignore
    handleAgglomerateLoadingError(e);
    return null;
  }

  yield* call(progressCallback, true, "Skeleton generation done.");
  return [treeName, usedTreeIds[0]];
}

function* loadConnectomeAgglomerateSkeletonWithId(
  action: LoadAgglomerateSkeletonAction,
): Saga<void> {
  const { layerName, mappingName, agglomerateId } = action;

  if (agglomerateId === 0) {
    Toast.error(messages["tracing.agglomerate_skeleton.no_cell"]);
    return;
  }

  try {
    const parsedTracing = yield* call(
      getAgglomerateSkeletonTracing,
      layerName,
      mappingName,
      agglomerateId,
    );
    yield* put(
      addConnectomeTreesAction(createMutableTreeMapFromTreeArray(parsedTracing.trees), layerName),
    );
  } catch (e) {
    // @ts-ignore
    handleAgglomerateLoadingError(e);
  }
}

function* removeConnectomeAgglomerateSkeletonWithId(
  action: LoadAgglomerateSkeletonAction,
): Saga<void> {
  const { layerName, mappingName, agglomerateId } = action;
  const treeName = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);
  const skeleton = yield* select(
    (state) => state.localSegmentationData[layerName].connectomeData.skeleton,
  );
  if (skeleton == null) return;
  const { trees } = skeleton;
  const tree = findTreeByName(trees, treeName);
  if (tree) {
    yield* put(deleteConnectomeTreesAction([tree.treeId], layerName));
  }
}

export function* watchSkeletonTracingAsync(): Saga<void> {
  yield* take("INITIALIZE_SKELETONTRACING");
  yield* takeEvery("WK_READY", watchTreeNames);
  yield* takeEvery(
    [
      "SET_ACTIVE_TREE",
      "SET_ACTIVE_TREE_BY_NAME",
      "SET_ACTIVE_NODE",
      "DELETE_NODE",
      "DELETE_BRANCHPOINT",
      "SELECT_NEXT_TREE",
      "DELETE_TREE",
      "DELETE_TREES",
      "BATCH_UPDATE_GROUPS_AND_TREES",
      "CENTER_ACTIVE_NODE",
    ],
    centerActiveNode,
  );
  yield* throttle(5000, "PUSH_SAVE_QUEUE_TRANSACTION", watchTracingConsistency);
  yield* fork(watchFailedNodeCreations);
  yield* fork(watchBranchPointDeletion);
  yield* fork(checkVersionRestoreParam);
}

function* diffNodes(
  prevNodes: NodeMap,
  nodes: NodeMap,
  treeId: number,
): Generator<UpdateAction, void, void> {
  if (prevNodes === nodes) return;
  const {
    onlyA: deletedNodeIds,
    onlyB: addedNodeIds,
    changed: changedNodeIds,
  } = diffDiffableMaps(prevNodes, nodes);

  for (const nodeId of deletedNodeIds) {
    yield deleteNode(treeId, nodeId);
  }

  for (const nodeId of addedNodeIds) {
    const node = nodes.getOrThrow(nodeId);
    yield createNode(treeId, node);
  }

  for (const nodeId of changedNodeIds) {
    const node = nodes.getOrThrow(nodeId);
    const prevNode = prevNodes.getOrThrow(nodeId);

    if (updateNodePredicate(prevNode, node)) {
      yield updateNode(treeId, node);
    }
  }
}

function updateNodePredicate(prevNode: Node, node: Node): boolean {
  return !_.isEqual(prevNode, node);
}

function* diffEdges(
  prevEdges: EdgeCollection,
  edges: EdgeCollection,
  treeId: number,
): Generator<UpdateAction, void, void> {
  if (prevEdges === edges) return;
  const { onlyA: deletedEdges, onlyB: addedEdges } = diffEdgeCollections(prevEdges, edges);

  for (const edge of deletedEdges) {
    yield deleteEdge(treeId, edge.source, edge.target);
  }

  for (const edge of addedEdges) {
    yield createEdge(treeId, edge.source, edge.target);
  }
}

function updateTracingPredicate(
  prevSkeletonTracing: SkeletonTracing,
  skeletonTracing: SkeletonTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
): boolean {
  return prevSkeletonTracing.activeNodeId !== skeletonTracing.activeNodeId || prevFlycam !== flycam;
}

function updateTreePredicate(prevTree: Tree, tree: Tree): boolean {
  return (
    // branchPoints and comments are arrays and therefore checked for
    // equality. This avoids unnecessary updates in certain cases (e.g.,
    // when two trees are merged, the comments are concatenated, even
    // if one of them is empty; thus, resulting in new instances).
    !_.isEqual(prevTree.branchPoints, tree.branchPoints) ||
    !_.isEqual(prevTree.comments, tree.comments) ||
    prevTree.color !== tree.color ||
    prevTree.name !== tree.name ||
    prevTree.timestamp !== tree.timestamp ||
    prevTree.groupId !== tree.groupId ||
    prevTree.type !== tree.type ||
    prevTree.metadata !== tree.metadata
  );
}

export function* diffTrees(
  prevTrees: TreeMap,
  trees: TreeMap,
): Generator<UpdateAction, void, void> {
  if (prevTrees === trees) return;
  const {
    onlyA: deletedTreeIds,
    onlyB: addedTreeIds,
    both: bothTreeIds,
  } = Utils.diffArrays(
    _.map(prevTrees, (tree) => tree.treeId),
    _.map(trees, (tree) => tree.treeId),
  );

  for (const treeId of deletedTreeIds) {
    const prevTree = prevTrees[treeId];
    yield* diffNodes(prevTree.nodes, new DiffableMap(), treeId);
    yield* diffEdges(prevTree.edges, new EdgeCollection(), treeId);
    yield deleteTree(treeId);
  }

  for (const treeId of addedTreeIds) {
    const tree = trees[treeId];
    yield createTree(tree);
    yield* diffNodes(new DiffableMap(), tree.nodes, treeId);
    yield* diffEdges(new EdgeCollection(), tree.edges, treeId);
  }

  for (const treeId of bothTreeIds) {
    const tree = trees[treeId];
    const prevTree: Tree = prevTrees[treeId];

    if (tree !== prevTree) {
      yield* diffNodes(prevTree.nodes, tree.nodes, treeId);
      yield* diffEdges(prevTree.edges, tree.edges, treeId);

      if (updateTreePredicate(prevTree, tree)) {
        yield updateTree(tree);
      }

      if (prevTree.isVisible !== tree.isVisible) {
        yield updateTreeVisibility(tree);
      }
      if (prevTree.edgesAreVisible !== tree.edgesAreVisible) {
        yield updateTreeEdgesVisibility(tree);
      }
    }
  }
}

export const cachedDiffTrees = memoizeOne((prevTrees: TreeMap, trees: TreeMap) =>
  Array.from(diffTrees(prevTrees, trees)),
);

export function* diffSkeletonTracing(
  prevSkeletonTracing: SkeletonTracing,
  skeletonTracing: SkeletonTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
): Generator<UpdateAction, void, void> {
  if (prevSkeletonTracing !== skeletonTracing) {
    for (const action of cachedDiffTrees(prevSkeletonTracing.trees, skeletonTracing.trees)) {
      yield action;
    }

    if (prevSkeletonTracing.treeGroups !== skeletonTracing.treeGroups) {
      yield updateTreeGroups(skeletonTracing.treeGroups);
    }
  }

  if (updateTracingPredicate(prevSkeletonTracing, skeletonTracing, prevFlycam, flycam)) {
    yield updateSkeletonTracing(
      skeletonTracing,
      V3.floor(getPosition(flycam)),
      flycam.additionalCoordinates,
      getRotation(flycam),
      flycam.zoomStep,
    );
  }

  if (!_.isEqual(prevSkeletonTracing.userBoundingBoxes, skeletonTracing.userBoundingBoxes)) {
    yield updateUserBoundingBoxes(skeletonTracing.userBoundingBoxes);
  }
}
export default [
  watchSkeletonTracingAsync,
  watchAgglomerateLoading,
  watchConnectomeAgglomerateLoading,
];
