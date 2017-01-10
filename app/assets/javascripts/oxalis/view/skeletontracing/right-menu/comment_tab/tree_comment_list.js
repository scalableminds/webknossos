import React, { Component } from "react";
import classNames from "classnames";
import Comment from "./comment";


class TreeCommentList extends Component {

  constructor() {
    super();
    this.state = { collapsed: false };
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick() {
    this.setState({ collapsed: !this.state.collapsed });
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
          <i className={iClassName} onClick={this.handleClick} />
          {this.props.treeId} - {this.props.treeName}
        </li>
        {commentNodes}
      </div>
    );
  }
}


export default TreeCommentList;
