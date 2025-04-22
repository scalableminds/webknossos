import Maybe from "data.maybe";
import update from "immutability-helper";
import ColorGenerator from "libs/color_generator";
import DiffableMap from "libs/diffable_map";
import { V3 } from "libs/mjs";
import * as Utils from "libs/utils";
import _ from "lodash";
import { type TreeType, TreeTypeEnum, type Vector3 } from "oxalis/constants";
import Constants, { NODE_ID_REF_REGEX } from "oxalis/constants";
import {
  findTreeByNodeId,
  getActiveNodeFromTree,
  getActiveTree,
  getActiveTreeGroup,
  getSkeletonTracing,
  getTree,
  mapGroups,
  mapGroupsToGenerator,
} from "oxalis/model/accessors/skeletontracing_accessor";
import EdgeCollection from "oxalis/model/edge_collection";
import type {
  BranchPoint,
  CommentType,
  Edge,
  MutableBranchPoint,
  MutableCommentType,
  MutableNode,
  MutableNodeMap,
  MutableTree,
  MutableTreeGroup,
  MutableTreeMap,
  Node,
  OxalisState,
  RestrictionsAndSettings,
  SkeletonTracing,
  Tree,
  TreeGroup,
  TreeMap,
} from "oxalis/store";
import type {
  MetadataEntryProto,
  ServerBranchPoint,
  ServerNode,
  ServerSkeletonTracingTree,
} from "types/api_flow_types";
import type { AdditionalCoordinate } from "types/api_flow_types";

export function generateTreeName(state: OxalisState, timestamp: number, treeId: number) {
  let user = "";

  if (state.activeUser) {
    user = `${state.activeUser.firstName}_${state.activeUser.lastName}`;
    user = user.replace(/ /g, "_"); // Replace spaces in user names
  }

  let prefix = "Tree";

  if (state.annotation.annotationType === "Explorational") {
    // Get YYYY-MM-DD string
    const creationDate = new Date(timestamp).toJSON().slice(0, 10);
    prefix = `explorative_${creationDate}_${user}_`;
  } else if (state.task) {
    prefix = `task_${state.task.id}_${user}_`;
  }

  return `${prefix}${Utils.zeroPad(treeId, 3)}`;
}
function getMinimumNodeId(trees: TreeMap | MutableTreeMap): number {
  const minNodeId = _.min(_.flatMap(trees, (tree) => tree.nodes.map((n) => n.id)));

  return minNodeId != null ? minNodeId : Constants.MIN_NODE_ID;
}
export function getMaximumNodeId(trees: TreeMap | MutableTreeMap): number {
  const newMaxNodeId = _.max(_.flatMap(trees, (tree) => tree.nodes.map((n) => n.id)));

  return newMaxNodeId != null ? newMaxNodeId : Constants.MIN_NODE_ID - 1;
}
export function getMaximumTreeId(trees: TreeMap | MutableTreeMap): number {
  const maxTreeId = _.max(_.map(trees, "treeId"));

  return maxTreeId != null ? maxTreeId : Constants.MIN_TREE_ID - 1;
}

function getNearestTreeId(treeId: number, trees: TreeMap): number {
  const sortedTreeIds = Object.keys(trees)
    .map((currentTreeId) => Number.parseInt(currentTreeId))
    .sort((firstId, secId) => (firstId > secId ? 1 : -1));

  if (sortedTreeIds.length === 0) {
    return 0;
  }

  // Uses a binary search to determine the lowest index at which treeId should be inserted into sortedTreeIds in order to maintain its sort order.
  // This corresponds to the original index of the deleted treeId.
  const originalIndex = _.sortedIndex(sortedTreeIds, treeId);

  const higherOrNearestId = Math.min(originalIndex, sortedTreeIds.length - 1);
  return sortedTreeIds[higherOrNearestId];
}

export function getMaximumGroupId(groups: Array<TreeGroup>): number {
  const maxGroupId = _.max(Array.from(mapGroupsToGenerator(groups, (group) => group.groupId)));

  return maxGroupId != null && maxGroupId >= 0 ? maxGroupId : 0;
}

