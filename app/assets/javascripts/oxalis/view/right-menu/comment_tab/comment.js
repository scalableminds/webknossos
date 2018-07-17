// @flow
import * as React from "react";
import scrollIntoViewIfNeeded from "scroll-into-view-if-needed";
import classNames from "classnames";
import Store from "oxalis/store";
import { setActiveNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import Markdown from "react-remarkable";
import type { CommentType } from "oxalis/store";

type Props = {
  isActive: boolean,
  data: CommentType,
};

function linkify(string: string) {
  return string.replace(/#([0-9]+)/g, (match, p1) => `[#${p1}](#activeNode=${p1})`);
}

class Comment extends React.PureComponent<Props> {
  comment: ?HTMLLIElement;

  componentDidUpdate() {
    this.ensureVisible();
  }

  handleClick = () => {
    Store.dispatch(setActiveNodeAction(this.props.data.nodeId));
  };

  ensureVisible() {
    if (this.props.isActive) {
      // use polyfill as so far only chrome supports this functionality
      scrollIntoViewIfNeeded(this.comment, {
        block: "center",
        scrollMode: "if-needed",
        boundary: document.body,
      });
    }
  }

  render() {
    const liClassName = classNames({ bold: this.props.isActive });
    const iClassName = classNames("fa", "fa-fw", {
      "fa-angle-right": this.props.isActive,
    });

    const { data } = this.props;
    return (
      <li
        className={liClassName}
        id={`comment-tab-node-${data.nodeId}`}
        ref={ref => {
          this.comment = ref;
        }}
      >
        <i className={iClassName} />
        <a onClick={this.handleClick}>{data.nodeId}</a>
        {" - "}
        <div style={{ display: "inline-block" }}>
          <Markdown
            source={linkify(data.content)}
            options={{ html: false, breaks: true, linkify: true }}
          />
        </div>
      </li>
    );
  }
}

export default Comment;
