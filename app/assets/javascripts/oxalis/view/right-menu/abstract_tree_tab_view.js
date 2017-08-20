/**
 * abstract_tree_tab_view.js
 * @flow
 */
import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import { setActiveNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import AbstractTreeRenderer from "oxalis/view/right-menu/abstract_tree_renderer";
import type { NodeListItemType } from "oxalis/view/right-menu/abstract_tree_renderer";
import type { OxalisState, SkeletonTracingType } from "oxalis/store";
import { makeSkeletonTracingGuard } from "oxalis/view/guards";

type Props = {
  skeletonTracing: SkeletonTracingType,
  dispatch: Dispatch<*>,
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

  nodeList: Array<NodeListItemType> = [];
  drawTree = _.throttle(() => {
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

function mapStateToProps(state: OxalisState) {
  return { skeletonTracing: state.tracing };
}

export default connect(mapStateToProps)(makeSkeletonTracingGuard(AbstractTreeView));
