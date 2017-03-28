/**
 * tree_comment_list.js
 * @flow
 */

import _ from "lodash";
import React from "react";
import { connect } from "react-redux";
import classNames from "classnames";
import Comment from "oxalis/view/skeletontracing/right-menu/comment_tab/comment";
import type { OxalisState, TreeType } from "oxalis/store";

type TreeCommentListProps = {
  tree: TreeType,
  activeTreeId: ?number,
  activeNodeId: ?number,
  sortOrder: "asc" | "desc";
}

class TreeCommentList extends React.PureComponent {

  props: TreeCommentListProps;
  state = {
    collapsed: false,
  };

  handleToggleComment = () => {
    this.setState({ collapsed: !this.state.collapsed });
  }

  render() {
    const containsActiveNode = this.props.tree.treeId === this.props.activeTreeId;

    // don't render the comment nodes if the tree is collapsed
    const commentNodes = !this.state.collapsed ?
      _.orderBy(this.props.tree.comments, "node", [this.props.sortOrder]).map(comment =>
        <Comment
          key={comment.node}
          data={comment}
          treeId={this.props.tree.treeId}
          isActive={comment.node === this.props.activeNodeId}
        />,
      ) :
      null;

    const liClassName = classNames({ bold: containsActiveNode });
    const iClassName = classNames("fa", "fa-fw", {
      "fa-chevron-right": this.state.collapsed,
      "fa-chevron-down": !this.state.collapsed,
    });

    // one tree and its comments
    return (
      <div>
        <li className={liClassName}>
          <a href="#toggle-comment" onClick={this.handleToggleComment}>
            <i className={iClassName} />
          </a>
          {this.props.tree.treeId} - {this.props.tree.name}
        </li>
        {commentNodes}
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState) {
  if (state.tracing.type === "skeleton") {
    return {
      activeNodeId: state.tracing.activeNodeId,
      activeTreeId: state.tracing.activeTreeId,
    };
  }
  return { activeTreeId: null, activeNodeId: null };
}

export default connect(mapStateToProps)(TreeCommentList);
