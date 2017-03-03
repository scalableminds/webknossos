import React, { Component } from "react";
import classNames from "classnames";
import Comment from "oxalis/view/skeletontracing/right-menu/comment_tab/comment";


class TreeCommentList extends Component {

  constructor() {
    super();
    this.state = { collapsed: false };
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick(evt) {
    this.setState({ collapsed: !this.state.collapsed });
    evt.preventDefault();
  }

  render() {
    const containsActiveNode = this.props.treeId === this.props.activeTreeId;

    // don't render the comment nodes if the tree is collapsed
    const commentNodes = !this.state.collapsed ?
      this.props.comments.map(comment =>
        <Comment
          key={comment.node}
          data={comment}
          treeId={this.props.treeId}
          isActive={comment.node === this.props.activeNodeId}
          onNewActiveNode={this.props.onNewActiveNode}
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
          <a href="#toggle-comment" onClick={this.handleClick}>
            <i className={iClassName} />
          </a>
          {this.props.treeId} - {this.props.treeName}
        </li>
        {commentNodes}
      </div>
    );
  }
}


export default TreeCommentList;
