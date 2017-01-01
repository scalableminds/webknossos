import React, { Component } from "react";
import Comment from "./comment";
import classNames from "classnames";


class TreeCommentList extends Component {

  constructor() {
    super();
    this.state = { collapsed: false };
    this.handleClick = this.handleClick.bind(this);
  }

  render() {

    let containsActiveNode = this.props.treeId === this.props.activeTreeId;

    // don't render the comment nodes if the tree is collapsed
    let commentNodes = !this.state.collapsed ?
      this.props.comments.map(comment =>
        <Comment
          key={comment.node}
          data={comment}
          treeId={this.props.treeId}
          isActive={comment.node == this.props.activeNodeId}
          onNewActiveNode={this.props.onNewActiveNode}
        />
      ) :
      null;

    let liClassName = classNames({ "bold" : containsActiveNode });
    let iClassName = classNames("fa", "fa-fw", {
      "fa-chevron-right" : this.state.collapsed,
      "fa-chevron-down" : !this.state.collapsed,
    });

    // one tree and its comments
    return (
      <div>
        <li className={liClassName}>
          <i className={iClassName} onClick={this.handleClick}></i>
          {this.props.treeId} - {this.props.treeName}
        </li>
        {commentNodes}
      </div>
    );
  }


  handleClick() {
    this.setState({ collapsed : !this.state.collapsed });
  }
}


export default TreeCommentList;
