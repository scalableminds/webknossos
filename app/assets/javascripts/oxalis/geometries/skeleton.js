/**
 * skeleton.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import Backbone from "backbone";
import Store from "oxalis/store";
import ErrorHandling from "libs/error_handling";
import Model from "oxalis/model";
import TracePoint from "oxalis/model/skeletontracing/tracepoint";
import { OrthoViews } from "oxalis/constants";
import Tree from "oxalis/geometries/tree";

class Skeleton {
  // This class is supposed to collect all the Geometries that belong to the skeleton, like
  // nodes, edges and trees

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  trigger: Function;

  model: Model;
  isVisible: boolean;
  treeGeometries: {[id:number]: Tree};
  showInactiveTrees: boolean;
  lastActiveNode: TracePoint;


  constructor(model) {
    this.model = model;
    _.extend(this, Backbone.Events);

    this.treeGeometries = {};
    this.isVisible = true;

    this.showInactiveTrees = true;

    // this.reset();

    // Potentially quite ressource intensive
    // Test this some more
    // Perhaps load can be eased a bit with ThreeJS-React wrappers?
    Store.subscribe(() => this.reset());
  }


  createNewTree(treeId, treeColor) {
    const tree = new Tree(treeId, treeColor, this.model);
    tree.showRadius(!Store.getState().userConfiguration.overrideNodeRadius);
    this.treeGeometries[treeId] = tree;
    this.setActiveNode();
    this.trigger("newGeometries", tree.getMeshes());
  }


  // Will completely reload the trees from model.
  // This needs to be done at initialization

  reset() {
    for (const tree of _.values(this.treeGeometries)) {
      this.trigger("removeGeometries", tree.getMeshes());
      tree.dispose();
    }

    this.treeGeometries = {};

    for (const tree of _.values(Store.getState().skeletonTracing.trees)) {
      this.createNewTree(tree.treeId, tree.color);
    }

    return this.loadSkeletonFromModel();
  }


  loadSkeletonFromModel(trees) {
    if (trees == null) { trees = _.values(Store.getState().skeletonTracing.trees); }

    for (const tree of trees) {
      const treeGeometry = this.getTreeGeometry(tree.treeId);
      treeGeometry.clear();
      treeGeometry.addNodes(tree.nodes, tree.edges);

      for (const branchpoint of tree.branchPoints) {
        treeGeometry.updateNodeColor(branchpoint.id, null, true);
      }
    }

    this.setActiveNode();

    app.vent.trigger("rerender");
  }


  setBranch(isBranchPoint, node) {
    const treeGeometry = this.getTreeGeometry(node.treeId);
    treeGeometry.updateNodeColor(node.id, null, isBranchPoint);

    app.vent.trigger("rerender");
  }


  updateTreeColor(treeId) {
    this.getTreeGeometry(treeId).updateTreeColor();
    app.vent.trigger("rerender");
  }


  getMeshes = () => {
    let meshes = [];
    for (const tree of _.values(this.treeGeometries)) {
      meshes = meshes.concat(tree.getMeshes());
    }
    return meshes;
  }

  setWaypoint() {
    const { activeTreeId, activeNodeId, trees } = Store.getState().skeletonTracing;
    const activeNode = trees[activeTreeId].nodes[activeNodeId];
    const treeGeometry = this.getTreeGeometry(activeTreeId);

    treeGeometry.addNode(activeNode);
    app.vent.trigger("rerender");
  }


  deleteNode(node, treeId) {
    ErrorHandling.assertEquals(node.neighbors.length, 1, "Node needs to have exactly 1 neighbor.");

    const treeGeometry = this.getTreeGeometry(treeId);
    treeGeometry.deleteNode(node);

    app.vent.trigger("rerender");
  }


  mergeTree(lastTreeID, lastNode, activeNode) {
    const lastTree = this.getTreeGeometry(lastTreeID);
    const activeTree = this.getTreeGeometry(Store.getState().skeletonTracing.activeTreeId);

    return activeTree.mergeTree(lastTree, lastNode, activeNode);
  }


  deleteTree(treeId) {
    const treeGeometry = this.treeGeometries[treeId];

    this.trigger("removeGeometries", treeGeometry.getMeshes());
    treeGeometry.dispose();
    delete this.treeGeometries[treeId];

    app.vent.trigger("rerender");
  }


  setActiveNode() {
    let treeGeometry;
    if (this.lastActiveNode != null) {
      treeGeometry = this.getTreeGeometry(this.lastActiveNode.treeId);
      Utils.__guard__(treeGeometry, x => x.updateNodeColor(this.lastActiveNode.id, false));
    }
    const { activeTreeId, activeNodeId, trees } = Store.getState().skeletonTracing;
    const activeNode = trees[activeTreeId].nodes[activeNodeId];
    if (activeNode != null) {
      treeGeometry = this.getTreeGeometry(activeNode.treeId);
      Utils.__guard__(treeGeometry, x1 => x1.updateNodeColor(activeNode.id, true));
      Utils.__guard__(treeGeometry, x2 => x2.startNodeHighlightAnimation(activeNode.id));
    }

    this.lastActiveNode = activeNode;
  }


  setActiveNodeRadius() {
    const { activeTreeId, activeNodeId, trees } = Store.getState().skeletonTracing;
    const activeNode = trees[activeTreeId].nodes[activeNodeId];
    if (activeNode != null) {
      const treeGeometry = this.getTreeGeometry(activeTreeId);
      treeGeometry.updateNodeRadius(activeNode.id, activeNode.radius);
      app.vent.trigger("rerender");
    }
  }


  getAllNodes() {
    return _.map(this.treeGeometries, tree => tree.nodes);
  }


  getTreeGeometry(treeId) {
    if (!treeId) {
      treeId = Store.getState().skeletonTracing.activeTreeId;
    }
    return this.treeGeometries[treeId];
  }


  setVisibilityTemporary(isVisible) {
    for (const mesh of this.getMeshes()) {
      mesh.visible = isVisible && ((mesh.isVisible != null) ? mesh.isVisible : true);
    }
    app.vent.trigger("rerender");
  }


  setVisibility(isVisible) {
    this.isVisible = isVisible;
    app.vent.trigger("rerender");
  }


  restoreVisibility() {
    return this.setVisibilityTemporary(this.isVisible);
  }


  toggleVisibility() {
    return this.setVisibility(!this.isVisible);
  }


  updateForCam(id) {
    for (const tree of _.values(this.treeGeometries)) {
      tree.showRadius(id !== OrthoViews.TDView && !Store.getState().userConfiguration.overrideNodeRadius);
    }

    if (id !== OrthoViews.TDView) {
      return this.setVisibilityTemporary(this.isVisible);
    }
    return this.setVisibilityTemporary(true);
  }


  toggleInactiveTreeVisibility() {
    this.showInactiveTrees = !this.showInactiveTrees;
    return this.setInactiveTreeVisibility(this.showInactiveTrees);
  }


  setInactiveTreeVisibility(visible) {
    for (const mesh of this.getMeshes()) {
      mesh.isVisible = visible;
    }
    const treeGeometry = this.getTreeGeometry(Store.getState().skeletonTracing.activeTreeId);
    treeGeometry.edges.isVisible = true;
    treeGeometry.nodes.isVisible = true;
    app.vent.trigger("rerender");
  }


  setSizeAttenuation(sizeAttenuation) {
    return _.map(this.treeGeometries, tree =>
      tree.setSizeAttenuation(sizeAttenuation));
  }
}

export default Skeleton;