export function forEachGroups(groups: Array<TreeGroup>, callback: (arg0: TreeGroup) => any) {
  for (const group of groups) {
    callback(group);

    if (group.children) {
      forEachGroups(group.children, callback);
    }
  }
}

export function createNode(
  state: OxalisState,
  skeletonTracing: SkeletonTracing,
  tree: Tree,
  positionFloat: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null,
  rotation: Vector3,
  viewport: number,
  mag: number,
  timestamp: number,
): Maybe<[Node, EdgeCollection]> {
  const activeNodeMaybe = getActiveNodeFromTree(skeletonTracing, tree);

  if (activeNodeMaybe.isNothing && tree.nodes.size() !== 0) {
    console.error("Couldn't create a node in non-empty tree, because there is no active node.");
    return Maybe.Nothing();
  }

  // Use the same radius as current active node or revert to default value
  const radius = activeNodeMaybe
    .map((activeNode) => activeNode.radius)
    .getOrElse(Constants.DEFAULT_NODE_RADIUS);
  // Find new node id by increasing the max node id.
  const nextNewId = skeletonTracing.cachedMaxNodeId + 1;
  const position = V3.trunc(positionFloat);
  // Create the new node
  const node: Node = {
    untransformedPosition: position,
    additionalCoordinates,
    radius,
    rotation,
    viewport,
    mag,
    id: nextNewId,
    timestamp,
    bitDepth: state.datasetConfiguration.fourBit ? 4 : 8,
    interpolation: state.datasetConfiguration.interpolation,
  };
  // Create a new edge
  const edges = activeNodeMaybe
    .map((activeNode) => {
      const newEdge = {
        source: activeNode.id,
        target: nextNewId,
      };
      return tree.edges.addEdge(newEdge);
    })
    .getOrElse(tree.edges);
  return Maybe.Just([node, edges]);
}
export function deleteNode(
  state: OxalisState,
  tree: Tree,
  node: Node,
  timestamp: number,
): Maybe<[TreeMap, number, number | null | undefined, number]> {
  return getSkeletonTracing(state.annotation).chain((skeletonTracing) => {
    // Delete node and possible branchpoints/comments
    const activeTree = update(tree, {
      nodes: {
        $apply: (nodes) => nodes.delete(node.id),
      },
      comments: {
        $apply: (comments: CommentType[]) =>
          comments.filter((comment) => comment.nodeId !== node.id),
      },
      branchPoints: {
        $apply: (branchPoints: BranchPoint[]) =>
          branchPoints.filter((branchPoint) => branchPoint.nodeId !== node.id),
      },
    });
    // Do we need to split trees? Are there edges leading to/from it?
    const neighborIds = [];
    const deletedEdges = activeTree.edges.getEdgesForNode(node.id);

    for (const edge of deletedEdges) {
      neighborIds.push(edge.target === node.id ? edge.source : edge.target);
    }

    const newTrees = splitTreeByNodes(
      state,
      skeletonTracing,
      activeTree,
      neighborIds,
      deletedEdges,
      timestamp,
    );
    // If the deleted node had the max id, find the new largest id
    let newMaxNodeId = skeletonTracing.cachedMaxNodeId;

    if (node.id === newMaxNodeId) {
      newMaxNodeId = getMaximumNodeId(newTrees);
    }

    const newActiveNodeId = neighborIds.length > 0 ? Math.min(...neighborIds) : null;
    const newActiveTree =
      newActiveNodeId != null ? findTreeByNodeId(newTrees, newActiveNodeId) : activeTree;
    if (newActiveTree == null) {
      throw new Error(`Could not find node with id ${newActiveNodeId}`);
    }
    const newActiveTreeId = newActiveTree.treeId;
    return Maybe.Just([newTrees, newActiveTreeId, newActiveNodeId, newMaxNodeId]);
  });
}
export function deleteEdge(
  state: OxalisState,
  sourceTree: Tree,
  sourceNode: Node,
  targetTree: Tree,
  targetNode: Node,
  timestamp: number,
): Maybe<[TreeMap, number | null | undefined]> {
  return getSkeletonTracing(state.annotation).chain((skeletonTracing) => {
    if (sourceTree.treeId !== targetTree.treeId) {
      // The two selected nodes are in different trees
      console.error(
        "Tried to delete an edge that was not there, the two nodes are in different trees.",
      );
      return Maybe.Nothing();
    }

    const deletedEdge = sourceTree.edges
      .getEdgesForNode(sourceNode.id)
      .find((edge) => edge.target === targetNode.id || edge.source === targetNode.id);

    if (deletedEdge == null) {
      // The two selected nodes do not share an edge
      console.error("Tried to delete an edge that was not there.");
      return Maybe.Nothing();
    }

    const newTrees = splitTreeByNodes(
      state,
      skeletonTracing,
      sourceTree,
      [sourceNode.id, targetNode.id],
      [deletedEdge],
      timestamp,
    );
    // The treeId of the tree the active node belongs to could have changed
    const activeNodeId = skeletonTracing.activeNodeId;
    const newActiveTreeId = activeNodeId ? findTreeByNodeId(newTrees, activeNodeId)?.treeId : null;
    return Maybe.Just([newTrees, newActiveTreeId]);
  });
}

