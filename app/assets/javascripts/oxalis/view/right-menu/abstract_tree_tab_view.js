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
import type { OxalisState, SkeletonTracingType, TracingType } from "oxalis/store";
import { makeSkeletonTracingGuard } from "oxalis/view/guards";

// The refinement that we're dealing with a SkeletonTracing doesn't happen in mapStateToProps,
// but in makeSkeletonTracingGuard
type UnguardedStateProps = {
  skeletonTracing: TracingType,
};
type Props = {
  dispatch: Dispatch<*>,
  skeletonTracing: SkeletonTracingType,
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

function mapStateToProps(state: OxalisState): UnguardedStateProps {
  return { skeletonTracing: state.tracing };
}

export default connect(mapStateToProps)(makeSkeletonTracingGuard(AbstractTreeView));
