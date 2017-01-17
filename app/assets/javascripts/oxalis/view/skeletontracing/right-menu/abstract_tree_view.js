import _ from "lodash";
import $ from "jquery";
import app from "app";
import Marionette from "backbone.marionette";
import AbstractTreeRenderer from "oxalis/view/skeletontracing/abstract_tree_renderer";


class AbstractTreeView extends Marionette.View {
  static initClass() {
    this.prototype.className = "flex-column";
    this.prototype.template = _.template("\
<canvas id=\"abstract-tree-canvas\">\
");

    this.prototype.ui =
      { canvas: "canvas" };

    this.prototype.events =
      { "click @ui.canvas": "handleClick" };
  }

  initialize() {
    this.listenTo(app.vent, "planes:resize", this.resize);
    this.listenTo(app.vent, "view:setTheme", this.drawTree);
    this.listenTo(this.model.user, "change:renderComments", this.drawTree);

    this.listenTo(this.model.skeletonTracing, "newActiveNode", this.drawTree);
    this.listenTo(this.model.skeletonTracing, "newActiveTree", this.drawTree);
    this.listenTo(this.model.skeletonTracing, "newTree", this.drawTree);
    this.listenTo(this.model.skeletonTracing, "mergeTree", this.drawTree);
    this.listenTo(this.model.skeletonTracing, "reloadTrees", this.drawTree);
    this.listenTo(this.model.skeletonTracing, "deleteTree", this.drawTree);
    this.listenTo(this.model.skeletonTracing, "deleteActiveNode", this.drawTree);
    this.listenTo(this.model.skeletonTracing, "newNode", this.drawTree);
    this.listenTo(this.model.skeletonTracing, "updateComments", this.drawTree);

    this.initialized = false;
    $(window).on("resize", () => this.drawTree());
  }


  resize() {
    this.initialized = true;
    this.render();
  }


  render() {
    super.render();
    if (this.initialized) {
      this.abstractTreeRenderer = new AbstractTreeRenderer(this.ui.canvas);
    }
    this.drawTree();
  }


  drawTree() {
    if (this.model.skeletonTracing && this.abstractTreeRenderer) {
      this.abstractTreeRenderer.renderComments(this.model.user.get("renderComments"));
      this.abstractTreeRenderer.drawTree(
        this.model.skeletonTracing.getTree(),
        this.model.skeletonTracing.getActiveNodeId());
    }
  }


  handleClick(event) {
    const id = this.abstractTreeRenderer.getIdFromPos(event.offsetX, event.offsetY);
    if (id) {
      this.model.skeletonTracing.setActiveNode(id);
      this.model.skeletonTracing.centerActiveNode();
    }
  }
}
AbstractTreeView.initClass();


export default AbstractTreeView;
