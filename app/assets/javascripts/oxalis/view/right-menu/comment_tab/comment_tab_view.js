/**
 * comment_tab_view.js
 * @flow
 */

import _ from "lodash";
import React from "react";
import Maybe from "data.maybe";
import Utils from "libs/utils";
import { connect } from "react-redux";
import { Button, Input } from "antd";
import InputComponent from "oxalis/view/components/input_component";
import { InputKeyboardNoLoop } from "libs/input";
import { getActiveTree, getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import { setActiveNodeAction, createCommentAction, deleteCommentAction } from "oxalis/model/actions/skeletontracing_actions";
import TreeCommentList from "oxalis/view/right-menu/comment_tab/tree_comment_list";
import type { Dispatch } from "redux";
import type { OxalisState, SkeletonTracingType } from "oxalis/store";
import { makeSkeletonTracingGuard } from "oxalis/view/guards";

const InputGroup = Input.Group;

type CommentTabStateType = {
  isSortedAscending: boolean,
};

class CommentTabView extends React.Component {
  props: {
    skeletonTracing: SkeletonTracingType,
    setActiveNode: (nodeId: number) => void,
    deleteComment: () => void,
    createComment: (text: string) => void,
  };

  state: CommentTabStateType = {
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
    Utils.zipMaybe(
      getActiveTree(this.props.skeletonTracing),
      getActiveNode(this.props.skeletonTracing),
    ).map(([activeTree, activeNode]) => {
      const sortAscending = forward ? this.state.isSortedAscending : !this.state.isSortedAscending;
      const sortOrder = sortAscending ? "asc" : "desc";
      const { trees } = this.props.skeletonTracing;

      // get tree of active comment or activeTree if there is no active comment
      let nextComment = null;
      // $FlowFixMe
      let nextTree = _.find(trees, tree => _.some(tree.comments, comment => comment.node === activeNode.id));
      if (nextTree != null) {
        const sortedComments = _.orderBy(nextTree.comments, comment => comment.node, [sortOrder]);

        // try to find next comment for this tree
        nextComment = _.find(sortedComments,
          comment => this.comparator(comment.node, sortAscending) > this.comparator(activeNode.id, sortAscending));

        // try to find next tree with at least one comment
        if (nextComment == null) {
          // $FlowFixMe
          nextTree = _.find(trees,
            tree => this.comparator(tree.treeId, sortAscending) > this.comparator(activeTree.treeId, sortAscending) && tree.comments.length);
        }
      }

      // try to find any tree with at least one comment, starting from the beginning
      if (nextTree == null) {
        // $FlowFixMe
        nextTree = _.find(trees, tree => tree.comments.length);
      }

      if (nextComment == null && nextTree != null) {
        const sortedComments = _.orderBy(nextTree.comments, ["node"], [sortOrder]);
        nextComment = sortedComments[0];
      }

      // if a comment was found set the corresponding node active, causing the list to update
      if (nextComment) {
        this.props.setActiveNode(nextComment.node);
      }
    });
  }

  previousComment = () => {
    this.nextComment(false);
  }

  comparator(value: number, sortAscending:boolean) {
    const coefficient = sortAscending ? 1 : -1;
    return value * coefficient;
  }

  handleChangeInput = (evt) => {
    const commentText = evt.target.value;

    if (commentText) {
      this.props.createComment(commentText);
    } else {
      this.props.deleteComment(commentText);
    }
  }

  handleChangeSorting = () => {
    this.setState({
      isSortedAscending: !this.state.isSortedAscending,
    });
  }

  getTreeComponents() {
    const sortOrder = this.state.isSortedAscending ? "asc" : "desc";

    return _.orderBy(this.props.skeletonTracing.trees, ["treeId"], [sortOrder]).filter(tree => tree.comments.length > 0).map(tree =>
      // one tree and its comments
      <TreeCommentList
        key={tree.treeId}
        tree={tree}
        sortOrder={sortOrder}
      />,
    );
  }

  render() {
    const activeComment = Utils.zipMaybe(
      getActiveTree(this.props.skeletonTracing),
      getActiveNode(this.props.skeletonTracing),
    ).chain(([tree, activeNode]) => Maybe.fromNullable(tree.comments.find(comment => comment.node === activeNode.id)))
      .map(comment => comment.content)
      .getOrElse("");

    const sortingIconClass = this.state.isSortedAscending ? "fa fa-sort-alpha-asc" : "fa fa-sort-alpha-desc";
    const treesAndComments = this.getTreeComponents();

    return (
      <div>
        <InputGroup compact>
          <Button onClick={this.previousComment}><i className="fa fa-arrow-left" /></Button>
          <InputComponent
            value={activeComment}
            onChange={this.handleChangeInput}
            placeholder="Add comment"
            style={{ width: "60%" }}
          />
          <Button onClick={this.nextComment}><i className="fa fa-arrow-right" /></Button>
          <Button onClick={this.handleChangeSorting} title="sort">
            <i className={sortingIconClass} />
          </Button>
        </InputGroup>
        <ul id="comment-list">
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
  setActiveNode(nodeId) { dispatch(setActiveNodeAction(nodeId)); },
  deleteComment() { dispatch(deleteCommentAction()); },
  createComment(text) { dispatch(createCommentAction(text)); },
});

export default connect(mapStateToProps, mapDispatchToProps)(makeSkeletonTracingGuard(CommentTabView));
