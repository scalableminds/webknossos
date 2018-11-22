/**
 * abstract_tree_tab_view.js
 * @flow
 */
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React, { Component } from "react";
import _ from "lodash";

import type { OxalisState, SkeletonTracing } from "oxalis/store";
import { setActiveNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import AbstractTreeRenderer, {
  type NodeListItem,
} from "oxalis/view/right-menu/abstract_tree_renderer";
import window from "libs/window";

type Props = {
  dispatch: Dispatch<*>,
  skeletonTracing: ?SkeletonTracing,
};

class AbstractTreeView extends Component<Props> {
  canvas: ?HTMLCanvasElement;

  componentDidMount() {
    window.addEventListener("resize", this.drawTree, false);
    this.drawTree();
  }

  componentDidUpdate() {
    this.drawTree();
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.drawTree, false);
  }

  nodeList: Array<NodeListItem> = [];
  drawTree = _.throttle(() => {
    if (!this.props.skeletonTracing) {
      return;
    }
    const { activeTreeId, activeNodeId, trees } = this.props.skeletonTracing;
    const { canvas } = this;
    if (canvas != null) {
      this.nodeList = AbstractTreeRenderer.drawTree(
        canvas,
        activeTreeId != null ? trees[activeTreeId] : null,
        activeNodeId,
        [canvas.offsetWidth, canvas.offsetHeight],
      );
    }
  }, 1000);

  handleClick = event => {
    const id = AbstractTreeRenderer.getIdFromPos(
      event.nativeEvent.offsetX,
      event.nativeEvent.offsetY,
      this.nodeList,
    );
    if (id != null) {
      this.props.dispatch(setActiveNodeAction(id));
    }
  };

  render() {
    return (
      <div>
        <canvas
          id="abstract-tree-canvas"
          ref={canvas => {
            this.canvas = canvas;
          }}
          onClick={this.handleClick}
        />
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): $Shape<Props> {
  return { skeletonTracing: state.tracing.skeleton };
}

export default connect(mapStateToProps)(AbstractTreeView);
