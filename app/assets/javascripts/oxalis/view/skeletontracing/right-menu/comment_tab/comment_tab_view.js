import _ from "lodash";
import $ from "jquery";
import Marionette from "backbone.marionette";
import React from "react";
import { render } from "react-dom";
import Store from "oxalis/store";
import { setActiveNodeAction, createCommentAction, deleteCommentAction } from "oxalis/model/actions/skeletontracing_actions";
import { InputKeyboardNoLoop } from "libs/input";
import Utils from "libs/utils";
import scrollIntoViewIfNeeded from "scroll-into-view-if-needed";
import CommentList from "oxalis/view/skeletontracing/right-menu/comment_tab/comment_list";

class CommentTabView extends Marionette.View {

  static initClass() {
    this.prototype.className = "flex-column";
    this.prototype.template = _.template(`\
<div class="input-group" id="comment-navbar">
  <div class="input-group-btn">
    <button class="btn btn-default" id="comment-previous"><i class="fa fa-arrow-left"></i></button>
  </div>
  <input class="form-control" id="comment-input" type="text" value="<%- activeComment.comment ? activeComment.comment.content : '' %>" placeholder="Add comment">
  <div class="input-group-btn">
    <button class="btn btn-default" id="comment-next"><i class="fa fa-arrow-right"></i></button>
    <button class="btn btn-default" id="comment-sort" title="sort">
      <% if(isSortedAscending){ %>
        <i class="fa fa-sort-alpha-asc"></i>
      <% } else { %>
        <i class="fa fa-sort-alpha-desc"></i>
      <% } %>
    </button>
  </div>
</div>
<ul id="comment-list" class="flex-overflow"></ul>\
`);


    this.prototype.ui = {
      commentInput: "input",
      commentList: "#comment-list",
    };

    this.prototype.events = {
      "click #comment-sort": "sortComments",
      "change input": "handleInput",
      "click #comment-list li": "setActive",
      "click #comment-next": "nextComment",
      "click #comment-previous": "previousComment",
    };
  }

  templateContext() {
    return {
      activeComment: this.activeComment,
      isSortedAscending: this.isSortedAscending,
    };
  }


  initialize() {
    this.activeComment = {};
    this.isSortedAscending = true;

    // events
    Store.subscribe(() => {
      this.updateInputElement();
      this.updateState();
    });

    // keyboard shortcuts
    return new InputKeyboardNoLoop({
      n: () => this.nextComment(),
      p: () => this.previousComment(),
    });
  }


  render() {
    // tabs are not destroyed and a rerender would cause the react components to lose their state
    if (!this.commentList) {
      super.render();
      this.commentList = render(
        <CommentList />,
        this.ui.commentList[0],
      );
      this.updateState();
    }

    // scroll active comment into view
    this.ensureActiveCommentVisible();
  }


  updateState() {
    if (!this.commentList) { return; }
    const { trees, activeTreeId, activeNodeId } = Store.getState().skeletonTracing;
    this.commentList.setState({
      activeNodeId,
      activeTreeId,
      data: _.sortBy(trees, "treeId"),
      isSortedAscending: this.isSortedAscending,
    });
  }


  ensureActiveCommentVisible() {
    const activeNodeId = this.getActiveNodeId();
    const comment = $(`#comment-tab-node-${activeNodeId}`)[0];
    if (comment) { scrollIntoViewIfNeeded(comment); }
  }


  getActiveNodeId() {
    return Store.getState().skeletonTracing.activeNodeId;
  }


  getActiveTreeId() {
    return Store.getState().skeletonTracing.activeTreeId;
  }


  getCommentForNode(nodeId, treeId) {
    const { activeTreeId, trees, activeNodeId } = Store.getState().skeletonTracing;
    if (!treeId) { treeId = activeTreeId; }

    const commentForActiveNode = trees[treeId].comments.filter(comment => comment.node === activeNodeId);
    return commentForActiveNode[0];
  }


  updateInputElement(nodeId) {
    // responds to activeNode:change event
    const comment = this.getCommentForNode(nodeId);
    let text = "";
    if (comment) {
      // populate the input element
      text = comment.comment;
    }
    this.ui.commentInput.val(text);
  }


  handleInput(evt) {
    const commentText = $(evt.target).val();

    if (commentText) {
      Store.dispatch(createCommentAction(commentText));
    } else {
      Store.dispatch(deleteCommentAction(commentText));
    }
  }

  nextComment(forward = true) {
    const sortAscending = forward ? this.isSortedAscending : !this.isSortedAscending;
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
      Store.dispatch(setActiveNodeAction(nextComment.node));
    }
  }


  previousComment() {
    this.nextComment(false);
  }


  sortComments() {
    this.isSortedAscending = !this.isSortedAscending;
    this.updateState();
  }

  comparator(value, sortAscending) {
    const coefficient = sortAscending ? 1 : -1;
    return value * coefficient;
  }
}
CommentTabView.initClass();

export default CommentTabView;
