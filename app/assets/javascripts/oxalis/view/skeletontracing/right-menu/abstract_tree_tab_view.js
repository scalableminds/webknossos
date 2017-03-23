/**
 * abstract_tree_tab_view.js
 * @flow
 */
import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import app from "app";
import { setActiveNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import AbstractTreeRenderer from "oxalis/view/skeletontracing/abstract_tree_renderer";
import type { NodeListItemType } from "oxalis/view/skeletontracing/abstract_tree_renderer";
import type { OxalisState, SkeletonTracingType } from "oxalis/store";

class AbstractTreeView extends Component {
  props: {
    skeletonTracing: SkeletonTracingType,
    dispatch: Dispatch<*>,
  };

  canvas: ?HTMLCanvasElement;

  componentDidMount() {
    app.vent.on("view:setTheme", this.drawTree);
    window.addEventListener("resize", this.drawTree, false);
    this.drawTree();
  }

  componentDidUpdate() {
    this.drawTree();
  }

  componentWillUnmount() {
    app.vent.off("view:setTheme", this.drawTree);
    window.removeEventListener("resize", this.drawTree, false);
  }

  nodeList: Array<NodeListItemType> = [];
  drawTree = _.throttle(() => {
    const { activeTreeId, activeNodeId, trees } = this.props.skeletonTracing;
    const { canvas } = this;
    if (canvas != null) {
      this.nodeList = AbstractTreeRenderer.drawTree(canvas, activeTreeId != null ? trees[activeTreeId] : null, activeNodeId);
    }
  }, 1000);

  handleClick = (event) => {
    const id = AbstractTreeRenderer.getIdFromPos(event.nativeEvent.offsetX, event.nativeEvent.offsetY, this.nodeList);
    if (id != null) {
      this.props.dispatch(setActiveNodeAction(id));
    }
  };

  render() {
    return (
      <div className="flex-column">
        <canvas
          id="abstract-tree-canvas"
          ref={(canvas) => { this.canvas = canvas; }}
          onClick={this.handleClick}
        />
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  return { skeletonTracing: state.skeletonTracing };
}

export default connect(mapStateToProps)(AbstractTreeView);
