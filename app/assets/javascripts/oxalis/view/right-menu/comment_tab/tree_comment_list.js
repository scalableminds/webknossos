/**
 * tree_comment_list.js
 * @flow
 */

import * as React from "react";
import { connect } from "react-redux";
import classNames from "classnames";
import Comment from "oxalis/view/right-menu/comment_tab/comment";
import Utils from "libs/utils";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import scrollIntoViewIfNeeded from "scroll-into-view-if-needed";
import type { OxalisState, TreeType, SkeletonTracingType, CommentType } from "oxalis/store";

type OwnProps = {
  tree: TreeType,
  isSortedAscending: boolean,
};

type TreeCommentListProps = {
  skeletonTracing: SkeletonTracingType,
} & OwnProps;

type State = {
  collapsed: boolean,
};

class TreeCommentList extends React.PureComponent<TreeCommentListProps, State> {
  treeDomElement: ?HTMLLIElement;
  state = {
    collapsed: false,
  };

  componentDidUpdate() {
    this.ensureVisible();
  }

  activeNodeHasComment(): boolean {
    return this.props.tree.comments.some(
      comment => comment.nodeId === this.props.skeletonTracing.activeNodeId,
    );
  }

  ensureVisible() {
    // Only scroll to this tree if this is the active tree and there is no active comment to scroll to
    if (
      this.props.tree.treeId === this.props.skeletonTracing.activeTreeId &&
      !this.activeNodeHasComment()
    ) {
      scrollIntoViewIfNeeded(this.treeDomElement, {
        block: "center",
        scrollMode: "if-needed",
        boundary: document.body,
      });
    }
  }

  handleToggleComment = () => {
    this.setState({ collapsed: !this.state.collapsed });
  };

  render() {
    const containsActiveNode = this.props.tree.treeId === this.props.skeletonTracing.activeTreeId;

    // don't render the comment nodes if the tree is collapsed
    const commentNodes = !this.state.collapsed
      ? this.props.tree.comments
          .slice(0)
          .sort(
            Utils.localeCompareBy(
              ([]: Array<CommentType>),
              "content",
              this.props.isSortedAscending,
            ),
          )
          .map(comment => (
            <Comment
              key={comment.nodeId}
              data={comment}
              treeId={this.props.tree.treeId}
              isActive={comment.nodeId === this.props.skeletonTracing.activeNodeId}
            />
          ))
      : null;

    const liClassName = classNames({ bold: containsActiveNode });
    const iClassName = classNames("fa", "fa-fw", {
      "fa-chevron-right": this.state.collapsed,
      "fa-chevron-down": !this.state.collapsed,
    });

    // one tree and its comments
    return (
      <div>
        <li
          className={liClassName}
          ref={ref => {
            this.treeDomElement = ref;
          }}
        >
          <a onClick={this.handleToggleComment}>
            <i className={iClassName} />
          </a>
          {this.props.tree.treeId} - {this.props.tree.name}
        </li>
        {commentNodes}
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState, ownProps: OwnProps): TreeCommentListProps {
  return {
    skeletonTracing: enforceSkeletonTracing(state.tracing),
    tree: ownProps.tree,
    isSortedAscending: ownProps.isSortedAscending,
  };
}

export default connect(mapStateToProps)(TreeCommentList);
