/**
 * comment_tab_view.js
 * @flow
 */

import _ from "lodash";
import * as React from "react";
import Maybe from "data.maybe";
import Utils from "libs/utils";
import { connect } from "react-redux";
import { Input } from "antd";
import InputComponent from "oxalis/view/components/input_component";
import ButtonComponent from "oxalis/view/components/button_component";
import { InputKeyboardNoLoop } from "libs/input";
import { getActiveTree, getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  setActiveNodeAction,
  createCommentAction,
  deleteCommentAction,
} from "oxalis/model/actions/skeletontracing_actions";
import TreeCommentList from "oxalis/view/right-menu/comment_tab/tree_comment_list";
import type { Dispatch } from "redux";
import type { OxalisState, SkeletonTracingType, TreeType, CommentType } from "oxalis/store";
import { makeSkeletonTracingGuard } from "oxalis/view/guards";

const InputGroup = Input.Group;

const treeTypeHint = ([]: TreeType[]);

type Props = {
  skeletonTracing: SkeletonTracingType,
  setActiveNode: (nodeId: number) => void,
  deleteComment: () => void,
  createComment: (text: string) => void,
};

type CommentTabStateType = {
  isSortedAscending: boolean,
};

class CommentTabView extends React.PureComponent<Props, CommentTabStateType> {
  state = {
    isSortedAscending: true,
  };

  componentWillUnmount() {
    this.keyboard.destroy();
  }

  keyboard = new InputKeyboardNoLoop({
    n: () => this.nextComment(),
    p: () => this.previousComment(),
  });

  nextComment = (forward = true) => {
    getActiveNode(this.props.skeletonTracing).map(activeNode => {
      const sortAscending = forward ? this.state.isSortedAscending : !this.state.isSortedAscending;
      const { trees } = this.props.skeletonTracing;

      // Create a sorted, flat array of all comments across all trees
      const sortedTrees = _.values(trees)
        .slice(0)
        .sort(Utils.localeCompareBy(treeTypeHint, "name", sortAscending));

      // eslint-disable-next-line prefer-arrow-callback
      const sortedComments = _.flatMap(sortedTrees, function(tree: TreeType): Array<CommentType> {
        return tree.comments
          .slice(0)
          .sort(
            Utils.localeCompareBy(
              ([]: CommentType[]),
              comment => `${comment.content}_${comment.nodeId}`,
              sortAscending,
            ),
          );
      });

      const currentCommentIndex = _.findIndex(sortedComments, { nodeId: activeNode.id });
      const nextCommentIndex = (currentCommentIndex + 1) % sortedComments.length;

      if (nextCommentIndex >= 0 && nextCommentIndex < sortedComments.length) {
        this.props.setActiveNode(sortedComments[nextCommentIndex].nodeId);
      }

      return null; // satisfy linter
    });
  };

  previousComment = () => {
    this.nextComment(false);
  };

  comparator(value: number, sortAscending: boolean) {
    const coefficient = sortAscending ? 1 : -1;
    return value * coefficient;
  }

  handleChangeInput = evt => {
    const commentText = evt.target.value;

    if (commentText) {
      this.props.createComment(commentText);
    } else {
      this.props.deleteComment();
    }
  };

  handleChangeSorting = () => {
    this.setState({
      isSortedAscending: !this.state.isSortedAscending,
    });
  };

  getTreeComponents() {
    return _.values(this.props.skeletonTracing.trees)
      .filter(tree => tree.comments.length > 0)
      .sort(Utils.localeCompareBy(treeTypeHint, "name", this.state.isSortedAscending))
      .map(tree => (
        // one tree and its comments
        <TreeCommentList
          key={tree.treeId}
          tree={tree}
          isSortedAscending={this.state.isSortedAscending}
        />
      ));
  }

  render() {
    const activeComment = Utils.zipMaybe(
      getActiveTree(this.props.skeletonTracing),
      getActiveNode(this.props.skeletonTracing),
    )
      .chain(([tree, activeNode]) =>
        Maybe.fromNullable(tree.comments.find(comment => comment.nodeId === activeNode.id)),
      )
      .map(comment => comment.content)
      .getOrElse("");

    const sortingIconClass = this.state.isSortedAscending
      ? "fa fa-sort-alpha-asc"
      : "fa fa-sort-alpha-desc";
    const treesAndComments = this.getTreeComponents();

    return (
      <div className="flex-column">
        <InputGroup compact>
          <ButtonComponent onClick={this.previousComment}>
            <i className="fa fa-arrow-left" />
          </ButtonComponent>
          <InputComponent
            value={activeComment}
            onChange={this.handleChangeInput}
            placeholder="Add comment"
            style={{ width: "60%" }}
          />
          <ButtonComponent onClick={this.nextComment}>
            <i className="fa fa-arrow-right" />
          </ButtonComponent>
          <ButtonComponent onClick={this.handleChangeSorting} title="sort">
            <i className={sortingIconClass} />
          </ButtonComponent>
        </InputGroup>
        <ul id="comment-list" className="flex-overflow">
          {treesAndComments}
        </ul>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  skeletonTracing: state.tracing,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setActiveNode(nodeId) {
    dispatch(setActiveNodeAction(nodeId));
  },
  deleteComment() {
    dispatch(deleteCommentAction());
  },
  createComment(text) {
    dispatch(createCommentAction(text));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(
  makeSkeletonTracingGuard(CommentTabView),
);
