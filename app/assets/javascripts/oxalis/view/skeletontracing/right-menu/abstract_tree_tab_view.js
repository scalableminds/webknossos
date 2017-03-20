/**
 * abstract_tree_view.js
 * @flow weak
 */

import _ from "lodash";
import $ from "jquery";
import app from "app";
import Marionette from "backbone.marionette";
import Store from "oxalis/store";
import { setActiveNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import AbstractTreeRenderer from "oxalis/view/skeletontracing/abstract_tree_renderer";


class AbstractTreeTabView extends Marionette.View {

  initialized: boolean;
  abstractTreeRenderer: AbstractTreeRenderer;

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
    Store.subscribe(() => { this.drawTree(); });

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


  drawTree = _.throttle(() => {
    const { activeTreeId, activeNodeId, trees } = Store.getState().skeletonTracing;
    if (Store.getState().skeletonTracing && this.abstractTreeRenderer) {
      this.abstractTreeRenderer.drawTree(trees[activeTreeId], activeNodeId);
    }
  }, 1000);


  handleClick(event) {
    const id = this.abstractTreeRenderer.getIdFromPos(event.offsetX, event.offsetY);
    if (id) {
      Store.dispatch(setActiveNodeAction(id));
    }
  }
}
AbstractTreeTabView.initClass();


export default AbstractTreeTabView;
