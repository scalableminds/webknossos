/**
 * comment_list.js
 * @flow weak
 */

import _ from "lodash";
import React, { Component } from "react";
import TreeCommentList from "oxalis/view/skeletontracing/right-menu/comment_tab/tree_comment_list";
import type { TreeType } from "oxalis/store";

type StateType = {
  data: Array<TreeType>;
  activeNodeId: number;
  activeTreeId?: number;
  isSortedAscending: boolean;
};

class CommentList extends Component {
  state: StateType

  constructor() {
    super();
    this.state = {
      data: [],
      activeNodeId: 0,
      isSortedAscending: true,
    };
  }

  render() {
    if (!this.state.data.length) { return null; }

    // create comment lists grouped by trees
    const commentAndTreeNodes = _.map(this.state.data, (tree) => {
      // do not render tree if it has no comments
      if (!tree.comments.length) { return null; }

      // sort comments in place
      const sortOrder = this.state.isSortedAscending ? "asc" : "desc";
      const sortedComments = _.orderBy(tree.comments, "node", sortOrder);

      // one tree and its comments
      return (
        <TreeCommentList
          key={tree.treeId}
          treeId={tree.treeId}
          treeName={tree.name}
          comments={sortedComments}
          activeNodeId={this.state.activeNodeId}
          activeTreeId={this.state.activeTreeId}
          onNewActiveNode={this.props.onNewActiveNode}
        />
      );
    });

    // the whole comment list
    return (
      <div className="commentList">
        {commentAndTreeNodes}
      </div>
    );
  }

}


export default CommentList;
