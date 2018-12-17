/**
 * abstract_tree_tab_view.js
 * @flow
 */
import { Button } from "antd";
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

type State = {
  visible: boolean,
};

class AbstractTreeView extends Component<Props, State> {
  canvas: ?HTMLCanvasElement;
  state = {
    visible: false,
  };

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
    if (!this.props.skeletonTracing || !this.state.visible) {
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
      <div className="flex-center">
        {this.state.visible ? (
          <canvas
            id="abstract-tree-canvas"
            ref={canvas => {
              this.canvas = canvas;
            }}
            onClick={this.handleClick}
          />
        ) : (
          <React.Fragment>
            <Button type="primary" onClick={() => this.setState({ visible: true })}>
              Show Abstract Tree
            </Button>
            <span
              style={{
                color: "gray",
                marginTop: 6,
              }}
            >
              This may be slow for very large tracings.
            </span>
          </React.Fragment>
        )}
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): $Shape<Props> {
  return { skeletonTracing: state.tracing.skeleton };
}

export default connect(mapStateToProps)(AbstractTreeView);
