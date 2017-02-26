/**
 * foo.js
 * @flow
 */

import _ from "lodash";
import Maybe from "data.maybe";
import app from "app";
import scaleInfo from "oxalis/model/scaleinfo";
import ColorGenerator from "libs/color_generator";
import Utils from "libs/utils";
import type { Vector3 } from "oxalis/constants";
import type { SkeletonTracingType, EdgeType, NodeType, TreeType } from "oxalis/store";

function moveNodesToNewTree(trees: Array<TreeType>, nodeId: number): Array<TreeType>{
  // TODO
  return trees;
}

function generateTreeNamePrefix(skeletonTracing) {
  const { contentType, taskId } = skeletonTracing;
  let user = `${app.currentUser.firstName}_${app.currentUser.lastName}`;

  // Replace spaces in user names
  user = user.replace(/ /g, "_");
  if (contentType === "Explorational") {
    // Get YYYY-MM-DD string
    const creationDate = new Date().toJSON().slice(0, 10);
    return `explorative_${creationDate}_${user}_`;
  } else {
    return `task_${taskId}_${user}_`;
  }
}

function getNewTreeColor(id) {
  return ColorGenerator.distinctColorForId(id);
}

export function createNode(skeletonTracing: SkeletonTracingType, position: Vector3, rotation: Vector3, viewport: number, resolution: number): Maybe<[NodeType, EdgeType]> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const { activeTreeId, activeNodeId } = skeletonTracing;

  if (allowUpdate) {
    // Use the same radius as current active node or revert to default value
    const defaultRadius = 10 * scaleInfo.baseVoxel;
    const radius = activeNodeId ? skeletonTracing.trees[activeTreeId].nodes[activeNodeId].radius : defaultRadius;

    // Find new node id by increasing the max node id.
    // Default to 0 if there are no nodes yet
    const maxNodeId = _.max(Object.keys(skeletonTracing.trees[activeTreeId].nodes).map(nodeId => parseInt(nodeId)));
    const nextNewId = activeNodeId === null ? 0 : maxNodeId + 1;

    // Create the new node
    const node: NodeType = {
      position,
      radius,
      rotation,
      viewport,
      resolution,
      id: nextNewId,
      timestamp: Date.now(),
    };

    // Create a new edge
    const newEdges = [];
    if (_.isNumber(activeNodeId)) {
      const newEdge: EdgeType = {
        source: activeNodeId,
        target: nextNewId,
      };
      newEdges.push(newEdge);
    }
    const edges = skeletonTracing.trees[activeTreeId].edges.concat(newEdges);

    return Maybe.Just([node, edges]);
  }
  return Maybe.Nothing();
}

export function deleteNode(skeletonTracing: SkeletonTracingType): Maybe<[Array<TreeType>, number, number]> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const { activeNodeId, activeTreeId, trees } = skeletonTracing;

  if (allowUpdate && _.isNumber(activeNodeId)) {
    let newActiveNodeId;
    let newActiveTreeId;
    let newTrees;

    // Delete Node
    const activeTree = skeletonTracing.trees[activeTreeId];
    delete activeTree.nodes[activeNodeId];

    // Do we need to split trees? Are there edges leading to/from it?
    const sourceNodeIds = activeTree.edges.reduce((result, edge) => { if (edge.target === activeNodeId) result.push(edge.source); return result; }, []);
    const targetNodeIds = activeTree.edges.reduce((result, edge) => { if (edge.source === activeNodeId) result.push(edge.target); return result; }, []);

    if (_.isEmpty(sourceNodeIds) || _.isEmpty(targetNodeIds)) {
      // We do not need to split
      // just delete all edges leading to/from it
      const newEdges = activeTree.edges.filter(edge => edge.source !== activeNodeId && edge.target !== activeNodeId);
      activeTree.edges = newEdges;

      // Delete all comments containing the node
      const newComments = activeTree.comments.filter(comment => comment.id !== activeNodeId);
      activeTree.comments = newComments;

      // Decrease active node id or reset to null
      newActiveNodeId = activeNodeId === 0 ? null : activeNodeId - 1;
      newActiveTreeId = activeTreeId;
      newTrees = skeletonTracing.trees;

    } else {
      // Split the tree
      newTrees = sourceNodeIds.map(nodeId => moveNodesToNewTree(nodeId)) +
        targetNodeIds.map(nodeId => moveNodesToNewTree(nodeId));

      // Delete current tree
      delete skeletonTracing.trees[activeTreeId];
      // Set the newly split ones
      newTrees.forEach((tree) => { trees[tree.treeId] = tree; });

      newActiveNodeId = newTrees[-1].nodes[0];
      newActiveTreeId = newTrees[-1].treeId;
    }

    return Maybe.Just([newTrees, newActiveNodeId, newActiveTreeId]);
  }
  return Maybe.Nothing();
}

