import { Button } from "antd";
import window from "libs/window";
import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import { setActiveNodeAction } from "viewer/model/actions/skeletontracing_actions";
import type { SkeletonTracing, WebknossosState } from "viewer/store";
import type { NodeListItem } from "viewer/view/right-border-tabs/abstract_tree_renderer";
import AbstractTreeRenderer from "viewer/view/right-border-tabs/abstract_tree_renderer";

type StateProps = {
  dispatch: Dispatch<any>;
  skeletonTracing: SkeletonTracing | null | undefined;
};
type Props = StateProps;
type State = {
  visible: boolean;
};

class AbstractTreeTab extends Component<Props, State> {
  canvas: HTMLCanvasElement | null | undefined;
  nodeList: Array<NodeListItem> = [];
  state: State = {
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

  drawTree = _.throttle(() => {
    if (!this.props.skeletonTracing || !this.state.visible) {
      return;
    }

    const { activeTreeId, activeNodeId, trees } = this.props.skeletonTracing;
    const { canvas } = this;

    if (canvas != null) {
      this.nodeList = AbstractTreeRenderer.drawTree(
        canvas,
        activeTreeId != null ? trees.getNullable(activeTreeId) : null,
        activeNodeId,
        [canvas.offsetWidth, canvas.offsetHeight],
      );
    }
  }, 1000);

  handleClick = (event: React.MouseEvent<any>) => {
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
    this.setState({
      visible: true,
    });
  };

  render() {
    return (
      <div className="flex-center">
        {this.state.visible ? (
          <canvas
            id="abstract-tree-canvas"
            ref={(canvas) => {
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

function mapStateToProps(state: WebknossosState): Partial<Props> {
  return {
    skeletonTracing: state.annotation.skeleton,
  };
}

const connector = connect(mapStateToProps);
export default connector(AbstractTreeTab);
