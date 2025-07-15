import update from "immutability-helper";
import ColorGenerator from "libs/color_generator";
import DiffableMap from "libs/diffable_map";
import { V3 } from "libs/mjs";
import * as Utils from "libs/utils";
import _ from "lodash";
import type {
  MetadataEntryProto,
  ServerBranchPoint,
  ServerNode,
  ServerSkeletonTracingTree,
} from "types/api_types";
import type { AdditionalCoordinate } from "types/api_types";
import { type TreeType, TreeTypeEnum, type Vector3 } from "viewer/constants";
import Constants, { NODE_ID_REF_REGEX } from "viewer/constants";
import {
  enforceSkeletonTracing,
  findTreeByNodeId,
  getActiveNodeFromTree,
  getActiveTree,
  getActiveTreeGroup,
  getSkeletonTracing,
  getTree,
  mapGroups,
  mapGroupsToGenerator,
} from "viewer/model/accessors/skeletontracing_accessor";
import EdgeCollection from "viewer/model/edge_collection";
import {
  type BranchPoint,
  type CommentType,
  type Edge,
  type MutableBranchPoint,
  type MutableCommentType,
  type MutableNode,
  type MutableNodeMap,
  type MutableTree,
  type MutableTreeGroup,
  MutableTreeMap,
  type Node,
  type Tree,
  type TreeGroup,
  TreeMap,
} from "viewer/model/types/tree_types";
import type { RestrictionsAndSettings, SkeletonTracing, WebknossosState } from "viewer/store";

import { max, maxBy, min } from "../helpers/iterator_utils";

export function generateTreeName(state: WebknossosState, timestamp: number, treeId: number) {
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
  const minNodeId = min(trees.values().flatMap((tree) => tree.nodes.map((n) => n.id)));

  return minNodeId != null ? minNodeId : Constants.MIN_NODE_ID;
}
export function getMaximumNodeId(trees: TreeMap | MutableTreeMap): number {
  const newMaxNodeId = max(trees.values().flatMap((tree) => tree.nodes.map((n) => n.id)));

  return newMaxNodeId != null ? newMaxNodeId : Constants.MIN_NODE_ID - 1;
}
export function getMaximumTreeId(trees: TreeMap | MutableTreeMap): number {
  const maxTreeId = max(trees.values().map((tree) => tree.treeId));

  return maxTreeId != null ? maxTreeId : Constants.MIN_TREE_ID - 1;
}

