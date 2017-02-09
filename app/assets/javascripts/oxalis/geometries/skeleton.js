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
import SkeletonTracing from "oxalis/model/skeletontracing/skeletontracing";
import TracePoint from "oxalis/model/skeletontracing/tracepoint";
import constants from "../constants";
import Tree from "./tree";

class Skeleton {
  // This class is supposed to collect all the Geometries that belong to the skeleton, like
  // nodes, edges and trees

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  trigger: Function;

  model: Model;
  isVisible: boolean;
  skeletonTracing: SkeletonTracing;
  treeGeometries: {[id:number]: Tree};
  showInactiveTrees: boolean;
  lastActiveNode: TracePoint;


  constructor(model) {
    this.model = model;
    _.extend(this, Backbone.Events);

    this.skeletonTracing = this.model.skeletonTracing;
    this.treeGeometries = {};
    this.isVisible = true;

    this.showInactiveTrees = true;

    this.reset();

    this.listenTo(this.skeletonTracing, "newActiveNode", function () {
      this.setActiveNode();
      return this.setInactiveTreeVisibility(this.showInactiveTrees);
    });
    this.listenTo(this.skeletonTracing, "newActiveNodeRadius", this.setActiveNodeRadius);
    this.listenTo(this.skeletonTracing, "newTree", function (treeId, treeColor) {
      this.createNewTree(treeId, treeColor);
      return this.setInactiveTreeVisibility(this.showInactiveTrees);
    });
    this.listenTo(this.skeletonTracing, "deleteTree", this.deleteTree);
    this.listenTo(this.skeletonTracing, "deleteActiveNode", this.deleteNode);
    this.listenTo(this.skeletonTracing, "mergeTree", this.mergeTree);
    this.listenTo(this.skeletonTracing, "newNode", this.setWaypoint.bind(this));
    this.listenTo(this.skeletonTracing, "setBranch", this.setBranch);
    this.listenTo(this.skeletonTracing, "newTreeColor", this.updateTreeColor);
    this.listenTo(this.skeletonTracing, "reloadTrees", this.loadSkeletonFromModel);
  }


  createNewTree(treeId, treeColor) {
    const tree = new Tree(treeId, treeColor, this.model);
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

    for (const tree of this.skeletonTracing.getTrees()) {
      this.createNewTree(tree.treeId, tree.color);
    }

    return this.loadSkeletonFromModel();
  }


  loadSkeletonFromModel(trees) {
    if (trees == null) { trees = this.model.skeletonTracing.getTrees(); }

    for (const tree of trees) {
      const treeGeometry = this.getTreeGeometry(tree.treeId);
      treeGeometry.clear();
      treeGeometry.addNodes(tree.nodes);

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
    const treeGeometry = this.getTreeGeometry(this.skeletonTracing.getTree().treeId);

    treeGeometry.addNode(this.skeletonTracing.getActiveNode());
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
    const activeTree = this.getTreeGeometry(this.skeletonTracing.getTree().treeId);

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

    const activeNode = this.model.skeletonTracing.getActiveNode();
    if (activeNode != null) {
      treeGeometry = this.getTreeGeometry(activeNode.treeId);
      Utils.__guard__(treeGeometry, x1 => x1.updateNodeColor(activeNode.id, true));
      Utils.__guard__(treeGeometry, x2 => x2.startNodeHighlightAnimation(activeNode.id));
    }

    this.lastActiveNode = activeNode;
  }


  setActiveNodeRadius() {
    const activeNode = this.model.skeletonTracing.getActiveNode();
    if (activeNode != null) {
      const treeGeometry = this.getTreeGeometry(activeNode.treeId);
      Utils.__guard__(treeGeometry, x => x.updateNodeRadius(activeNode.id, activeNode.radius));
      app.vent.trigger("rerender");
    }
  }


  getAllNodes() {
    return _.map(this.treeGeometries, tree => tree.nodes);
  }


  getTreeGeometry(treeId) {
    if (!treeId) {
      ({ treeId } = this.skeletonTracing.getTree());
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
      tree.showRadius(id !== constants.TDView && !Store.getState().userConfiguration.overrideNodeRadius);
    }

    if (constants.ALL_PLANES.includes(id)) {
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
    const treeGeometry = this.getTreeGeometry(this.skeletonTracing.getTree().treeId);
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
