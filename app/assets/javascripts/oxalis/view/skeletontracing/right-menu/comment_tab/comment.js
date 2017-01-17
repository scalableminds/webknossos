import React, { Component } from "react";
import scrollIntoViewIfNeeded from "scroll-into-view-if-needed";
import classNames from "classnames";


class Comment extends Component {

  constructor() {
    super();
    this.handleClick = this.handleClick.bind(this);
  }

  componentDidUpdate() {
    this.ensureVisible();
  }

  handleClick(evt) {
    evt.preventDefault();
    this.props.onNewActiveNode(this.props.data, this.props.treeId);
  }

  ensureVisible() {
    if (this.props.isActive) {
      // use ponyfill as so far only chrome supports this functionality
      scrollIntoViewIfNeeded(this.comment);
    }
  }

  render() {
    const liClassName = classNames({ bold: this.props.isActive });
    const iClassName = classNames("fa", "fa-fw", {
      "fa-angle-right": this.props.isActive,
    });

    const { data } = this.props;
    return (
      <li className={liClassName} id={`comment-tab-node-${data.node}`} ref={(ref) => { this.comment = ref; }}>
        <i className={iClassName} />
        <a href="#jump-to-comment" onClick={this.handleClick}>
          {`${data.node} - ${data.content}`}
        </a>
      </li>
    );
  }
}

export default Comment;