function getNearestTreeId(treeId: number, trees: TreeMap): number {
  const sortedTreeIds = trees
    .keys()
    .toArray()
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

export function getMaximumGroupId(groups: TreeGroup[]): number {
  const maxGroupId = max(mapGroupsToGenerator(groups, (group) => group.groupId));

  return maxGroupId != null && maxGroupId >= 0 ? maxGroupId : 0;
}

export function forEachGroups(groups: TreeGroup[], callback: (arg0: TreeGroup) => any) {
  for (const group of groups) {
    callback(group);

    if (group.children) {
      forEachGroups(group.children, callback);
    }
  }
}

export function createNode(
  state: WebknossosState,
  skeletonTracing: SkeletonTracing,
  tree: Tree,
  positionFloat: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null,
  rotation: Vector3,
  viewport: number,
  mag: number,
  timestamp: number,
): [Node, EdgeCollection] | null {
  const activeNode = getActiveNodeFromTree(skeletonTracing, tree);

  if (activeNode == null && tree.nodes.size() !== 0) {
    console.error("Couldn't create a node in non-empty tree, because there is no active node.");
    return null;
  }

  // Use the same radius as current active node or revert to default value
  const radius = activeNode?.radius ?? Constants.DEFAULT_NODE_RADIUS;

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
  if (activeNode == null) {
    return [node, tree.edges];
  }
  const newEdge = {
    source: activeNode.id,
    target: nextNewId,
  };
  const edges = tree.edges.addEdge(newEdge);

  return [node, edges];
}
export function deleteNode(
  state: WebknossosState,
  tree: Tree,
  node: Node,
  timestamp: number,
): [TreeMap, number, number | null, number] | null {
  const skeletonTracing = getSkeletonTracing(state.annotation);
  if (skeletonTracing == null) {
    return null;
  }

  // Delete node and possible branchpoints/comments
  const activeTree: Tree = {
    ...tree,
    nodes: tree.nodes.delete(node.id),
    comments: tree.comments.filter((comment) => comment.nodeId !== node.id),
    branchPoints: tree.branchPoints.filter((branchPoint) => branchPoint.nodeId !== node.id),
  };

  // Do we need to split trees? Are there edges leading to/from it?
  const neighborIds: number[] = [];
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
  // Decide which node should be active now
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
  return [newTrees, newActiveTreeId, newActiveNodeId, newMaxNodeId];
}

export function deleteEdge(
  state: WebknossosState,
  sourceTree: Tree,
  sourceNode: Node,
  targetTree: Tree,
  targetNode: Node,
  timestamp: number,
): [TreeMap, number | null | undefined] | null {
  const skeletonTracing = getSkeletonTracing(state.annotation);
  if (skeletonTracing == null) {
    return null;
  }
  if (sourceTree.treeId !== targetTree.treeId) {
    // The two selected nodes are in different trees
    console.error(
      "Tried to delete an edge that was not there, the two nodes are in different trees.",
    );
    return null;
  }

  const deletedEdge = sourceTree.edges
    .getEdgesForNode(sourceNode.id)
    .find((edge) => edge.target === targetNode.id || edge.source === targetNode.id);

  if (deletedEdge == null) {
    // The two selected nodes do not share an edge
    console.error("Tried to delete an edge that was not there.");
    return null;
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
  return [newTrees, newActiveTreeId];
}

function splitTreeByNodes(
  state: WebknossosState,
  skeletonTracing: SkeletonTracing,
  activeTree: Tree,
  newTreeRootIds: number[],
  deletedEdges: Edge[],
  timestamp: number,
): TreeMap {
  // This function splits a given tree by deleting the given edges and making the
  // given node ids the new tree roots.
  // Not every node id is guaranteed to be a new tree root as there may be cyclic trees.
  let newTrees = skeletonTracing.trees;

  if (newTreeRootIds.length === 0) {
    // As there are no new tree root ids, we are deleting the last node from a tree.
    // It suffices to simply update that tree within the tree collection
    return newTrees.set(activeTree.treeId, activeTree);
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

        let newTree: MutableTree | null = null;

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
          // Create new tree
          const immutableNewTree = createTree(
            intermediateState,
            timestamp,
            true,
            undefined,
            activeTree.type,
          );

          // Cast to mutable tree type since we want to mutably do the split
          // in this reducer for performance reasons.
          newTree = immutableNewTree as any as MutableTree;
          const newTrees = enforceSkeletonTracing(intermediateState.annotation).trees.set(
            newTree.treeId,
            newTree,
          );

          intermediateState = update(intermediateState, {
            annotation: {
              skeleton: {
                trees: {
                  $set: newTrees,
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
    newTrees = newTrees.set(cutTree.treeId, cutTree);
  });

  return newTrees;
}

export function createBranchPoint(
  tree: Tree,
  node: Node,
  timestamp: number,
  restrictions: RestrictionsAndSettings,
): BranchPoint | null {
  const { branchPointsAllowed } = restrictions;
  if (!branchPointsAllowed) return null;

  const doesBranchPointExistAlready = _.some(
    tree.branchPoints,
    (branchPoint) => branchPoint.nodeId === node.id,
  );

  if (!doesBranchPointExistAlready) {
    // create new branchpoint
    return {
      nodeId: node.id,
      timestamp,
    };
  }

  return null;
}

export function deleteBranchPoint(
  skeletonTracing: SkeletonTracing,
  restrictions: RestrictionsAndSettings,
): [BranchPoint[], number, number] | null {
  const { branchPointsAllowed } = restrictions;
  const { trees } = skeletonTracing;

  const hasBranchPoints = trees.values().some((tree) => !_.isEmpty(tree.branchPoints));
  if (!branchPointsAllowed || !hasBranchPoints) return null;

  // Find most recent branchpoint across all trees
  const treeWithLastBranchpoint = maxBy(
    trees.values().filter((tree) => !_.isEmpty(tree.branchPoints)),
    (tree: Tree) => _.last(tree.branchPoints)?.timestamp ?? 0,
  );

  if (treeWithLastBranchpoint == null) {
    return null;
  }
  const branchPoints = treeWithLastBranchpoint.branchPoints;
  const lastBranchPoint = _.last(branchPoints);

  if (branchPoints && lastBranchPoint) {
    // Delete branchpoint
    const newBranchPoints = _.without(branchPoints, lastBranchPoint);

    return [newBranchPoints, treeWithLastBranchpoint.treeId, lastBranchPoint.nodeId];
  }

  return null;
}

export function createTree(
  state: WebknossosState,
  timestamp: number,
  addToActiveGroup: boolean = true,
  name?: string,
  type: TreeType = TreeTypeEnum.DEFAULT,
  edgesAreVisible: boolean = true,
  metadata: MetadataEntryProto[] = [],
): Tree | null {
  const skeletonTracing = getSkeletonTracing(state.annotation);
  if (skeletonTracing == null) {
    return null;
  }
  // Create a new tree id and name
  const newTreeId = getMaximumTreeId(skeletonTracing.trees) + 1;
  const newTreeName = name || generateTreeName(state, timestamp, newTreeId);
  let groupId = null;

  if (addToActiveGroup) {
    const groupIdOfActiveTree = getActiveTree(skeletonTracing)?.groupId;
    const groupIdOfActiveGroup = getActiveTreeGroup(skeletonTracing)?.groupId;
    groupId = groupIdOfActiveTree ?? groupIdOfActiveGroup;
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
  return tree;
}

export function getOrCreateTree(
  state: WebknossosState,
  skeletonTracing: SkeletonTracing,
  treeId: number | null | undefined,
  timestamp: number,
  type?: TreeType | null | undefined,
): Tree | null {
  const tree = getTree(skeletonTracing, treeId, type);
  if (tree != null) {
    return tree;
  }

  // Only create a new tree if there are no trees
  // Specifically, this means that no new tree is created just because
  // the activeTreeId is temporarily null
  if (skeletonTracing.trees.size() === 0) {
    return createTree(state, timestamp);
  }

  return null;
}

export function ensureTreeNames(state: WebknossosState, trees: MutableTreeMap) {
  // Assign a new tree name for trees without a name
  for (const tree of trees.values()) {
    if (tree.name === "") {
      tree.name = generateTreeName(state, tree.timestamp, tree.treeId);
    }
  }

  return trees;
}

export function addTreesAndGroups(
  skeletonTracing: SkeletonTracing,
  trees: MutableTreeMap,
  treeGroups: MutableTreeGroup[],
  assignNewGroupId: boolean = true,
): [MutableTreeMap, TreeGroup[], number] | null {
  const hasInvalidTreeIds = trees
    .keys()
    .some((treeId) => treeId < Constants.MIN_TREE_ID || treeId > Constants.MAX_TREE_ID);
  const hasInvalidNodeIds = getMinimumNodeId(trees) < Constants.MIN_NODE_ID;
  const needsReassignedIds =
    skeletonTracing.trees.size() > 0 ||
    skeletonTracing.treeGroups.length > 0 ||
    hasInvalidTreeIds ||
    hasInvalidNodeIds;

  if (!needsReassignedIds) {
    // Without reassigning ids, the code is considerably faster.
    const newMaxNodeId = getMaximumNodeId(trees);
    return [trees, treeGroups, newMaxNodeId];
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
  for (const tree of trees.values()) {
    for (const node of tree.nodes.values()) {
      idMap[node.id] = newNodeId++;
    }
  }

  const newTrees = new MutableTreeMap();
  for (const tree of trees.values()) {
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

    tree.comments = tree.comments.map((comment) => ({
      ...comment,
      // Comments can reference other nodes, rewrite those references if the referenced id changed
      nodeId: idMap[comment.nodeId],
      content: comment.content.replace(
        NODE_ID_REF_REGEX,
        (__, p1) => `#${idMap[Number(p1)] != null ? idMap[Number(p1)] : p1}`,
      ),
    }));

    tree.branchPoints = tree.branchPoints.map((bp) => ({
      ...bp,
      nodeId: idMap[bp.nodeId],
    }));

    // Assign the new group id to the tree if the tree belongs to a group that was newly added
    // or keep the old group id if the tree should be assigned to an existing group.
    if (tree.groupId != null && assignNewGroupId) {
      tree.groupId = groupIdMap[tree.groupId];
    }
    tree.treeId = newTreeId;

    newTrees.mutableSet(newTreeId, tree);
    newTreeId++;
  }

  return [newTrees, treeGroups, newNodeId - 1];
}

export function deleteTrees(
  skeletonTracing: SkeletonTracing,
  treeIds: number[],
  suppressActivatingNextNode: boolean = false,
): [TreeMap, number | null | undefined, number | null | undefined, number] | null {
  if (treeIds.length === 0) return null;
  // Delete trees
  const newTrees: TreeMap = treeIds.reduce((newTrees, treeId) => {
    return newTrees.delete(treeId);
  }, skeletonTracing.trees);

  let newActiveTreeId: number | null = null;
  let newActiveNodeId: number | null = null;

  if (newTrees.size() > 0 && !suppressActivatingNextNode) {
    // Setting the tree active whose id is the next highest compared to the ids of the deleted trees.
    const maximumTreeId = _.max(treeIds) || Constants.MIN_TREE_ID;
    newActiveTreeId = getNearestTreeId(maximumTreeId, newTrees);

    const firstKey = _.first(newTrees.getOrThrow(newActiveTreeId).nodes.keys().toArray());
    newActiveNodeId = firstKey != null ? Number(firstKey) : null;
  }

  const newMaxNodeId = getMaximumNodeId(newTrees);

  return [newTrees, newActiveTreeId, newActiveNodeId, newMaxNodeId];
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

  let newTrees = trees.delete(targetTree.treeId);

  const newNodes = sourceTree.nodes.clone();

  for (const [id, node] of targetTree.nodes.entries()) {
    newNodes.mutableSet(id, node);
  }

  // Create an updated source tree with the merged content
  const updatedSourceTree: Tree = {
    ...sourceTree,
    nodes: newNodes,
    edges: sourceTree.edges.addEdges(targetTree.edges.toArray().concat(newEdge)),
    comments: sourceTree.comments.concat(targetTree.comments),
    branchPoints: sourceTree.branchPoints.concat(targetTree.branchPoints),
  };

  // Add the updated source tree to the trees map
  newTrees = newTrees.set(sourceTree.treeId, updatedSourceTree);

  return [newTrees, sourceTree.treeId, sourceNodeId];
}

export function shuffleTreeColor(skeletonTracing: SkeletonTracing, tree: Tree): [Tree, number] {
  const randomId = _.random(0, 10000, false);

  return setTreeColorIndex(skeletonTracing, tree, randomId);
}

export function setTreeColorIndex(
  _skeletonTracing: SkeletonTracing,
  tree: Tree,
  colorIndex: number,
): [Tree, number] {
  const newTree = {
    ...tree,
    color: ColorGenerator.distinctColorForId(colorIndex),
  };
  return [newTree, tree.treeId];
}

export function createComment(
  _skeletonTracing: SkeletonTracing,
  tree: Tree,
  node: Node,
  commentText: string,
): CommentType[] {
  // Gather all comments other than the activeNode's comments
  const { comments } = tree;
  const commentsWithoutActiveNodeComment = comments.filter((comment) => comment.nodeId !== node.id);
  const newComment: CommentType = {
    nodeId: node.id,
    content: commentText,
  };
  const newComments = commentsWithoutActiveNodeComment.concat([newComment]);

  return newComments;
}

export function deleteComment(
  _skeletonTracing: SkeletonTracing,
  tree: Tree,
  node: Node,
): CommentType[] {
  const { comments } = tree;
  const commentsWithoutActiveNodeComment = comments.filter((comment) => comment.nodeId !== node.id);

  return commentsWithoutActiveNodeComment;
}

export function toggleAllTreesReducer(
  state: WebknossosState,
  skeletonTracing: SkeletonTracing,
): WebknossosState {
  // Let's make all trees visible if there is one invisible tree
  const shouldBecomeVisible = skeletonTracing.trees.values().some((tree) => !tree.isVisible);

  const newTrees = skeletonTracing.trees.clone();
  for (const [treeId, tree] of skeletonTracing.trees.entries()) {
    newTrees.mutableSet(treeId, { ...tree, isVisible: shouldBecomeVisible });
  }

  return update(state, {
    annotation: {
      skeleton: {
        trees: { $set: newTrees },
      },
    },
  });
}

export function toggleTreeGroupReducer(
  state: WebknossosState,
  skeletonTracing: SkeletonTracing,
  groupId: number,
  targetVisibility?: boolean,
): WebknossosState {
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
      : skeletonTracing.trees
          .values()
          .some(
            (tree) =>
              typeof tree.groupId === "number" &&
              affectedGroupIds.has(tree.groupId) &&
              !tree.isVisible,
          );

  const newTreeMap = skeletonTracing.trees.clone();
  for (const tree of skeletonTracing.trees.values()) {
    if (typeof tree.groupId === "number" && affectedGroupIds.has(tree.groupId)) {
      newTreeMap.mutableSet(tree.treeId, { ...tree, isVisible: shouldBecomeVisible });
    }
  }

  return update(state, {
    annotation: {
      skeleton: {
        trees: { $set: newTreeMap },
      },
    },
  });
}

export function setExpandedTreeGroups(
  state: WebknossosState,
  shouldBeExpanded: (arg: TreeGroup) => boolean,
): WebknossosState {
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
  trees: ServerSkeletonTracingTree[],
  applyUserStateToTreeFn?: (tree: Tree) => Tree,
): MutableTreeMap {
  const newTreeMap = new MutableTreeMap();
  applyUserStateToTreeFn ||= (tree) => tree;

  for (const tree of trees) {
    newTreeMap.mutableSet(
      tree.treeId,
      applyUserStateToTreeFn({
        comments: tree.comments as any as MutableCommentType[],
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
    );
  }

  return newTreeMap;
}

export function createTreeMapFromTreeArray(
  trees: ServerSkeletonTracingTree[],
  applyUserStateToTreeFn?: (tree: Tree) => Tree,
): TreeMap {
  /*
   * This function is the immutable sibling to createMutableTreeMapFromTreeArray.
   */
  return createMutableTreeMapFromTreeArray(trees, applyUserStateToTreeFn) as any as TreeMap;
}

export function removeMissingGroupsFromTrees(
  skeletonTracing: SkeletonTracing,
  treeGroups: TreeGroup[],
): TreeMap {
  // Change the groupId of trees for groups that no longer exist
  const groupIds = new Set(mapGroupsToGenerator(treeGroups, (group) => group.groupId));
  const changedTrees: TreeMap = new TreeMap();

  for (const [treeId, tree] of skeletonTracing.trees.entries()) {
    if (tree.groupId != null && !groupIds.has(tree.groupId)) {
      changedTrees.mutableSet(treeId, { ...tree, groupId: null });
    }
  }

  return changedTrees;
}

export function extractPathAsNewTree(
  state: WebknossosState,
  sourceTree: Tree,
  pathOfNodeIds: number[],
): Tree | null {
  const newTree = createTree(
    state,
    Date.now(),
    true,
    `Path from node ${pathOfNodeIds[0]} to ${pathOfNodeIds[pathOfNodeIds.length - 1]}`,
  );

  if (newTree == null) {
    return null;
  }

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
}
