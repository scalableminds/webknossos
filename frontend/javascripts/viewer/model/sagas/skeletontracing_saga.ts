import {
  getAgglomerateTreeAsSkeletonTracing as getAgglomerateTreeAsSkeletonTracingFromDatastore,
  getEditableAgglomerateTreeAsSkeletonTracing,
} from "admin/rest_api";
import { Modal } from "antd";
import DiffableMap, { diffDiffableMaps } from "libs/diffable_map";
import ErrorHandling from "libs/error_handling";
import { V3 } from "libs/mjs";
import createProgressCallback, { type HideFn } from "libs/progress_callback";
import type { Message } from "libs/toast";
import Toast from "libs/toast";
import { map3 } from "libs/utils";
import isEqual from "lodash-es/isEqual";
import memoizeOne from "memoize-one";
import messages from "messages";
import { MathUtils, Matrix4 } from "three";
import {
  actionChannel,
  all,
  call,
  fork,
  put,
  race,
  take,
  takeEvery,
  throttle,
} from "typed-redux-saga";
import { AnnotationLayerEnum, type ServerSkeletonTracing } from "types/api_types";
import {
  NumberToOrthoView,
  OrthoBaseRotations,
  TreeTypeEnum,
  type Vector3,
} from "viewer/constants";
import { getSegmentIdForPositionAsync } from "viewer/controller/combinations/volume_handlers";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { getLayerByName } from "viewer/model/accessors/dataset_accessor";
import {
  enforceSkeletonTracing,
  findTreeByAgglomerateId,
  findTreeByName,
  findTreeByNodeId,
  getActiveNode,
  getBranchPoints,
  getNodePosition,
  getTreeNameForAgglomerateTree,
  getTreesWithType,
} from "viewer/model/accessors/skeletontracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  addConnectomeTreesAction,
  deleteConnectomeTreesAction,
} from "viewer/model/actions/connectome_actions";
import {
  setAdditionalCoordinatesAction,
  setPositionAction,
  setRotationAction,
} from "viewer/model/actions/flycam_actions";
import type {
  LoadAgglomerateTreeAtPositionAction,
  LoadAgglomerateTreeFromIdAction,
} from "viewer/model/actions/skeletontracing_actions";
import {
  addTreesAndGroupsAction,
  deleteBranchPointAction,
  setTreeNameAction,
} from "viewer/model/actions/skeletontracing_actions";
import EdgeCollection, { diffEdgeCollections } from "viewer/model/edge_collection";
import { parseProtoTracing } from "viewer/model/helpers/proto_helpers";
import {
  createMutableTreeMapFromTreeArray,
  generateTreeName,
} from "viewer/model/reducers/skeletontracing_reducer_helpers";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/volume/update_actions";
import {
  createEdge,
  createNode,
  createTree,
  deleteEdge,
  deleteNode,
  deleteTree,
  updateActiveNode,
  updateNode,
  updateTree,
  updateTreeEdgesVisibility,
  updateTreeGroups,
  updateTreeGroupsExpandedState,
  updateTreeVisibility,
} from "viewer/model/sagas/volume/update_actions";
import { api, Model } from "viewer/singletons";
import type { SkeletonTracing, WebknossosState } from "viewer/store";
import Store from "viewer/store";
import { dispatchEnsureHasNewestVersionAsync } from "../actions/save_actions";
import {
  eulerAngleToReducerInternalMatrix,
  reducerInternalMatrixToEulerAngle,
} from "../helpers/rotation_helpers";
import type { MutableNode, Node, NodeMap, Tree, TreeMap } from "../types/tree_types";
import { diffBoundingBoxes } from "./diffing/bounding_box_diffing";
import { diffGroups } from "./diffing/group_diffing";
import { ensureWkInitialized } from "./ready_sagas";
import { takeWithBatchActionSupport } from "./saga_helpers";
import { subscribeToAnnotationMutex } from "./saving/save_mutex_saga";