export function createBranchPoint(skeletonTracing: SkeletonTracingType): Maybe {
  const { branchPointsAllowed, allowUpdate } = skeletonTracing.restrictions;
  const { activeNodeId } = skeletonTracing;

  if (branchPointsAllowed && allowUpdate && activeNodeId) {
    // create new branchpoint
    return Maybe.Just({
      id: activeNodeId,
      timestamp: Date.now(),
    });
  }
  return Maybe.Nothing();
}

export function deleteBranchPoint(skeletonTracing: SkeletonTracingType): Maybe<[Object, number, number]> {
  const { branchPointsAllowed, allowUpdate } = skeletonTracing.restrictions;
  const { trees } = skeletonTracing;

  if (branchPointsAllowed && allowUpdate) {
    // Find most recent branchpoint across all trees
    const treeId = _.maxBy(trees, tree => tree.branchPoints[-1].timestamp).treeId;
    const nodeId = trees[treeId].branchPoints[-1].id;

    // Delete branchpoint
    const branchPoints = skeletonTracing.trees[treeId].nodes[nodeId].branchPoints;
    const branchPoint = branchPoints.pop();

    return Maybe.Just([branchPoints, treeId, branchPoint.id]);
  }
  return Maybe.Nothing();
}

export function createTree(skeletonTracing: SkeletonTracingType): Maybe<TreeType> {
  const { allowUpdate } = skeletonTracing.restrictions;

  if (allowUpdate) {
    // create a new tree id and name
    const newTreeId = _.size(skeletonTracing.trees);
    const name = generateTreeNamePrefix(skeletonTracing) + Utils.zeroPad(this.newTreeId, 2);

    // Create the new tree
    const tree: TreeType = {
      name,
      treeId: newTreeId,
      nodes: {},
      timestamp: Date.now(),
      color: getNewTreeColor(newTreeId),
      branchPoints: [],
      edges: [],
      comments: [],
    };

    return Maybe.Just(tree);
  }
  return Maybe.Nothing();
}

export function deleteTree(skeletonTracing: SkeletonTracingType): Maybe<[Array<TreeType>, number, number]> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const userConfirmation = confirm("Do you really want to delete the whole tree?");

  if (allowUpdate && userConfirmation) {
    // Delete tree
    const trees = skeletonTracing.trees;
    delete trees[skeletonTracing.activeTreeId];

    // Because we always want an active tree, check if we need
    // to create one.
    let newActiveTreeId;
    let newActiveNodeId;
    if (trees.length === 0) {
      const newTree = createTree(skeletonTracing).get();
      trees.push(newTree);

      newActiveTreeId = newTree.treeId;
      newActiveNodeId = null;
    } else {
      // just set the last tree to be the active one
      newActiveTreeId = trees[-1].treeId;
      newActiveNodeId = trees[-1].nodes[0];
    }

    return Maybe.Just([trees, newActiveNodeId, newActiveTreeId]);
  }
  return Maybe.Nothing();
}