function splitTreeByNodes(
  state: OxalisState,
  skeletonTracing: SkeletonTracing,
  activeTree: Tree,
  newTreeRootIds: Array<number>,
  deletedEdges: Array<Edge>,
  timestamp: number,
): TreeMap {
  // This function splits a given tree by deleting the given edges and making the
  // given node ids the new tree roots.
  // Not every node id is guaranteed to be a new tree root as there may be cyclic trees.
  let newTrees = skeletonTracing.trees;

  if (newTreeRootIds.length === 0) {
    // As there are no new tree root ids, we are deleting the last node from a tree.
    // It suffices to simply update that tree within the tree collection
    return update(newTrees, {
      [activeTree.treeId]: {
        $set: activeTree,
      },
    });
  }

  // Traverse from each possible new root node in all directions (i.e., use each edge) and
  // remember which edges were already visited.
  const visitedEdges: Record<string, boolean> = {};

  const getEdgeHash = (edge: Edge) => `${edge.source}-${edge.target}`;

  const visitedNodes: Record<number, boolean> = {};
  // Mark deletedEdges as visited, so they are not traversed.
  deletedEdges.forEach((deletedEdge) => {
    visitedEdges[getEdgeHash(deletedEdge)] = true;
  });

  const traverseTree = (inputNodeId: number, newTree: Tree) => {
    const nodeQueue = [inputNodeId];

    while (nodeQueue.length !== 0) {
      const nodeId = nodeQueue.shift();
      if (nodeId == null) {
        throw new Error("Satisfy typescript");
      }
      // ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number | undefined' is not assig... Remove this comment to see the full error message
      const edges = activeTree.edges.getEdgesForNode(nodeId);
      visitedNodes[nodeId] = true;
      newTree.nodes.mutableSet(nodeId, activeTree.nodes.getOrThrow(nodeId));

      for (const edge of edges) {
        const edgeHash = getEdgeHash(edge);

        if (visitedEdges[edgeHash]) {
          continue;
        }

        visitedEdges[edgeHash] = true;
        newTree.edges.addEdge(edge, true);

        if (nodeId === edge.target) {
          nodeQueue.push(edge.source);
        } else {
          nodeQueue.push(edge.target);
        }
      }
    }
  };

  // The intermediateState is used for the createTree function, which takes
  // care of generating non-colliding tree names, ids and colors
  let intermediateState = state;

  // For each new tree root create a new tree
  const cutTrees: MutableTree[] = _.compact(
    // Sort the treeRootIds, so the tree connected to the node with the lowest id will remain the original tree (treeId, name, timestamp)
    newTreeRootIds
      .slice()
      .sort((a, b) => a - b)
      .map((rootNodeId, index) => {
        // The rootNodeId could have already been traversed from another rootNodeId
        // as there are cyclic trees
        // In this case we do not need to create a new tree for this rootNodeId

        if (visitedNodes[rootNodeId] === true) {
          return null;
        }

        let newTree: MutableTree | null;

        if (index === 0) {
          // Reuse the properties of the original tree for the first tree
          newTree = {
            branchPoints: [],
            color: activeTree.color,
            comments: [],
            edges: new EdgeCollection(),
            name: activeTree.name,
            nodes: new DiffableMap(),
            timestamp: activeTree.timestamp,
            treeId: activeTree.treeId,
            isVisible: true,
            groupId: activeTree.groupId,
            type: activeTree.type,
            edgesAreVisible: true,
            metadata: activeTree.metadata,
          };
        } else {
          const immutableNewTree = createTree(
            intermediateState,
            timestamp,
            true,
            undefined,
            activeTree.type,
          ).get();
          // Cast to mutable tree type since we want to mutably do the split
          // in this reducer for performance reasons.
          newTree = immutableNewTree as any as Tree;
          intermediateState = update(intermediateState, {
            annotation: {
              skeleton: {
                trees: {
                  [newTree.treeId]: {
                    $set: newTree,
                  },
                },
              },
            },
          });
        }

        traverseTree(rootNodeId, newTree);
        return newTree;
      }),
  );

  // Write branchpoints into correct trees
  activeTree.branchPoints.forEach((branchpoint) => {
    cutTrees.forEach((newTree) => {
      if (newTree.nodes.has(branchpoint.nodeId)) {
        newTree.branchPoints.push(branchpoint);
      }
    });
  });
  // Write comments into correct trees
  activeTree.comments.forEach((comment) => {
    cutTrees.forEach((newTree) => {
      if (newTree.nodes.has(comment.nodeId)) {
        newTree.comments.push(comment);
      }
    });
  });
  newTrees = skeletonTracing.trees;
  cutTrees.forEach((cutTree) => {
    newTrees = update(newTrees, {
      [cutTree.treeId]: {
        $set: cutTree,
      },
    });
  });
  return newTrees;
}