function getNodeRotationWithoutPlaneRotation(activeNode: Readonly<MutableNode>): Vector3 {
  // In orthogonal view mode, the active planes' default rotation is added to the flycam rotation upon node creation.
  // To get the same flycam rotation as was active during node creation, the default rotation is calculated from the nodes rotation.
  const nodeRotationRadian = map3(MathUtils.degToRad, activeNode.rotation);
  const nodeRotationInReducerFormatMatrix = eulerAngleToReducerInternalMatrix(nodeRotationRadian);
  const viewportRotationMatrix = new Matrix4().makeRotationFromEuler(
    OrthoBaseRotations[NumberToOrthoView[activeNode.viewport]],
  );
  // Invert the rotation of the viewport to get the rotation configured during node creation.
  const viewportRotationMatrixInverted = viewportRotationMatrix.invert();
  const rotationWithoutViewportRotation = nodeRotationInReducerFormatMatrix.multiply(
    viewportRotationMatrixInverted,
  );
  const rotationInRadian = reducerInternalMatrixToEulerAngle(rotationWithoutViewportRotation);
  const flycamOnlyRotationInDegree = V3.round(map3(MathUtils.radToDeg, rotationInRadian));
  return flycamOnlyRotationInDegree;
}

function* centerActiveNode(action: Action): Saga<void> {
  if ("suppressCentering" in action && action.suppressCentering) {
    return;
  }
  if (["DELETE_NODE", "DELETE_BRANCHPOINT"].includes(action.type)) {
    const centerNewNode = yield* select(
      (state: WebknossosState) => state.userConfiguration.centerNewNode,
    );

    if (!centerNewNode) {
      // The active node should not be centered upon node manipulation.
      return;
    }
  }

  const activeNode = yield* select((state: WebknossosState) =>
    getActiveNode(state.annotation.skeleton, state.localSkeletonState.activeTreeId),
  );
  const viewMode = yield* select((state: WebknossosState) => state.temporaryConfiguration.viewMode);
  const userApplyRotation = yield* select(
    (state: WebknossosState) => state.userConfiguration.applyNodeRotationOnActivation,
  );
  const applyRotation =
    "suppressRotation" in action && action.suppressRotation != null
      ? !action.suppressRotation
      : userApplyRotation;

  if (activeNode != null) {
    let nodeRotation = activeNode.rotation;
    if (applyRotation && viewMode === "orthogonal") {
      nodeRotation = yield* call(getNodeRotationWithoutPlaneRotation, activeNode);
    }
    const activeNodePosition = yield* select((state: WebknossosState) =>
      getNodePosition(activeNode, state),
    );
    if ("suppressAnimation" in action && action.suppressAnimation) {
      Store.dispatch(setPositionAction(activeNodePosition));
      if (applyRotation) {
        Store.dispatch(setRotationAction(nodeRotation));
      }
    } else {
      api.tracing.centerPositionAnimated(
        activeNodePosition,
        false,
        applyRotation ? nodeRotation : undefined,
        true,
      );
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
        (state: WebknossosState) => (getBranchPoints(state.annotation) ?? []).length > 0,
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
    const activeTreeId = yield* select((state) => state.localSkeletonState.activeTreeId);

    if (activeTreeId == null) {
      Toast.warning(messages["tracing.cant_create_node"]);
    }
  }
}

function* watchTracingConsistency(): Saga<void> {
  const state = yield* select((_state) => _state);
  const invalidTreeDetails: Array<Record<string, any>> = [];

  for (const tree of enforceSkeletonTracing(state.annotation).trees.values()) {
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

function* watchTreeNames(): Saga<void> {
  const state = yield* select((_state) => _state);

  // rename trees with an empty/default tree name
  for (const tree of enforceSkeletonTracing(state.annotation).trees.values()) {
    if (tree.name === "") {
      const newName = generateTreeName(state, tree.timestamp, tree.treeId);
      yield* put(setTreeNameAction(newName, tree.treeId));
    }
  }
}

function* watchAgglomerateLoading(): Saga<void> {
  // Buffer actions since they might be dispatched before WK_INITIALIZED
  const channel = yield* actionChannel([
    "LOAD_AGGLOMERATE_TREE_FROM_ID",
    "LOAD_AGGLOMERATE_TREE_AT_POSITION",
  ]);
  yield* takeWithBatchActionSupport("INITIALIZE_SKELETONTRACING");
  yield* call(ensureWkInitialized);
  yield* takeEvery(channel, loadAgglomerateTreeWithAtPosition);
}
function* watchConnectomeAgglomerateLoading(): Saga<void> {
  // Buffer actions since they might be dispatched before WK_INITIALIZED
  const channel = yield* actionChannel("LOAD_CONNECTOME_AGGLOMERATE_TREE");
  // The order of these two actions is not guaranteed, but they both need to be dispatched
  yield* all([take("INITIALIZE_CONNECTOME_TRACING"), take("WK_INITIALIZED")]);
  yield* takeEvery(channel, loadConnectomeAgglomerateTreeWithId);
  yield* takeEvery("REMOVE_CONNECTOME_AGGLOMERATE_TREE", removeConnectomeAgglomerateTreeWithId);
}

export function* getAgglomerateTreeAsSkeletonTracing(
  layerName: string,
  mappingName: string,
  agglomerateId: number,
): Saga<ServerSkeletonTracing> {
  const dataset = yield* select((state) => state.dataset);
  const annotation = yield* select((state) => state.annotation);
  const layerInfo = getLayerByName(dataset, layerName);

  const editableMapping = annotation.mappings.find((mapping) => mapping.tracingId === mappingName);

  try {
    let nmlProtoBuffer;
    if (editableMapping == null) {
      // If there is a fallbackLayer, request the agglomerate for that instead of the tracing segmentation layer
      const effectiveLayerName =
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fallbackLayer' does not exist on type 'A... Remove this comment to see the full error message
        layerInfo.fallbackLayer != null ? layerInfo.fallbackLayer : layerName;
      nmlProtoBuffer = yield* call(
        getAgglomerateTreeAsSkeletonTracingFromDatastore,
        dataset.dataStore.url,
        dataset,
        effectiveLayerName,
        mappingName,
        agglomerateId,
      );
    } else {
      nmlProtoBuffer = yield* call(
        getEditableAgglomerateTreeAsSkeletonTracing,
        annotation.tracingStore.url,
        editableMapping.tracingId,
        agglomerateId,
        annotation.version,
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
        `Agglomerate tree response does not contain exactly one tree, but ${parsedTracing.trees.length} instead.`,
      );
    }

    // Make sure the tree is named as expected
    parsedTracing.trees[0].name = getTreeNameForAgglomerateTree(agglomerateId, mappingName);
    if (editableMapping && parsedTracing.trees[0].agglomerateInfo?.mappingName != null) {
      // Ensure loaded agglomerate tree has the tracing id set in their agglomerateInfo.
      // In case the matching agglomerate was never modified, the tracingstore asks the datastore which then
      // sets the mappingName in the agglomerate info, but we prefer to have the tracingId set in case
      // an editable mapping tracing exists.
      parsedTracing.trees[0].agglomerateInfo = {
        agglomerateId,
        tracingId: editableMapping.tracingId,
      };
    }

    return parsedTracing;
  } catch (e) {
    // @ts-expect-error
    if (e.messages != null) {
      // Enhance the error message for agglomerates that are too large
      // @ts-expect-error
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
          // @ts-expect-error
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

function* loadAgglomerateTreeWithAtPosition(
  action: LoadAgglomerateTreeFromIdAction | LoadAgglomerateTreeAtPositionAction,
): Saga<void> {
  const allowUpdate = yield* select(mayEditAnnotation);
  if (!allowUpdate) return;
  const { layerName, mappingName } = action;

  if (action.type === "LOAD_AGGLOMERATE_TREE_FROM_ID" && action.agglomerateId === 0) {
    Toast.error(messages["tracing.agglomerate_tree.no_cell"]);
    return;
  }
  const progressCallback = createProgressCallback({
    pauseDelay: 100,
    successMessageDelay: 2000,
  });

  const shouldGuardWithAnnotationMutex = yield* select(
    (state) => state.annotation.collaborationMode === "Concurrent",
  );
  let unsubscribeFromAnnotationMutex = null;
  let hideFn: HideFn | undefined;
  if (shouldGuardWithAnnotationMutex) {
    ({ hideFn } = yield* call(progressCallback, false, `Updating annotation to latest version...`));
    unsubscribeFromAnnotationMutex = yield* call(
      subscribeToAnnotationMutex,
      "Agglomerate Tree Loading",
    );

    // We already sync here to ensure to have the newest annotation version to get an up-to-date agglomerate tree.
    yield* call(dispatchEnsureHasNewestVersionAsync, Store.dispatch);
  }

  const agglomerateId =
    action.type === "LOAD_AGGLOMERATE_TREE_FROM_ID"
      ? action.agglomerateId
      : // Ad-hoc lookup of agglomerate id after syncing in live-collab. Should be preferred over using the LoadAgglomerateTreeFromIdAction action.
        yield call(getSegmentIdForPositionAsync, action.agglomeratePosition);

  const trees = yield* select((state) =>
    getTreesWithType(enforceSkeletonTracing(state.annotation), TreeTypeEnum.AGGLOMERATE),
  );
  const maybeTree = findTreeByAgglomerateId(trees, agglomerateId, layerName, mappingName);

  try {
    if (maybeTree != null) {
      console.warn(
        `Tree for agglomerate ${agglomerateId} with mapping ${mappingName} is already loaded. Its tree name is "${maybeTree.name}".`,
      );
      yield* call(
        progressCallback,
        true,
        `Tree for agglomerate ${agglomerateId} is already present. If it is not in sync with the mapping, please delete and reload it.`,
      );
      return;
    }

    ({ hideFn } = yield* call(
      progressCallback,
      true,
      `Loading tree for agglomerate ${agglomerateId} with mapping ${mappingName}`,
    ));

    let usedTreeIds: number[] | null = null;
    let agglomerateTree: ServerSkeletonTracing;
    let newTree: Tree | undefined;
    agglomerateTree = yield* call(
      getAgglomerateTreeAsSkeletonTracing,
      layerName,
      mappingName,
      agglomerateId,
    );

    yield* put(
      addTreesAndGroupsAction(
        createMutableTreeMapFromTreeArray(agglomerateTree.trees),
        agglomerateTree.treeGroups,
        (newTreeIds) => {
          usedTreeIds = newTreeIds;
        },
      ),
    );

    // @ts-expect-error TS infers usedTreeIds to be never, but it should be number[] if its not null
    if (usedTreeIds == null || usedTreeIds.length !== 1) {
      throw new Error(
        "Assumption violated while adding agglomerate tree. Exactly one tree should have been added.",
      );
    }
    newTree = yield* select((state) =>
      // @ts-expect-error TS infers usedTreeIds to be be potentially null, but this cannot be the case.
      state.annotation.skeleton?.trees.getNullable(usedTreeIds[0]),
    );
    if (!newTree) {
      throw new Error("Could not find the newly loaded agglomerate tree in the annotation.");
    }
  } catch (e) {
    // Hide the progress notification and handle the error
    hideFn?.();
    // @ts-expect-error
    handleAgglomerateLoadingError(e);
    return;
  } finally {
    if (shouldGuardWithAnnotationMutex) {
      // Enforces to directly store the loaded agglomerate tree to the annotation on the server
      // to enforce that all users also have the agglomerate tree present upon the next sync.
      yield* call([Model, Model.ensureSavedState]);
      // Then release the mutex if it was acquired.
      if (unsubscribeFromAnnotationMutex) {
        yield* call(unsubscribeFromAnnotationMutex);
      } else {
        console.warn(
          "Loaded agglomerate tree in live collab mode, but there was no mutex subscription to be released, although this is to be expected.",
        );
      }
    }
  }

  yield* call(progressCallback, true, "Tree generation done.");
}

function* loadConnectomeAgglomerateTreeWithId(action: LoadAgglomerateTreeFromIdAction): Saga<void> {
  const { layerName, mappingName, agglomerateId } = action;

  if (agglomerateId === 0) {
    Toast.error(messages["tracing.agglomerate_tree.no_cell"]);
    return;
  }

  try {
    const parsedTracing = yield* call(
      getAgglomerateTreeAsSkeletonTracing,
      layerName,
      mappingName,
      agglomerateId,
    );
    yield* put(
      addConnectomeTreesAction(createMutableTreeMapFromTreeArray(parsedTracing.trees), layerName),
    );
  } catch (e) {
    // @ts-expect-error
    handleAgglomerateLoadingError(e);
  }
}

function* removeConnectomeAgglomerateTreeWithId(
  action: LoadAgglomerateTreeFromIdAction,
): Saga<void> {
  const { layerName, mappingName, agglomerateId } = action;
  const treeName = getTreeNameForAgglomerateTree(agglomerateId, mappingName);
  const skeleton = yield* select(
    (state) => state.localSegmentationStateByLayer[layerName].connectomeData.skeleton,
  );
  if (skeleton == null) return;
  const { trees } = skeleton;
  const tree = findTreeByName(trees, treeName);
  if (tree) {
    yield* put(deleteConnectomeTreesAction([tree.treeId], layerName));
  }
}

function* watchSkeletonTracingAsync(): Saga<void> {
  yield* takeWithBatchActionSupport("INITIALIZE_SKELETONTRACING");
  yield* takeEvery("WK_INITIALIZED", watchTreeNames);
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
}

function* diffNodes(
  tracingId: string,
  prevNodes: NodeMap,
  nodes: NodeMap,
  treeId: number,
  useDeepEqualityCheck: boolean,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  if (prevNodes === nodes) return;
  const {
    onlyA: deletedNodeIds,
    onlyB: addedNodeIds,
    changed: changedNodeIds,
  } = diffDiffableMaps(prevNodes, nodes, useDeepEqualityCheck);

  for (const nodeId of deletedNodeIds) {
    yield deleteNode(treeId, nodeId, tracingId);
  }

  for (const nodeId of addedNodeIds) {
    const node = nodes.getOrThrow(nodeId);
    yield createNode(treeId, node, tracingId);
  }

  for (const nodeId of changedNodeIds) {
    const node = nodes.getOrThrow(nodeId);
    const prevNode = prevNodes.getOrThrow(nodeId);

    if (updateNodePredicate(prevNode, node)) {
      yield updateNode(treeId, node, tracingId);
    }
  }
}

export function updateNodePredicate(prevNode: Node, node: Node): boolean {
  return !isEqual(prevNode, node);
}

function* diffEdges(
  tracingId: string,
  prevEdges: EdgeCollection,
  edges: EdgeCollection,
  treeId: number,
  useDeepEqualityCheck: boolean,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  if (prevEdges === edges) return;
  const { onlyA: deletedEdges, onlyB: addedEdges } = diffEdgeCollections(
    prevEdges,
    edges,
    useDeepEqualityCheck,
  );

  for (const edge of deletedEdges) {
    yield deleteEdge(treeId, edge.source, edge.target, tracingId);
  }

  for (const edge of addedEdges) {
    yield createEdge(treeId, edge.source, edge.target, tracingId);
  }
}

function updateTreePredicate(prevTree: Tree, tree: Tree, useDeepEqualityCheck: boolean): boolean {
  const doPrimitivesDiffer =
    prevTree.name !== tree.name ||
    prevTree.timestamp !== tree.timestamp ||
    prevTree.groupId !== tree.groupId ||
    prevTree.type !== tree.type ||
    prevTree.agglomerateInfo?.agglomerateId !== tree.agglomerateInfo?.agglomerateId ||
    prevTree.agglomerateInfo?.tracingId !== tree.agglomerateInfo?.tracingId ||
    prevTree.agglomerateInfo?.mappingName !== tree.agglomerateInfo?.mappingName;

  if (doPrimitivesDiffer) {
    return true;
  }
  // In case of a deep diff, also diff the color and metadata deeply, which is not needed for shallow diffing.
  const doesMetadataOrColorDiffer = useDeepEqualityCheck
    ? !isEqual(prevTree.color, tree.color) || !isEqual(prevTree.metadata, tree.metadata)
    : prevTree.color !== tree.color || prevTree.metadata !== tree.metadata;
  if (doesMetadataOrColorDiffer) {
    return true;
  }
  // branchPoints and comments are arrays and therefore checked for
  // equality. This avoids unnecessary updates in certain cases (e.g.,
  // when two trees are merged, the comments are concatenated, even
  // if one of them is empty; thus, resulting in new instances).
  const doArraysDiffer =
    !isEqual(prevTree.branchPoints, tree.branchPoints) ||
    !isEqual(prevTree.comments, tree.comments);
  return doArraysDiffer;
}

export function* diffTrees(
  tracingId: string,
  prevTrees: TreeMap,
  trees: TreeMap,
  useDeepEqualityCheck: boolean,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  if (prevTrees === trees) return;
  const {
    changed: bothTreeIds,
    onlyA: deletedTreeIds,
    onlyB: addedTreeIds,
  } = diffDiffableMaps(prevTrees, trees, useDeepEqualityCheck);

  for (const treeId of deletedTreeIds) {
    const prevTree = prevTrees.getOrThrow(treeId);
    yield* diffNodes(tracingId, prevTree.nodes, new DiffableMap(), treeId, useDeepEqualityCheck);
    yield* diffEdges(tracingId, prevTree.edges, new EdgeCollection(), treeId, useDeepEqualityCheck);
    yield deleteTree(treeId, tracingId);
  }

  for (const treeId of addedTreeIds) {
    const tree = trees.getOrThrow(treeId);
    yield createTree(tree, tracingId);
    yield* diffNodes(tracingId, new DiffableMap(), tree.nodes, treeId, useDeepEqualityCheck);
    yield* diffEdges(tracingId, new EdgeCollection(), tree.edges, treeId, useDeepEqualityCheck);
  }

  for (const treeId of bothTreeIds) {
    const tree = trees.getOrThrow(treeId);
    const prevTree: Tree = prevTrees.getOrThrow(treeId);

    if (tree !== prevTree) {
      yield* diffNodes(tracingId, prevTree.nodes, tree.nodes, treeId, useDeepEqualityCheck);
      yield* diffEdges(tracingId, prevTree.edges, tree.edges, treeId, useDeepEqualityCheck);

      if (updateTreePredicate(prevTree, tree, useDeepEqualityCheck)) {
        yield updateTree(tree, tracingId);
      }

      if (prevTree.isVisible !== tree.isVisible) {
        yield updateTreeVisibility(tree, tracingId);
      }
      if (prevTree.edgesAreVisible !== tree.edgesAreVisible) {
        yield updateTreeEdgesVisibility(tree, tracingId);
      }
    }
  }
}

export const cachedDiffTrees = memoizeOne(
  (tracingId: string, prevTrees: TreeMap, trees: TreeMap, useDeepEqualityCheck: boolean) =>
    Array.from(diffTrees(tracingId, prevTrees, trees, useDeepEqualityCheck)),
);

export function* diffSkeletonTracing(
  prevSkeletonTracing: SkeletonTracing,
  skeletonTracing: SkeletonTracing,
  useDeepEqualityCheck: boolean = false,
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  if (prevSkeletonTracing === skeletonTracing) {
    return;
  }
  yield* cachedDiffTrees(
    skeletonTracing.tracingId,
    prevSkeletonTracing.trees,
    skeletonTracing.trees,
    useDeepEqualityCheck,
  );

  const groupDiff = diffGroups(prevSkeletonTracing.treeGroups, skeletonTracing.treeGroups);

  if (groupDiff.didContentChange) {
    // The groups (without isExpanded) actually changed. Save them to the server.
    yield updateTreeGroups(skeletonTracing.treeGroups, skeletonTracing.tracingId);
  }

  if (groupDiff.newlyExpandedIds.length > 0) {
    yield updateTreeGroupsExpandedState(
      groupDiff.newlyExpandedIds,
      true,
      skeletonTracing.tracingId,
    );
  }
  if (groupDiff.newlyNotExpandedIds.length > 0) {
    yield updateTreeGroupsExpandedState(
      groupDiff.newlyNotExpandedIds,
      false,
      skeletonTracing.tracingId,
    );
  }

  const { activeNodeId } = skeletonTracing;
  if (prevSkeletonTracing.activeNodeId !== activeNodeId) {
    yield updateActiveNode(skeletonTracing);
  } else if (activeNodeId != null) {
    // Even though the active node itself is unchanged, its containing tree might
    // have changed (e.g., due to a tree split or merge). In that case, an
    // updateActiveNode action is emitted, too, so that replaying the update
    // actions (e.g., during a rebase in live collaboration mode) restores the
    // active node even if it was expressed via deleteNode/createNode actions.
    // Also, applying the action keeps the user-local activeTreeId in sync.
    const prevActiveTree = findTreeByNodeId(prevSkeletonTracing.trees, activeNodeId);
    const activeTree = findTreeByNodeId(skeletonTracing.trees, activeNodeId);
    if (prevActiveTree?.treeId !== activeTree?.treeId) {
      yield updateActiveNode(skeletonTracing);
    }
  }

  yield* diffBoundingBoxes(
    prevSkeletonTracing.userBoundingBoxes,
    skeletonTracing.userBoundingBoxes,
    skeletonTracing.tracingId,
    AnnotationLayerEnum.Skeleton,
  );
}
export default [
  watchSkeletonTracingAsync,
  watchAgglomerateLoading,
  watchConnectomeAgglomerateLoading,
];
