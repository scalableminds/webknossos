import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import ErrorHandling from "libs/error_handling";
import constants from "../constants";
import Tree from "./tree";

class Skeleton {
  static initClass() {
    // This class is supposed to collect all the Geometries that belong to the skeleton, like
    // nodes, edges and trees

    this.prototype.COLOR_ACTIVE = 0xff0000;
  }

  constructor(model) {
    this.getMeshes = this.getMeshes.bind(this);
    this.setWaypoint = this.setWaypoint.bind(this);
    this.model = model;
    _.extend(this, Backbone.Events);

    this.skeletonTracing = this.model.skeletonTracing;
    this.treeGeometries = [];
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
    this.listenTo(this.skeletonTracing, "newNode", this.setWaypoint);
    this.listenTo(this.skeletonTracing, "setBranch", this.setBranch);
    this.listenTo(this.skeletonTracing, "newTreeColor", this.updateTreeColor);
    this.listenTo(this.skeletonTracing, "reloadTrees", this.loadSkeletonFromModel);

    this.listenTo(this.model.user, "change:particleSize", this.setParticleSize);
    this.listenTo(this.model.user, "change:overrideNodeRadius", () => this.treeGeometries.map(tree =>
      tree.showRadius(!this.model.user.get("overrideNodeRadius"))),
    );
  }

  createNewTree(treeId, treeColor) {
    const tree = new Tree(treeId, treeColor, this.model);
    this.treeGeometries.push(tree);
    this.setActiveNode();
    return this.trigger("newGeometries", tree.getMeshes());
  }


  // Will completely reload the trees from model.
  // This needs to be done at initialization

  reset() {
    for (const tree of this.treeGeometries) {
      this.trigger("removeGeometries", tree.getMeshes());
      tree.dispose();
    }

    this.treeGeometries = [];

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

      for (const branchpoint of tree.branchpoints) {
        treeGeometry.updateNodeColor(branchpoint.id, null, true);
      }
    }

    this.setActiveNode();

    return app.vent.trigger("rerender");
  }


  setBranch(isBranchPoint, node) {
    const treeGeometry = this.getTreeGeometry(node.treeId);
    treeGeometry.updateNodeColor(node.id, null, isBranchPoint);

    return app.vent.trigger("rerender");
  }


  updateTreeColor(treeId) {
    this.getTreeGeometry(treeId).updateTreeColor();
    return app.vent.trigger("rerender");
  }


  getMeshes() {
    let meshes = [];
    for (const tree of this.treeGeometries) {
      meshes = meshes.concat(tree.getMeshes());
    }
    return meshes;
  }

  setWaypoint() {
    const treeGeometry = this.getTreeGeometry(this.skeletonTracing.getTree().treeId);

    treeGeometry.addNode(this.skeletonTracing.getActiveNode());
    return app.vent.trigger("rerender");
  }


  deleteNode(node, treeId) {
    ErrorHandling.assertEquals(node.neighbors.length, 1, "Node needs to have exactly 1 neighbor.");

    const treeGeometry = this.getTreeGeometry(treeId);
    treeGeometry.deleteNode(node);

    return app.vent.trigger("rerender");
  }


  mergeTree(lastTreeID, lastNode, activeNode) {
    const lastTree = this.getTreeGeometry(lastTreeID);
    const activeTree = this.getTreeGeometry(this.skeletonTracing.getTree().treeId);

    return activeTree.mergeTree(lastTree, lastNode, activeNode);
  }


  deleteTree(index) {
    const treeGeometry = this.treeGeometries[index];

    this.trigger("removeGeometries", treeGeometry.getMeshes());
    treeGeometry.dispose();
    this.treeGeometries.splice(index, 1);

    return app.vent.trigger("rerender");
  }


  setActiveNode() {
    let treeGeometry;
    if (this.lastActiveNode != null) {
      treeGeometry = this.getTreeGeometry(this.lastActiveNode.treeId);
      __guard__(treeGeometry, x => x.updateNodeColor(this.lastActiveNode.id, false));
    }

    const activeNode = this.model.skeletonTracing.getActiveNode();
    if (activeNode != null) {
      treeGeometry = this.getTreeGeometry(activeNode.treeId);
      __guard__(treeGeometry, x1 => x1.updateNodeColor(activeNode.id, true));
      __guard__(treeGeometry, x2 => x2.startNodeHighlightAnimation(activeNode.id));
    }

    this.lastActiveNode = activeNode;
  }


  setActiveNodeRadius() {
    const activeNode = this.model.skeletonTracing.getActiveNode();
    if (activeNode != null) {
      const treeGeometry = this.getTreeGeometry(activeNode.treeId);
      __guard__(treeGeometry, x => x.updateNodeRadius(activeNode.id, activeNode.radius));
      app.vent.trigger("rerender");
    }
  }


  getAllNodes() {
    return (this.treeGeometries.map(tree => tree.nodes));
  }


  getTreeGeometry(treeId) {
    if (!treeId) {
      ({ treeId } = this.skeletonTracing.getTree());
    }
    for (const tree of this.treeGeometries) {
      if (tree.id === treeId) {
        return tree;
      }
    }
    return null;
  }


  setVisibilityTemporary(isVisible) {
    for (const mesh of this.getMeshes()) {
      mesh.visible = isVisible && ((mesh.isVisible != null) ? mesh.isVisible : true);
    }
    return app.vent.trigger("rerender");
  }


  setVisibility(isVisible) {
    this.isVisible = isVisible;
    return app.vent.trigger("rerender");
  }


  restoreVisibility() {
    return this.setVisibilityTemporary(this.isVisible);
  }


  toggleVisibility() {
    return this.setVisibility(!this.isVisible);
  }


  updateForCam(id) {
    for (const tree of this.treeGeometries) {
      tree.showRadius(id !== constants.TDView &&
        !this.model.user.get("overrideNodeRadius"));
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
    return app.vent.trigger("rerender");
  }


  setSizeAttenuation(sizeAttenuation) {
    return this.treeGeometries.map(tree =>
      tree.setSizeAttenuation(sizeAttenuation));
  }
}
Skeleton.initClass();

export default Skeleton;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