export function createBranchPoint(
  tree: Tree,
  node: Node,
  timestamp: number,
  restrictions: RestrictionsAndSettings,
): Maybe<BranchPoint> {
  const { branchPointsAllowed } = restrictions;
  if (!branchPointsAllowed) return Maybe.Nothing();

  const doesBranchPointExistAlready = _.some(
    tree.branchPoints,
    (branchPoint) => branchPoint.nodeId === node.id,
  );

  if (!doesBranchPointExistAlready) {
    // create new branchpoint
    return Maybe.Just({
      nodeId: node.id,
      timestamp,
    });
  }

  return Maybe.Nothing();
}
export function deleteBranchPoint(
  skeletonTracing: SkeletonTracing,
  restrictions: RestrictionsAndSettings,
): Maybe<[Array<BranchPoint>, number, number]> {
  const { branchPointsAllowed } = restrictions;
  const { trees } = skeletonTracing;

  const hasBranchPoints = _.some(_.map(trees, (tree) => !_.isEmpty(tree.branchPoints)));

  if (!branchPointsAllowed || !hasBranchPoints) return Maybe.Nothing();

  // Find most recent branchpoint across all trees
  const treesWithBranchPoints = _.values(trees).filter((tree) => !_.isEmpty(tree.branchPoints));

  const treeWithLastBranchpoint = _.maxBy(
    treesWithBranchPoints,
    (tree) =>
      // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
      _.last(tree.branchPoints).timestamp,
  );
  if (treeWithLastBranchpoint == null) {
    return Maybe.Nothing();
  }
  const { treeId } = treeWithLastBranchpoint;
  const branchPoint = _.last(trees[treeId].branchPoints);

  if (branchPoint) {
    // Delete branchpoint
    const newBranchPoints = _.without(skeletonTracing.trees[treeId].branchPoints, branchPoint);

    return Maybe.Just([newBranchPoints, treeId, branchPoint.nodeId]);
  }

  return Maybe.Nothing();
}
export function createTree(
  state: OxalisState,
  timestamp: number,
  addToActiveGroup: boolean = true,
  name?: string,
  type: TreeType = TreeTypeEnum.DEFAULT,
  edgesAreVisible: boolean = true,
  metadata: MetadataEntryProto[] = [],
): Maybe<Tree> {
  return getSkeletonTracing(state.annotation).chain((skeletonTracing) => {
    // Create a new tree id and name
    const newTreeId = getMaximumTreeId(skeletonTracing.trees) + 1;
    const newTreeName = name || generateTreeName(state, timestamp, newTreeId);
    let groupId = null;

    if (addToActiveGroup) {
      const groupIdOfActiveTree = getActiveTree(skeletonTracing)?.groupId;
      const groupIdOfActiveGroupMaybe = getActiveTreeGroup(skeletonTracing).map(
        (group) => group.groupId,
      );
      groupId = groupIdOfActiveTree ?? Utils.toNullable(groupIdOfActiveGroupMaybe);
    }

    // Create the new tree
    const tree: Tree = {
      name: newTreeName,
      treeId: newTreeId,
      nodes: new DiffableMap(),
      timestamp,
      color: ColorGenerator.distinctColorForId(newTreeId),
      branchPoints: [],
      edges: new EdgeCollection(),
      comments: [],
      isVisible: true,
      groupId,
      type,
      edgesAreVisible,
      metadata,
    };
    return Maybe.Just(tree);
  });
}
export function getOrCreateTree(
  state: OxalisState,
  skeletonTracing: SkeletonTracing,
  treeId: number | null | undefined,
  timestamp: number,
  type?: TreeType | null | undefined,
): Maybe<Tree> {
  return getTree(skeletonTracing, treeId, type).orElse(() => {
    // Only create a new tree if there are no trees
    // Specifically, this means that no new tree is created just because
    // the activeTreeId is temporarily null
    if (_.size(skeletonTracing.trees) === 0) {
      return createTree(state, timestamp);
    }

    return Maybe.Nothing();
  });
}
export function ensureTreeNames(state: OxalisState, trees: MutableTreeMap) {
  // Assign a new tree name for trees without a name
  for (const tree of Utils.values(trees)) {
    if (tree.name === "") {
      tree.name = generateTreeName(state, tree.timestamp, tree.treeId);
    }
  }

  return trees;
}
export function addTreesAndGroups(
  skeletonTracing: SkeletonTracing,
  trees: MutableTreeMap,
  treeGroups: Array<MutableTreeGroup>,
): Maybe<[MutableTreeMap, Array<TreeGroup>, number]> {
  const treeIds = Object.keys(trees).map((treeId) => Number(treeId));
  const hasInvalidTreeIds = treeIds.some(
    (treeId) => treeId < Constants.MIN_TREE_ID || treeId > Constants.MAX_TREE_ID,
  );
  const hasInvalidNodeIds = getMinimumNodeId(trees) < Constants.MIN_NODE_ID;
  const needsReassignedIds =
    Object.keys(skeletonTracing.trees).length > 0 ||
    skeletonTracing.treeGroups.length > 0 ||
    hasInvalidTreeIds ||
    hasInvalidNodeIds;

  if (!needsReassignedIds) {
    // Without reassigning ids, the code is considerably faster.
    const newMaxNodeId = getMaximumNodeId(trees);
    return Maybe.Just([trees, treeGroups, newMaxNodeId]);
  }

  const groupIdMap: Record<number, number> = {};
  let nextGroupId = getMaximumGroupId(skeletonTracing.treeGroups) + 1;
  forEachGroups(treeGroups, (group: MutableTreeGroup) => {
    // Assign new group ids for all groups
    groupIdMap[group.groupId] = nextGroupId;
    group.groupId = nextGroupId;
    nextGroupId++;
  });
  // Assign new ids for all nodes and trees to avoid duplicates
  let newTreeId = getMaximumTreeId(skeletonTracing.trees) + 1;
  let newNodeId = skeletonTracing.cachedMaxNodeId + 1;
  // Create a map from old node ids to new node ids
  // This needs to be done in advance to replace nodeId references in comments
  const idMap: Record<number, number> = {};

  for (const tree of _.values(trees)) {
    for (const node of tree.nodes.values()) {
      idMap[node.id] = newNodeId++;
    }
  }

  const newTrees: MutableTreeMap = {};

  for (const treeId of treeIds) {
    const tree = trees[treeId];
    const newNodes: MutableNodeMap = new DiffableMap();

    for (const node of tree.nodes.values()) {
      node.id = idMap[node.id];
      newNodes.mutableSet(node.id, node);
    }

    tree.nodes = newNodes;
    tree.edges = EdgeCollection.loadFromArray(
      tree.edges.map((edge) => ({
        source: idMap[edge.source],
        target: idMap[edge.target],
      })),
    );

    for (const comment of tree.comments) {
      // Comments can reference other nodes, rewrite those references if the referenced id changed
      comment.nodeId = idMap[comment.nodeId];
      comment.content = comment.content.replace(
        NODE_ID_REF_REGEX,
        (__, p1) => `#${idMap[Number(p1)] != null ? idMap[Number(p1)] : p1}`,
      );
    }

    for (const bp of tree.branchPoints) {
      bp.nodeId = idMap[bp.nodeId];
    }

    // Assign the new group id to the tree if the tree belongs to a group
    tree.groupId = tree.groupId != null ? groupIdMap[tree.groupId] : tree.groupId;
    tree.treeId = newTreeId;
    newTrees[tree.treeId] = tree;
    newTreeId++;
  }

  return Maybe.Just([newTrees, treeGroups, newNodeId - 1]);
}
export function deleteTrees(
  skeletonTracing: SkeletonTracing,
  treeIds: number[],
  suppressActivatingNextNode: boolean = false,
): Maybe<[TreeMap, number | null | undefined, number | null | undefined, number]> {
  if (treeIds.length === 0) return Maybe.Nothing();
  // Delete trees
  const newTrees = _.omit(skeletonTracing.trees, treeIds);

  let newActiveTreeId = null;
  let newActiveNodeId = null;

  if (_.size(newTrees) > 0 && !suppressActivatingNextNode) {
    // Setting the tree active whose id is the next highest compared to the ids of the deleted trees.
    const maximumTreeId = _.max(treeIds) || Constants.MIN_TREE_ID;
    newActiveTreeId = getNearestTreeId(maximumTreeId, newTrees);
    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
    newActiveNodeId = +_.first(Array.from(newTrees[newActiveTreeId].nodes.keys())) || null;
  }

  const newMaxNodeId = getMaximumNodeId(newTrees);
  return Maybe.Just([newTrees, newActiveTreeId, newActiveNodeId, newMaxNodeId]);
}
export function mergeTrees(
  trees: TreeMap,
  sourceNodeId: number,
  targetNodeId: number,
  treeType: TreeType,
): [TreeMap, number, number] | null {
  // targetTree will be removed (the content will be merged into sourceTree).
  const sourceTree = findTreeByNodeId(trees, sourceNodeId); // should be activeTree, so that the active tree "survives"
  const targetTree = findTreeByNodeId(trees, targetNodeId);

  if (
    targetTree == null ||
    sourceTree == null ||
    targetTree === sourceTree ||
    sourceTree.type !== treeType ||
    targetTree.type !== treeType
  ) {
    return null;
  }

  const newEdge: Edge = {
    source: sourceNodeId,
    target: targetNodeId,
  };

  let newTrees = _.omit(trees, targetTree.treeId);

  const newNodes = sourceTree.nodes.clone();

  for (const [id, node] of targetTree.nodes.entries()) {
    newNodes.mutableSet(id, node);
  }

  newTrees = update(newTrees, {
    [sourceTree.treeId]: {
      nodes: {
        $set: newNodes,
      },
      edges: {
        $set: sourceTree.edges.addEdges(targetTree.edges.asArray().concat(newEdge)),
      },
      comments: {
        $set: sourceTree.comments.concat(targetTree.comments),
      },
      branchPoints: {
        $set: sourceTree.branchPoints.concat(targetTree.branchPoints),
      },
    },
  });
  return [newTrees, sourceTree.treeId, sourceNodeId];
}
export function shuffleTreeColor(
  skeletonTracing: SkeletonTracing,
  tree: Tree,
): Maybe<[Tree, number]> {
  const randomId = _.random(0, 10000, false);

  return setTreeColorIndex(skeletonTracing, tree, randomId);
}
export function setTreeColorIndex(
  _skeletonTracing: SkeletonTracing,
  tree: Tree,
  colorIndex: number,
): Maybe<[Tree, number]> {
  const newTree = update(tree, {
    color: {
      $set: ColorGenerator.distinctColorForId(colorIndex),
    },
  });
  return Maybe.Just([newTree, tree.treeId]);
}
export function createComment(
  _skeletonTracing: SkeletonTracing,
  tree: Tree,
  node: Node,
  commentText: string,
): Maybe<Array<CommentType>> {
  // Gather all comments other than the activeNode's comments
  const { comments } = tree;
  const commentsWithoutActiveNodeComment = comments.filter((comment) => comment.nodeId !== node.id);
  const newComment: CommentType = {
    nodeId: node.id,
    content: commentText,
  };
  const newComments = commentsWithoutActiveNodeComment.concat([newComment]);
  return Maybe.Just(newComments);
}
export function deleteComment(
  _skeletonTracing: SkeletonTracing,
  tree: Tree,
  node: Node,
): Maybe<Array<CommentType>> {
  const { comments } = tree;
  const commentsWithoutActiveNodeComment = comments.filter((comment) => comment.nodeId !== node.id);
  return Maybe.Just(commentsWithoutActiveNodeComment);
}
export function toggleAllTreesReducer(
  state: OxalisState,
  skeletonTracing: SkeletonTracing,
): OxalisState {
  // Let's make all trees visible if there is one invisible tree
  const shouldBecomeVisible = _.values(skeletonTracing.trees).some((tree) => !tree.isVisible);

  const isVisibleUpdater = {
    isVisible: {
      $set: shouldBecomeVisible,
    },
  };
  const updateTreeObject: Record<string, typeof isVisibleUpdater> = {};
  Object.keys(skeletonTracing.trees).forEach((treeId) => {
    updateTreeObject[treeId] = isVisibleUpdater;
  });
  return update(state, {
    annotation: {
      skeleton: {
        trees: updateTreeObject,
      },
    },
  });
}
export function toggleTreeGroupReducer(
  state: OxalisState,
  skeletonTracing: SkeletonTracing,
  groupId: number,
  targetVisibility?: boolean,
): OxalisState {
  let toggledGroup;
  forEachGroups(skeletonTracing.treeGroups, (group) => {
    if (group.groupId === groupId) toggledGroup = group;
  });
  if (toggledGroup == null) return state;
  // Assemble a list that contains the toggled groupId and the groupIds of all child groups
  const affectedGroupIds = new Set(mapGroupsToGenerator([toggledGroup], (group) => group.groupId));
  // Let's make all trees visible if there is one invisible tree in one of the affected groups
  const shouldBecomeVisible =
    targetVisibility != null
      ? targetVisibility
      : _.values(skeletonTracing.trees).some(
          (tree) =>
            typeof tree.groupId === "number" &&
            affectedGroupIds.has(tree.groupId) &&
            !tree.isVisible,
        );
  const isVisibleUpdater = {
    isVisible: {
      $set: shouldBecomeVisible,
    },
  };
  const updateTreeObject: Record<string, typeof isVisibleUpdater> = {};

  _.values(skeletonTracing.trees).forEach((tree) => {
    if (typeof tree.groupId === "number" && affectedGroupIds.has(tree.groupId)) {
      updateTreeObject[tree.treeId] = isVisibleUpdater;
    }
  });

  return update(state, {
    annotation: {
      skeleton: {
        trees: updateTreeObject,
      },
    },
  });
}

