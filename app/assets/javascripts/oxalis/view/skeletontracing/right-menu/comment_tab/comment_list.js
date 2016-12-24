import _ from "lodash";
import Utils from "libs/utils";
import React, { Component } from "react";
import TreeCommentList from "./tree_comment_list";


class CommentList extends Component {

  constructor() {
    super();
    this.state = {
      data: [],
      activeNodeId: 0,
      isSortedAscending: true
    };
  }

  render() {

    if (!this.state.data.length) { return null; }

    // create comment lists grouped by trees
    let commentAndTreeNodes = _.map(this.state.data, tree => {

      // do not render tree if it has no comments
      if (!tree.comments.length) { return null; }

      // sort comments in place
      tree.comments.sort(Utils.compareBy("node", this.state.isSortedAscending));

      // one tree and its comments
      return (
        <TreeCommentList
          key={tree.treeId}
          treeId={tree.treeId}
          treeName={tree.name}
          comments={tree.comments}
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
