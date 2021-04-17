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
} from "oxalis/view/right-border-tabs/abstract_tree_renderer";
import window from "libs/window";

type StateProps = {|
  dispatch: Dispatch<*>,
  skeletonTracing: ?SkeletonTracing,
|};
type Props = {| ...StateProps |};

type State = {
  visible: boolean,
};

class AbstractTreeView extends Component<Props, State> {
  canvas: ?HTMLCanvasElement;
  nodeList: Array<NodeListItem> = [];
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

  // eslint-disable-next-line react/sort-comp
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

  handleClick = (event: SyntheticMouseEvent<*>) => {
    const id = AbstractTreeRenderer.getIdFromPos(
      event.nativeEvent.offsetX,
      event.nativeEvent.offsetY,
      this.nodeList,
    );
    if (id != null) {
      this.props.dispatch(setActiveNodeAction(id));
    }
  };

  onClickShow = () => {
    this.setState({ visible: true });
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
            <Button type="primary" onClick={this.onClickShow}>
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

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(AbstractTreeView);