export function setExpandedTreeGroups(
  state: OxalisState,
  shouldBeExpanded: (arg: TreeGroup) => boolean,
): OxalisState {
  const currentTreeGroups = state.annotation?.skeleton?.treeGroups;
  if (currentTreeGroups == null) {
    return state;
  }
  const newGroups = mapGroups(currentTreeGroups, (group) => {
    const updatedIsExpanded = shouldBeExpanded(group);
    if (updatedIsExpanded !== group.isExpanded) {
      return { ...group, isExpanded: updatedIsExpanded };
    } else {
      return group;
    }
  });

  return update(state, {
    annotation: {
      skeleton: {
        treeGroups: {
          $set: newGroups,
        },
      },
    },
  });
}

function serverNodeToMutableNode(n: ServerNode): MutableNode {
  return {
    id: n.id,
    untransformedPosition: Utils.point3ToVector3(n.position),
    additionalCoordinates: n.additionalCoordinates,
    rotation: Utils.point3ToVector3(n.rotation),
    bitDepth: n.bitDepth,
    viewport: n.viewport,
    mag: n.mag,
    radius: n.radius,
    timestamp: n.createdTimestamp,
    interpolation: n.interpolation,
  };
}

function serverBranchPointToMutableBranchPoint(b: ServerBranchPoint): MutableBranchPoint {
  return {
    timestamp: b.createdTimestamp,
    nodeId: b.nodeId,
  };
}

