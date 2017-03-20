/**
 * comment_tab_view.js
 * @flow
 */

import _ from "lodash";
import React from "react";
import Maybe from "data.maybe";
import { connect } from "react-redux";
import { Button, Input } from "antd";
import { InputKeyboardNoLoop } from "libs/input";
import Utils from "libs/utils";
import Store from "oxalis/store";
import { setActiveNodeAction, createCommentAction, deleteCommentAction } from "oxalis/model/actions/skeletontracing_actions";
import TreeCommentList from "oxalis/view/skeletontracing/right-menu/comment_tab/tree_comment_list";
import type { Dispatch } from "redux";
import type { OxalisState } from "oxalis/store";

const InputGroup = Input.Group;

class CommentTabView extends React.Component {

  constructor() {
    super();

    // TODO unsubcribe?
    // keyboard shortcuts
    const keyboard = new InputKeyboardNoLoop({
      n: () => this.nextComment(),
      p: () => this.previousComment(),
    });
  }

  state = {
    isSortedAscending: true,
  }

  nextComment(forward = true) {
    const sortAscending = forward ? this.state.isSortedAscending : !this.state.isSortedAscending;
    const { activeNodeId, activeTreeId, trees } = Store.getState().skeletonTracing;

    // get tree of active comment or activeTree if there is no active comment
    let nextComment = null;
    let nextTree = _.find(trees, (tree => _.some(tree.comments, comment => comment.node === activeNodeId)));
    if (nextTree) {
      nextTree.comments.sort(Utils.compareBy("node", sortAscending));

      // try to find next comment for this tree
      nextComment = _.find(nextTree.comments,
      comment => this.comparator(comment.node, sortAscending) > this.comparator(activeNodeId, sortAscending));

      // try to find next tree with at least one comment
      if (!nextComment) {
        nextTree = _.find(trees,
          tree => this.comparator(tree.treeId, sortAscending) > this.comparator(activeTreeId, sortAscending) && tree.comments.length);
      }
    }

    // try to find any tree with at least one comment, starting from the beginning
    if (!nextTree) {
      nextTree = _.find(trees, tree => tree.comments.length);
    }

    if (!nextComment && nextTree) {
      nextTree.comments.sort(Utils.compareBy("node", sortAscending));
      nextComment = nextTree.comments[0];
    }

    // if a comment was found set the corresponding node active, causing the list to update
    if (nextComment) {

      this.props.setActiveNode(nextComment.node);
    }
  }

  previousComment() {
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
    const { activeNodeId, activeTreeId } = this.props.skeletonTracing;

    return _.orderBy(this.props.skeletonTracing.trees, ["treeId"], [sortOrder]).map(tree =>
      // one tree and its comments
      <TreeCommentList
        key={tree.treeId}
        tree={tree}
        activeNodeId={activeNodeId}
        activeTreeId={activeTreeId}
        sortOrder={sortOrder}
      />,
    );
  }

  render() {
    const { activeNodeId, activeTreeId, trees } = this.props.skeletonTracing;
    const activeComment = Maybe.Just(trees[activeTreeId])
      .chain(tree => Maybe.fromNullable(tree.comments.find(comment => comment.node === activeNodeId)))
      .map(comment => comment.content)
      .getOrElse("");

    const sortingIconClass = this.state.isSortedAscending ? "fa fa-sort-alpha-asc" : "fa fa-sort-alpha-desc";
    const treesAndComments = this.getTreeComponents();

    return (
      <div>
        <InputGroup compact>
          <Button><i className="fa fa-arrow-left" /></Button>
          <Input
            value={activeComment}
            onChange={this.handleChangeInput}
            placeholder="Add comment"
            style={{ width: "70%" }}
          />
          <Button><i className="fa fa-arrow-right" /></Button>
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
  skeletonTracing: state.skeletonTracing,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setActiveNode(nodeId) { dispatch(setActiveNodeAction(nodeId)); },
  deleteComment() { dispatch(deleteCommentAction()); },
  createComment(text) { dispatch(createCommentAction(text)); },
});

export default connect(mapStateToProps, mapDispatchToProps)(CommentTabView);