export function createMutableTreeMapFromTreeArray(
  trees: Array<ServerSkeletonTracingTree>,
): MutableTreeMap {
  return _.keyBy(
    trees.map(
      (tree): MutableTree => ({
        comments: tree.comments as any as Array<MutableCommentType>,
        edges: EdgeCollection.loadFromArray(tree.edges),
        name: tree.name,
        treeId: tree.treeId,
        nodes: new DiffableMap(
          tree.nodes.map(serverNodeToMutableNode).map((node) => [node.id, node]),
        ),
        color:
          tree.color != null
            ? Utils.colorObjectToRGBArray(tree.color)
            : ColorGenerator.distinctColorForId(tree.treeId),
        branchPoints: _.map(tree.branchPoints, serverBranchPointToMutableBranchPoint),
        isVisible: tree.isVisible != null ? tree.isVisible : true,
        timestamp: tree.createdTimestamp,
        groupId: tree.groupId,
        type: tree.type != null ? tree.type : TreeTypeEnum.DEFAULT,
        edgesAreVisible: tree.edgesAreVisible != null ? tree.edgesAreVisible : true,
        metadata: tree.metadata,
      }),
    ),
    "treeId",
  );
}
export function createTreeMapFromTreeArray(trees: Array<ServerSkeletonTracingTree>): TreeMap {
  return createMutableTreeMapFromTreeArray(trees) as any as TreeMap;
}
export function removeMissingGroupsFromTrees(
  skeletonTracing: SkeletonTracing,
  treeGroups: Array<TreeGroup>,
): TreeMap {
  // Change the groupId of trees for groups that no longer exist
  const groupIds = new Set(mapGroupsToGenerator(treeGroups, (group) => group.groupId));
  const changedTrees: TreeMap = {};
  Object.keys(skeletonTracing.trees).forEach((treeId) => {
    const tree = skeletonTracing.trees[Number(treeId)];

    if (tree.groupId != null && !groupIds.has(tree.groupId)) {
      // @ts-expect-error ts-migrate(7015) FIXME: Element implicitly has an 'any' type because index... Remove this comment to see the full error message
      changedTrees[treeId] = { ...tree, groupId: null };
    }
  });
  return changedTrees;
}
export function extractPathAsNewTree(
  state: OxalisState,
  sourceTree: Tree,
  pathOfNodeIds: number[],
): Maybe<Tree> {
  return createTree(
    state,
    Date.now(),
    true,
    `Path from node ${pathOfNodeIds[0]} to ${pathOfNodeIds[pathOfNodeIds.length - 1]}`,
  ).map((newTree) => {
    let lastNodeId = null;
    for (const nodeId of pathOfNodeIds) {
      const node: MutableNode = { ...sourceTree.nodes.getOrThrow(nodeId) };
      newTree.nodes.mutableSet(nodeId, node);
      if (lastNodeId != null) {
        const newEdge: Edge = {
          source: lastNodeId,
          target: nodeId,
        };
        newTree.edges.addEdge(newEdge, true);
      }
      lastNodeId = nodeId;
    }
    return newTree;
  });
}
